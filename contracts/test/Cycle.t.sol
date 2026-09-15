// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {BaseTest} from "./Base.t.sol";
import {CentralBank} from "../src/CentralBank.sol";
import {ICentralBank} from "../src/interfaces/ICentralBank.sol";

/// @notice One full protocol cycle: founding mint -> taxed buys -> license -> accrual + withdraw ->
///         taxed sells -> epoch roll into contraction -> treasury tick (buyback, burn, POL compound) -> resolve.
contract CycleTest is BaseTest {
    uint256 internal constant BPS = 1e4;

    // running expectations carried between steps
    uint256 internal expectedUnallocated;
    uint256 internal expectedBurned;
    uint256 internal expectedUnminted; // withdrawal-fee THALER that never entered supply
    uint256 internal licensePricePaid;
    uint256 internal bobThaler;
    uint256 internal aliceThaler;
    uint256 internal sellGross4; // gross ETH out recorded in epoch 4
    uint256 internal sellGross5; // gross ETH out recorded in epoch 5

    function test_FullCycle() public {
        _step0_genesisState();
        _step1_foundingMint();
        _step2_bobBuys();
        _step3_aliceBuysAndOpensBranch();
        _step4_accrualAndWithdraw();
        _step5_bobSells();
        _step6_rollIntoContraction();
        _step7_treasuryTick();
        _step8_resolveCharter();
        _finalInvariants();
    }

    // ------------------------------------------------------------------ 0. genesis

    function _step0_genesisState() internal {
        assertEq(token.centralBank(), address(bank));
        assertEq(charter.centralBank(), address(bank));
        assertEq(charter.treasury(), address(treasury));
        assertEq(bank.hook(), address(hook));
        assertEq(treasury.hook(), address(hook));
        assertTrue(hook.poolBound());
        assertTrue(treasury.poolInitialized());
        assertGt(treasury.polLiquidity(), 0, "seed liquidity");
        assertEq(treasury.unallocated(), 0);
        assertEq(bank.multiplier(), 10_000);
        assertEq(uint8(bank.regime()), uint8(ICentralBank.Regime.Expansion));
        assertEq(bank.totalBranches(), 0);
        assertEq(bank.currentEpoch(), 0);
        assertEq(hook.buyTaxBps(), 9_000, "launch buy tax");
        assertEq(hook.sellTaxBps(), 9_000, "launch sell tax");
        // seed used (nearly) all of both sides; leftovers are booked, not lost
        assertLe(token.balanceOf(address(treasury)), 0, "treasury holds no THALER after seed");
        assertApproxEqRel(treasury.poolEthReserve(), SEED_ETH, 1e15, "pool ETH reserve ~ 1 ETH");
        assertTreasuryInvariant();
        expectedBurned = token.totalBurned();
    }

    // ------------------------------------------------------------------ 1. founding mint

    function _step1_foundingMint() internal {
        uint256 cost = 2 * FOUNDING_PRICE;
        vm.prank(alice);
        charter.mintFounding{value: cost}(2);

        assertEq(charter.balanceOf(alice), 2);
        assertEq(charter.ownerOf(1), alice);
        assertEq(charter.ownerOf(2), alice);
        assertEq(charter.totalMinted(), 2);
        assertEq(charter.foundingMinted(), 2);
        assertEq(charter.foundingMintedBy(alice), 2);
        assertEq(bank.totalBranches(), 2);
        assertEq(bank.branchesOf(1), 1);
        assertEq(bank.branchesOf(2), 1);
        assertEq(bank.mintedAt(1), vm.getBlockTimestamp());
        assertEq(bank.pending(1), 0);

        expectedUnallocated += cost;
        assertEq(treasury.unallocated(), expectedUnallocated, "founding ETH lands in unallocated");
        assertEq(address(charter).balance, 0, "charter never holds ETH");

        // soulbound: no transfers while disabled
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("Soulbound()"));
        charter.transferFrom(alice, bob, 1);

        assertTreasuryInvariant();
    }

    // ------------------------------------------------------------------ 2. bob buys (buy tax)

    function _step2_bobBuys() internal {
        uint256 ethIn = 0.1 ether;
        uint256 taxBps = hook.buyTaxBps();
        uint256 tax = ethIn * taxBps / BPS;
        uint256 bobEthBefore = bob.balance;
        uint256 pmBefore = address(pm).balance;

        bobThaler = buy(bob, ethIn);

        assertGt(bobThaler, 0, "bob got THALER");
        assertEq(token.balanceOf(bob), bobThaler);
        assertEq(bob.balance, bobEthBefore - ethIn, "bob paid the full input");
        expectedUnallocated += tax;
        assertEq(treasury.unallocated(), expectedUnallocated, "buy tax lands in unallocated");
        assertEq(address(pm).balance, pmBefore + ethIn - tax, "pool receives net of tax");
        assertEq(address(hook).balance, 0, "hook never holds ETH");
        assertEq(address(router).balance, 0, "router never holds ETH");

        (uint256 in0, uint256 out0) = hook.flowOf(0);
        assertEq(in0, ethIn - tax, "flow ethIn is net of tax");
        assertEq(out0, 0);
        assertEq(hook.totalTaxed(), tax);
        assertTreasuryInvariant();
    }

    // ------------------------------------------------------------------ 3. alice buys, opens a branch

    function _step3_aliceBuysAndOpensBranch() internal {
        uint256 ethIn = 1 ether;
        uint256 tax = ethIn * hook.buyTaxBps() / BPS;
        aliceThaler = buy(alice, ethIn);
        expectedUnallocated += tax;
        assertEq(treasury.unallocated(), expectedUnallocated);

        // floor = 2 days of one branch's issuance = 2 * 700k / 2 branches = 700k; no close yet -> price = floor
        uint256 price = bank.licensePrice();
        assertEq(price, 2 * bank.issuancePerBranchPerDay(), "opening license price = floor");
        assertEq(price, 700_000e18);
        assertGe(aliceThaler, price, "alice can afford the license");
        assertEq(bank.licensesRemainingToday(), 100);

        uint256 supplyBefore = token.totalSupply();
        vm.startPrank(alice);
        token.approve(address(bank), price);
        vm.expectEmit(true, false, false, true, address(bank));
        emit ICentralBank.BranchOpened(1, 2, price);
        bank.openBranch(1);
        vm.stopPrank();

        licensePricePaid = price;
        aliceThaler -= price;
        expectedBurned += price;
        assertEq(token.balanceOf(alice), aliceThaler);
        assertEq(token.totalSupply(), supplyBefore - price, "license THALER is burned");
        assertEq(token.totalBurned(), expectedBurned);
        assertEq(bank.branchesOf(1), 2);
        assertEq(bank.branchesOf(2), 1);
        assertEq(bank.totalBranches(), 3);
        assertEq(bank.lastLicenseClose(), price);
        assertEq(bank.licensesRemainingToday(), 99);
        assertEq(bank.pending(1), 0, "nothing accrued yet (same block)");

        // only the owner can open a branch on a charter
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("NotCharterOwner()"));
        bank.openBranch(1);
        assertTreasuryInvariant();
    }

    // ------------------------------------------------------------------ 4. accrual + withdraw

    function _step4_accrualAndWithdraw() internal {
        uint256 perSecond = bank.issuancePerSecond();
        assertEq(perSecond, 700_000e18 * 10_000 / BPS / 1 days);

        vm.warp(genesis + 1 days);
        assertEq(bank.currentEpoch(), 4);

        // charter 1 holds 2 of 3 branches for exactly one day at 1.00x
        uint256 accDelta = perSecond * 1 days * 1e18 / 3;
        uint256 expected = 2 * accDelta / 1e18;
        assertEq(bank.pending(1), expected, "pending view matches the accumulator math");
        assertEq(bank.pending(2), accDelta / 1e18);
        assertApproxEqRel(expected, uint256(700_000e18) * 2 / 3, uint256(1e12), "~2/3 of a day's issuance");

        // the withdrawal fee at age 1 day: charter 1 keeps pending minus fee, half the fee goes to charter 2
        // (the only other branch), half is never minted
        uint256 feeBps = bank.withdrawFeeBps(1);
        assertEq(feeBps, feeBpsAt(1 days));
        assertEq(feeBps, bank.resolveFeeBps(1));
        uint256 fee = expected * feeBps / BPS;
        uint256 redistributed = fee / 2;
        uint256 unminted = fee - redistributed;
        uint256 pending2Before = bank.pending(2);

        uint256 balBefore = token.balanceOf(alice);
        uint256 supplyBefore = token.totalSupply();
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.Withdrawn(1, alice, expected - fee, fee);
        vm.prank(alice);
        uint256 minted = bank.withdraw(1);

        assertGt(minted, 0);
        assertEq(minted, expected - fee, "withdraw mints pending minus the fee");
        assertEq(bank.totalIssued(), minted, "totalIssued matches");
        assertEq(token.balanceOf(alice), balBefore + minted);
        assertEq(token.totalSupply(), supplyBefore + minted);
        assertEq(bank.pending(1), 0, "pending reset after withdraw; own fee not received");
        assertEq(bank.totalFeesUnminted(), unminted, "half the fee is never minted");
        assertEq(bank.totalResolveBurned(), unminted, "alias getter");
        assertEq(bank.accPerBranch(), accDelta + redistributed * 1e18, "half the fee over the one other branch");
        assertEq(bank.pending(2), pending2Before + redistributed, "charter 2 receives the redistributed half");
        expectedUnminted = unminted;
        aliceThaler += minted;

        // the withdraw rolled epochs 0..3: one positive epoch, three empty ones -> no policy change
        assertEq(bank.lastRolledEpoch(), 3);
        assertEq(bank.multiplier(), 10_000);
        assertEq(bank.consecutivePositive(), 1);
        assertEq(uint8(bank.regime()), uint8(ICentralBank.Regime.Expansion));
        (uint256 m, uint256 s, ICentralBank.Regime r) = replayPolicy(3);
        assertEq(bank.multiplier(), m);
        assertEq(bank.consecutivePositive(), s);
        assertEq(uint8(bank.regime()), uint8(r));

        // tax decayed: 4 half-lives since launch
        assertLt(hook.buyTaxBps(), 9_000);
        assertGt(hook.sellTaxBps(), hook.SELL_FLOOR_BPS());
        assertTreasuryInvariant();
    }

    // ------------------------------------------------------------------ 5. bob sells (sell tax)

    function _step5_bobSells() internal {
        uint256 half = bobThaler / 2;
        uint256 taxBps = hook.sellTaxBps();
        uint256 bobEthBefore = bob.balance;
        uint256 unallocBefore = treasury.unallocated();
        uint256 pmBefore = address(pm).balance;

        uint256 amountOut = sell(bob, half);
        bobThaler -= half;

        assertGt(amountOut, 0, "bob got ETH");
        assertEq(bob.balance, bobEthBefore + amountOut);
        assertEq(token.balanceOf(bob), bobThaler);

        (uint256 in4, uint256 out4) = hook.flowOf(4);
        assertEq(in4, 0);
        assertGt(out4, 0, "sell recorded as ethOut in epoch 4");
        uint256 tax = out4 * taxBps / BPS;
        assertEq(amountOut, out4 - tax, "swapper receives gross minus sell tax");
        assertEq(treasury.unallocated(), unallocBefore + tax, "sell tax lands in unallocated");
        assertEq(address(pm).balance, pmBefore - out4, "pool paid the gross amount");
        assertEq(address(hook).balance, 0);
        expectedUnallocated += tax;
        sellGross4 = out4;
        assertTreasuryInvariant();
    }

    // ------------------------------------------------------------------ 6. two epochs later: roll into contraction

    function _step6_rollIntoContraction() internal {
        // epoch 5: bob sells the rest, so both completed epochs have net outflow
        vm.warp(genesis + 1 days + EPOCH);
        assertEq(bank.currentEpoch(), 5);
        uint256 unallocBefore = treasury.unallocated();
        uint256 amountOut = sell(bob, bobThaler);
        bobThaler = 0;
        (, uint256 out5) = hook.flowOf(5);
        assertGt(out5, 0);
        uint256 tax5 = out5 * hook.sellTaxBps() / BPS;
        assertEq(amountOut, out5 - tax5);
        assertEq(treasury.unallocated(), unallocBefore + tax5);
        expectedUnallocated += tax5;
        sellGross5 = out5;

        // nothing rolled yet: epoch 4 and 5 are still pending until epoch 6 begins
        assertEq(bank.lastRolledEpoch(), 3);

        vm.warp(genesis + 1 days + 2 * EPOCH);
        assertEq(bank.currentEpoch(), 6);

        uint256 pending1Before = bank.pending(1);
        vm.expectEmit(true, false, false, true, address(bank));
        emit ICentralBank.EpochRolled(4, -int256(sellGross4), 8_500, ICentralBank.Regime.Contraction);
        vm.expectEmit(true, false, false, true, address(bank));
        emit ICentralBank.EpochRolled(5, -int256(sellGross5), 7_000, ICentralBank.Regime.Contraction);
        bank.rollEpochs();

        assertEq(bank.lastRolledEpoch(), 5, "all completed epochs rolled");
        assertEq(bank.multiplier(), 7_000, "two consecutive negative trailing windows: two cuts");
        assertEq(bank.consecutivePositive(), 0);
        assertEq(uint8(bank.regime()), uint8(ICentralBank.Regime.Contraction));
        (uint256 m, uint256 s, ICentralBank.Regime r) = replayPolicy(5);
        assertEq(bank.multiplier(), m, "multiplier consistent with recorded flow");
        assertEq(bank.consecutivePositive(), s);
        assertEq(uint8(bank.regime()), uint8(r), "regime consistent with recorded flow");

        // each epoch is booked at the multiplier that governed it: epoch 4 at 1.00x, epoch 5 at 0.85x (after the
        // first cut); the pre-roll view, which assumed 1.00x throughout, was an over-estimate
        uint256 ips100 = uint256(700_000e18) / 1 days;
        uint256 ips85 = uint256(700_000e18) * 8_500 / BPS / 1 days;
        assertEq(bank.pending(1), 2 * (ips100 * EPOCH + ips85 * EPOCH) / 3, "per-epoch accrual, 2 of 3 branches");
        assertLt(bank.pending(1), pending1Before, "late roll no longer credits the cut epoch at the old rate");
        assertEq(bank.issuancePerSecond(), 700_000e18 * 7_000 / BPS / 1 days, "new rate applies going forward");

        // idempotent
        bank.rollEpochs();
        assertEq(bank.lastRolledEpoch(), 5);
        assertEq(bank.multiplier(), 7_000);
        assertTreasuryInvariant();
    }

    // ------------------------------------------------------------------ 7. treasury tick

    function _step7_treasuryTick() internal {
        uint256 a = treasury.unallocated();
        assertEq(a, expectedUnallocated);
        assertGt(a, 0);
        uint256 toTeam = a * treasury.TEAM_BPS() / BPS;
        uint256 toPol = a * treasury.POL_BPS() / BPS;
        uint256 toActive = a - toTeam - toPol;
        uint256 polAtCompound = treasury.polVault() + toPol;
        uint256 expBefore = treasury.expansionVault();
        uint256 conAfterAlloc = treasury.contractionVault() + toActive;
        uint256 liqBefore = treasury.polLiquidity();
        uint256 burnedBefore = token.totalBurned();
        uint256 supplyBefore = token.totalSupply();
        assertEq(treasury.lastTick(), 0);
        assertEq(treasury.totalBoughtBack(), 0);

        // what the buyback will be once the contraction vault is funded by this allocation
        uint256 byVault = conAfterAlloc * treasury.BUYBACK_VAULT_BPS() / BPS;
        uint256 byReserve = treasury.poolEthReserve() * treasury.BUYBACK_RESERVE_BPS() / BPS;
        uint256 expectedBuyback = byVault < byReserve ? byVault : byReserve;
        assertGt(expectedBuyback, 0);
        assertGe(polAtCompound, treasury.POL_MIN_COMPOUND(), "POL vault reaches the compound threshold");
        // the POL swap is capped like the buyback at 0.2% of the pre-tick reserve
        uint256 polHalf = polAtCompound / 2 < byReserve ? polAtCompound / 2 : byReserve;
        assertEq(polHalf, byReserve, "the reserve cap binds the POL swap");

        (uint256 in6Before, uint256 out6Before) = hook.flowOf(6);
        vm.recordLogs();
        treasury.tick();
        (uint256 bbEth, uint256 bbThaler, uint256 polEthUsed, uint256 polThalerUsed, uint128 polLiq, uint256 polBurn) =
            _parseTickLogs(vm.getRecordedLogs());

        // allocation: contraction regime -> active share goes to the contraction vault
        assertEq(treasury.unallocated(), 0);
        assertEq(treasury.teamVault(), toTeam);
        assertEq(treasury.expansionVault(), expBefore, "expansion vault untouched in contraction");

        // buyback + burn
        assertEq(bbEth, expectedBuyback, "buyback = min(10% vault, 0.2% pool ETH reserve)");
        assertGt(bbThaler, 0, "buyback bought THALER");
        assertEq(treasury.totalEthSpentOnBuybacks(), bbEth);
        assertEq(treasury.totalBoughtBack(), bbThaler);
        assertEq(treasury.contractionVault(), conAfterAlloc - bbEth, "vault debited by ETH spent");
        assertEq(treasury.lastTick(), vm.getBlockTimestamp());

        // POL compound: half the vault swapped, paired with the other half, added to the full-range position
        assertEq(treasury.polLiquidity(), liqBefore + polLiq, "POL liquidity grew by the added amount");
        assertGt(polLiq, 0);
        assertGt(polEthUsed, 0);
        assertGt(polThalerUsed, 0);
        assertGe(polEthUsed, polHalf * 98 / 100, "the same amount of ETH is paired with the THALER bought");
        assertLe(polEthUsed, polHalf);
        // what stays in the vault is the LP fee the position collected in ETH: 1% of all ETH swap volume so far
        uint256 ethVolume = 0.01 ether + 0.1 ether + bbEth + polHalf;
        uint256 feeCollected = treasury.polVault() - (polAtCompound - polHalf - polEthUsed);
        assertApproxEqRel(feeCollected, ethVolume / 100, 1e15, "collected LP fees stay in the POL vault");
        assertGe(treasury.polVault(), polAtCompound - 2 * polHalf, "the uncompounded remainder stays in the vault");

        // every THALER the treasury received (buyback + POL leftover) left supply
        uint256 burnedDelta = token.totalBurned() - burnedBefore;
        assertEq(burnedDelta, bbThaler + polBurn, "buyback and POL leftover are burned");
        assertEq(token.totalSupply(), supplyBefore - burnedDelta);
        assertEq(token.balanceOf(address(treasury)), 0, "treasury holds no THALER");

        // treasury swaps are tax-exempt and not recorded as flow
        (uint256 in6, uint256 out6) = hook.flowOf(6);
        assertEq(in6, in6Before, "treasury buyback not recorded as flow");
        assertEq(out6, out6Before);

        expectedBurned = token.totalBurned();
        assertTreasuryInvariant();

        // second tick inside the interval: no second buyback
        uint256 spentBefore2 = treasury.totalEthSpentOnBuybacks();
        treasury.tick();
        assertEq(treasury.totalEthSpentOnBuybacks(), spentBefore2, "rate limited");

        // team claim
        uint256 teamBefore = team.balance;
        treasury.claimTeam();
        assertEq(team.balance, teamBefore + toTeam);
        assertEq(treasury.teamVault(), 0);
        assertTreasuryInvariant();
    }

    function _parseTickLogs(Vm.Log[] memory logs)
        internal
        view
        returns (uint256 bbEth, uint256 bbThaler, uint256 polEth, uint256 polThaler, uint128 polLiq, uint256 polBurn)
    {
        bytes32 buybackSig = keccak256("Buyback(uint256,uint256)");
        bytes32 polSig = keccak256("PolCompounded(uint256,uint256,uint128,uint256)");
        uint256 buybacks;
        uint256 compounds;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(treasury)) continue;
            if (logs[i].topics[0] == buybackSig) {
                (bbEth, bbThaler) = abi.decode(logs[i].data, (uint256, uint256));
                buybacks++;
            } else if (logs[i].topics[0] == polSig) {
                (polEth, polThaler, polLiq, polBurn) = abi.decode(logs[i].data, (uint256, uint256, uint128, uint256));
                compounds++;
            }
        }
        assertEq(buybacks, 1, "exactly one buyback");
        assertEq(compounds, 1, "exactly one POL compound");
    }

    // ------------------------------------------------------------------ 8. resolve a charter

    function _step8_resolveCharter() internal {
        uint256 id = 2;
        uint256 age = vm.getBlockTimestamp() - bank.mintedAt(id);
        assertEq(age, 1 days + 2 * EPOCH);
        uint256 remaining = RESOLVE_FEE_PERIOD - age;
        uint256 expectedBps = bank.RESOLVE_FEE_MIN_BPS()
            + (bank.RESOLVE_FEE_MAX_BPS() - bank.RESOLVE_FEE_MIN_BPS()) * remaining * remaining
                / (RESOLVE_FEE_PERIOD * RESOLVE_FEE_PERIOD);
        uint256 feeBps = bank.resolveFeeBps(id);
        assertEq(feeBps, expectedBps, "quadratic fee");
        assertGt(feeBps, bank.RESOLVE_FEE_MIN_BPS());
        assertLt(feeBps, bank.RESOLVE_FEE_MAX_BPS());

        uint256 total = bank.pending(id);
        assertGt(total, 0);
        uint256 fee = total * feeBps / BPS;
        uint256 expectedPaid = total - fee;
        uint256 redistributed = fee / 2;
        uint256 burned = fee - redistributed;
        assertEq(bank.totalFeesUnminted(), expectedUnminted, "only the step 4 withdrawal fee so far");

        uint256 accBefore = bank.accPerBranch();
        uint256 pending1Before = bank.pending(1);
        uint256 issuedBefore = bank.totalIssued();
        uint256 aliceBefore = token.balanceOf(alice);
        uint256 branchesBefore = bank.totalBranches();
        uint256 charterBranches = bank.branchesOf(id);

        // not the owner -> revert
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("NotCharterOwner()"));
        bank.resolve(id);

        // resolution is a final withdrawal (same fee) followed by burning the charter
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.Withdrawn(id, alice, expectedPaid, fee);
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.CharterResolved(id, alice, expectedPaid, burned, redistributed);
        vm.prank(alice);
        uint256 paid = bank.resolve(id);

        assertEq(paid, expectedPaid, "paid = pending - fee");
        assertEq(token.balanceOf(alice), aliceBefore + paid);
        assertEq(bank.totalIssued(), issuedBefore + paid);
        expectedUnminted += burned;
        assertEq(bank.totalFeesUnminted(), expectedUnminted, "half the fee is never minted");
        assertEq(bank.totalBranches(), branchesBefore - charterBranches);
        assertEq(bank.branchesOf(id), 0);
        assertEq(bank.pending(id), 0);
        assertEq(bank.mintedAt(id), 0);

        // NFT burned
        assertEq(charter.balanceOf(alice), 1);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, id));
        charter.ownerOf(id);

        // other half redistributed to the remaining branches (all of which belong to charter 1)
        uint256 remainingBranches = branchesBefore - charterBranches;
        assertEq(bank.accPerBranch(), accBefore + redistributed * 1e18 / remainingBranches);
        uint256 pending1After = bank.pending(1);
        assertGe(pending1After, pending1Before);
        assertApproxEqAbs(pending1After - pending1Before, redistributed, remainingBranches, "redistribution reaches charter 1");
        assertTreasuryInvariant();
    }

    // ------------------------------------------------------------------ closing invariants

    function _finalInvariants() internal view {
        assertLe(token.totalSupply(), token.CAP());
        assertLe(bank.totalIssued(), bank.ISSUANCE_BUDGET());
        assertEq(address(hook).balance, 0);
        assertEq(address(router).balance, 0);
        assertEq(address(charter).balance, 0);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(token.balanceOf(address(treasury)), 0);
        assertEq(hook.totalEthOut(), sellGross4 + sellGross5);
        assertGt(hook.totalTaxed(), 0);
        assertEq(bank.totalBranches(), 2);
        assertEq(charter.totalMinted(), 2);
        assertEq(bank.totalFeesUnminted(), expectedUnminted);
        assertTreasuryInvariant();
    }
}
