// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {FixedPoint128} from "@uniswap/v4-core/src/libraries/FixedPoint128.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

import {BaseTest} from "./Base.t.sol";
import {Treasury} from "../src/Treasury.sol";
import {ThalerRouter} from "../src/ThalerRouter.sol";
import {ITreasury} from "../src/interfaces/ITreasury.sol";
import {IThalerRouter} from "../src/interfaces/IThalerRouter.sol";
import {ICentralBank} from "../src/interfaces/ICentralBank.sol";

/// @dev plain contract that forwards ETH with a raw call (Treasury.receive from a contract sender)
contract EthSender {
    constructor() payable {}

    function send(address to, uint256 amount) external returns (bool ok) {
        (ok,) = to.call{value: amount}("");
    }
}

/// @notice Treasury: allocation split, receive, buyback + burn, POL compounding, genesis one-shots,
///         team claim, the balance >= vaults invariant, and the router's revert / sell paths.
contract TreasuryTest is BaseTest {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 internal constant BPS = 1e4;
    int24 internal constant TICK_LOWER = -887200;
    int24 internal constant TICK_UPPER = 887200;

    /// @dev the fixture's PoolManager seen through its interface, for StateLibrary reads
    IPoolManager internal ipm;

    function setUp() public override {
        // Foundry starts at timestamp 1; the tick clock (lastTick + 1h) needs a real-world genesis
        vm.warp(1_700_000_000);
        super.setUp();
        ipm = IPoolManager(address(pm));
    }

    /// @dev everything a `tick()` emitted, decoded from the logs
    struct TickLog {
        uint256 buybacks;
        uint256 bbEth;
        uint256 bbThaler;
        uint256 compounds;
        uint256 polEth;
        uint256 polThaler;
        uint128 polLiq;
        uint256 polBurn;
        uint256 swaps; // PoolManager.Swap events with the treasury as sender
        uint256 swapSpent; // ETH the pool took from the treasury across those swaps
        uint256 swapGot; // THALER the pool paid the treasury across those swaps
        uint256 mods; // PoolManager.ModifyLiquidity events with the treasury as sender
        int256 liqDelta;
    }

    // ================================================================== allocate

    function test_AllocateSplitExpansion() public {
        buy(bob, 0.1 ether); // 90% launch tax -> 0.09 ETH lands in unallocated
        _send(alice, 1 ether);
        uint256 a = treasury.unallocated();
        assertEq(a, 1.09 ether, "tax + direct send");
        assertEq(uint8(bank.regime()), uint8(ICentralBank.Regime.Expansion));

        uint256 toTeam = a * treasury.TEAM_BPS() / BPS;
        uint256 toPol = a * treasury.POL_BPS() / BPS;
        uint256 toActive = a - toTeam - toPol;
        assertEq(toTeam, 0.1635 ether);
        assertEq(toPol, 0.1635 ether);
        assertEq(toActive, 0.763 ether);
        assertEq(toActive, a * treasury.ACTIVE_BPS() / BPS, "70/15/15");

        uint256 polBefore = treasury.polVault();
        assertEq(treasury.expansionVault(), 0);
        assertEq(treasury.contractionVault(), 0);
        assertEq(treasury.teamVault(), 0);

        vm.expectEmit(address(treasury));
        emit ITreasury.Allocated(a, toActive, toPol, toTeam, false);
        treasury.allocate();

        assertEq(treasury.expansionVault(), toActive, "active share -> expansion vault");
        assertEq(treasury.contractionVault(), 0, "contraction vault untouched");
        assertEq(treasury.polVault(), polBefore + toPol);
        assertEq(treasury.teamVault(), toTeam);
        assertEq(treasury.unallocated(), 0);
        assertTreasuryInvariant();

        // nothing to allocate: no-op, no event
        vm.recordLogs();
        treasury.allocate();
        assertEq(vm.getRecordedLogs().length, 0, "empty allocate emits nothing");
        assertEq(treasury.expansionVault(), toActive);
        assertEq(treasury.polVault(), polBefore + toPol);
        assertEq(treasury.teamVault(), toTeam);
        assertTreasuryInvariant();
    }

    function test_AllocateSplitContraction() public {
        _enterContraction(0.1 ether);
        _send(alice, 1 ether);
        uint256 a = treasury.unallocated();
        assertGt(a, 1 ether, "buy tax + sell tax + direct send");

        uint256 toTeam = a * treasury.TEAM_BPS() / BPS;
        uint256 toPol = a * treasury.POL_BPS() / BPS;
        uint256 toActive = a - toTeam - toPol;
        uint256 polBefore = treasury.polVault();
        assertEq(treasury.expansionVault(), 0);
        assertEq(treasury.contractionVault(), 0);

        vm.expectEmit(address(treasury));
        emit ITreasury.Allocated(a, toActive, toPol, toTeam, true);
        treasury.allocate();

        assertEq(treasury.contractionVault(), toActive, "active share -> contraction vault");
        assertEq(treasury.expansionVault(), 0, "expansion vault untouched");
        assertEq(treasury.polVault(), polBefore + toPol);
        assertEq(treasury.teamVault(), toTeam);
        assertEq(treasury.unallocated(), 0);
        assertEq(toActive + toPol + toTeam, a, "split is exhaustive");
        assertTreasuryInvariant();
    }

    // ================================================================== receive

    function test_ReceiveNeverReverts() public {
        assertEq(treasury.unallocated(), 0);
        uint256 balBefore = address(treasury).balance;

        // EOA, non-zero
        _send(alice, 1 ether);
        assertEq(treasury.unallocated(), 1 ether);

        // EOA, zero value
        _send(alice, 0);
        assertEq(treasury.unallocated(), 1 ether);

        // contract sender
        EthSender s = new EthSender{value: 0.5 ether}();
        assertTrue(s.send(address(treasury), 0.5 ether), "receive from a contract");
        assertEq(treasury.unallocated(), 1.5 ether);

        // after an allocation the counter restarts from zero
        treasury.allocate();
        assertEq(treasury.unallocated(), 0);
        _send(bob, 3 wei);
        assertEq(treasury.unallocated(), 3 wei);

        assertEq(address(treasury).balance, balBefore + 1.5 ether + 3 wei, "every wei received is held");
        assertTreasuryInvariant();
    }

    // ================================================================== tick: buyback

    function test_TickBuybackVaultLimited() public {
        _enterContraction(0.02 ether);
        uint256 a = treasury.unallocated();
        uint256 conAfterAlloc = a - a * treasury.TEAM_BPS() / BPS - a * treasury.POL_BPS() / BPS;
        uint256 byVault = conAfterAlloc * treasury.BUYBACK_VAULT_BPS() / BPS;
        uint256 byReserve = treasury.poolEthReserve() * treasury.BUYBACK_RESERVE_BPS() / BPS;
        assertLt(byVault, byReserve, "10% of the vault is the binding cap");
        uint256 expected = byVault;
        assertGt(expected, 0);

        uint256 burnedBefore = token.totalBurned();
        uint256 supplyBefore = token.totalSupply();
        (uint256 inBefore, uint256 outBefore) = hook.flowOf(bank.currentEpoch());
        assertEq(treasury.lastTick(), 0);

        vm.recordLogs();
        treasury.tick();
        TickLog memory L = _parse(vm.getRecordedLogs());

        assertEq(L.buybacks, 1, "one buyback");
        assertEq(L.bbEth, expected, "buyback = 10% of contraction vault");
        assertGt(L.bbThaler, 0);
        assertEq(treasury.contractionVault(), conAfterAlloc - expected, "vault debited by exactly the ETH spent");
        assertEq(treasury.totalEthSpentOnBuybacks(), expected);
        assertEq(treasury.totalBoughtBack(), L.bbThaler);
        assertEq(treasury.lastTick(), vm.getBlockTimestamp());

        // all THALER bought is burned (the POL compound in the same tick burns its own leftover)
        assertEq(token.totalBurned() - burnedBefore, L.bbThaler + L.polBurn, "everything bought is burned");
        assertEq(token.totalSupply(), supplyBefore - L.bbThaler - L.polBurn);
        assertEq(token.balanceOf(address(treasury)), 0, "treasury keeps no THALER");

        // the treasury is tax-exempt and its swaps are not flow
        (uint256 inAfter, uint256 outAfter) = hook.flowOf(bank.currentEpoch());
        assertEq(inAfter, inBefore);
        assertEq(outAfter, outBefore);

        // next tick would again be vault-limited on the smaller vault
        assertEq(treasury.nextBuybackAmount(), (conAfterAlloc - expected) * treasury.BUYBACK_VAULT_BPS() / BPS);
        assertTreasuryInvariant();
    }

    function test_TickBuybackReserveLimited() public {
        _enterContraction(0.1 ether);
        _send(alice, 1 ether);
        uint256 a = treasury.unallocated();
        uint256 conAfterAlloc = a - a * treasury.TEAM_BPS() / BPS - a * treasury.POL_BPS() / BPS;

        // poolEthReserve() == liquidity * 2^96 / sqrtPrice
        (uint160 sqrtP,,,) = ipm.getSlot0(poolId);
        uint256 reserve = FullMath.mulDiv(ipm.getLiquidity(poolId), FixedPoint96.Q96, sqrtP);
        assertEq(treasury.poolEthReserve(), reserve, "reserve formula");
        assertApproxEqRel(reserve, SEED_ETH, 2e16, "reserve close to the 1 ETH seed");

        uint256 byVault = conAfterAlloc * treasury.BUYBACK_VAULT_BPS() / BPS;
        uint256 byReserve = reserve * treasury.BUYBACK_RESERVE_BPS() / BPS;
        assertGt(byVault, byReserve, "0.2% of the pool reserve is the binding cap");
        uint256 expected = byReserve;

        uint256 burnedBefore = token.totalBurned();
        uint256 polVault = treasury.polVault() + a * treasury.POL_BPS() / BPS;
        // the POL swap is capped like the buyback: at most 0.2% of the pre-tick reserve per interval
        uint256 polHalf = polVault / 2 < byReserve ? polVault / 2 : byReserve;
        assertEq(polHalf, byReserve, "0.2% of the pool reserve caps the POL swap too");
        // LP fees the position collects when it compounds: pending growth + the two treasury swaps
        (uint128 liq, uint256 d0, uint256 d1) = _pendingFeeGrowth();
        uint256 fee0 = FullMath.mulDiv(d0 + _feeGrowthOfSwap(expected, liq) + _feeGrowthOfSwap(polHalf, liq), liq, FixedPoint128.Q128);
        uint256 fee1 = FullMath.mulDiv(d1, liq, FixedPoint128.Q128);
        assertGt(fee1, 0, "bob's sell left THALER fees in the position");

        vm.recordLogs();
        treasury.tick();
        TickLog memory L = _parse(vm.getRecordedLogs());

        assertEq(L.buybacks, 1);
        assertEq(L.bbEth, expected, "buyback = 0.2% of pool ETH reserve");
        assertEq(L.swaps, 2, "buyback swap + POL swap");
        assertEq(L.swapSpent, expected + polHalf, "pool took exactly the buyback plus the POL half");
        assertEq(L.bbThaler + L.polThaler + L.polBurn, L.swapGot + fee1, "every THALER received (swaps + fees) is burned or deployed");
        assertEq(treasury.polVault(), polVault - polHalf + fee0 - L.polEth, "POL vault = unswapped half + ETH fees - deployed");
        assertGe(treasury.polVault(), treasury.POL_MIN_COMPOUND(), "the rest of the POL vault waits for the next interval");
        assertEq(treasury.contractionVault(), conAfterAlloc - expected);
        assertEq(treasury.totalEthSpentOnBuybacks(), expected);
        assertEq(treasury.totalBoughtBack(), L.bbThaler);
        assertEq(token.totalBurned() - burnedBefore, L.bbThaler + L.polBurn);
        assertEq(token.balanceOf(address(treasury)), 0);
        assertTreasuryInvariant();
    }

    function test_TickRespectsInterval() public {
        // expansion, empty contraction vault: no buyback but the clock still starts
        _send(alice, 0.001 ether);
        vm.recordLogs();
        treasury.tick();
        TickLog memory L0 = _parse(vm.getRecordedLogs());
        assertEq(L0.buybacks, 0, "nothing to buy back in expansion");
        assertEq(treasury.lastTick(), vm.getBlockTimestamp());

        _enterContraction(0.1 ether);
        _send(alice, 1 ether);
        uint256 t0 = vm.getBlockTimestamp();

        vm.recordLogs();
        treasury.tick();
        TickLog memory L1 = _parse(vm.getRecordedLogs());
        assertEq(L1.buybacks, 1, "first tick after the interval buys back");
        assertEq(treasury.lastTick(), t0);
        uint256 vaultAfter1 = treasury.contractionVault();
        uint256 spentAfter1 = treasury.totalEthSpentOnBuybacks();

        // one second short of the interval: no buyback, clock unchanged
        vm.warp(t0 + treasury.TICK_INTERVAL() - 1);
        vm.recordLogs();
        treasury.tick();
        TickLog memory L2 = _parse(vm.getRecordedLogs());
        assertEq(L2.buybacks, 0, "rate limited");
        assertEq(treasury.contractionVault(), vaultAfter1);
        assertEq(treasury.totalEthSpentOnBuybacks(), spentAfter1);
        assertEq(treasury.lastTick(), t0);

        // exactly the interval: buyback again, sized on the current vault / reserve
        vm.warp(t0 + treasury.TICK_INTERVAL());
        uint256 expected = treasury.nextBuybackAmount();
        assertGt(expected, 0);
        vm.recordLogs();
        treasury.tick();
        TickLog memory L3 = _parse(vm.getRecordedLogs());
        assertEq(L3.buybacks, 1);
        assertEq(L3.bbEth, expected);
        assertEq(treasury.contractionVault(), vaultAfter1 - expected);
        assertEq(treasury.totalEthSpentOnBuybacks(), spentAfter1 + expected);
        assertEq(treasury.lastTick(), t0 + treasury.TICK_INTERVAL());
        assertTreasuryInvariant();
    }

    // ================================================================== tick: POL compound

    function test_TickPolCompound() public {
        buy(bob, 0.1 ether); // pool receives 0.01 ETH (1% LP fee = 1e14 accrues to the POL position)
        uint256 polBefore = treasury.polVault();
        uint256 toPol = 0.09 ether * treasury.POL_BPS() / BPS;
        uint256 vault = polBefore + toPol;
        assertGe(vault, treasury.POL_MIN_COMPOUND());
        // per interval the compound swaps min(vault / 2, 0.2% of the pre-tick POL reserve) and pairs the same amount
        uint256 cap = treasury.poolEthReserve() * treasury.BUYBACK_RESERVE_BPS() / BPS;
        uint256 half = vault / 2 < cap ? vault / 2 : cap;
        assertEq(half, cap, "the reserve cap binds");
        assertLt(2 * half, vault, "the cap leaves part of the vault for later");

        uint128 liqBefore = treasury.polLiquidity();
        assertEq(ipm.getLiquidity(poolId), liqBefore, "POL is the only liquidity");
        uint256 balBefore = address(treasury).balance;
        uint256 burnedBefore = token.totalBurned();
        (uint128 liq, uint256 d0, uint256 d1) = _pendingFeeGrowth();
        assertEq(liq, liqBefore);
        assertEq(d1, 0, "no sells: no THALER fees");
        uint256 fee0 = FullMath.mulDiv(d0 + _feeGrowthOfSwap(half, liq), liq, FixedPoint128.Q128);

        vm.recordLogs();
        treasury.tick();
        TickLog memory L = _parse(vm.getRecordedLogs());

        assertEq(L.buybacks, 0, "expansion: no buyback");
        assertEq(L.compounds, 1, "one compound");
        assertEq(L.swaps, 1);
        assertEq(L.swapSpent, half, "exactly half the vault is swapped");
        assertGt(L.swapGot, 0);

        // liquidity grew in the position, the pool and the treasury's own counter, by the same amount
        assertGt(L.polLiq, 0);
        assertEq(L.mods, 1);
        assertEq(L.liqDelta, int256(uint256(L.polLiq)));
        assertEq(treasury.polLiquidity(), liqBefore + L.polLiq);
        assertEq(ipm.getLiquidity(poolId), liqBefore + L.polLiq, "pool liquidity grew by the added amount");
        (uint128 posLiq,,) = ipm.getPositionInfo(poolId, address(treasury), TICK_LOWER, TICK_UPPER, bytes32(0));
        assertEq(posLiq, liqBefore + L.polLiq, "full-range position holds it all");

        // THALER: everything swapped is either deployed or burned; nothing stays in the treasury
        assertEq(L.polThaler + L.polBurn, L.swapGot, "deployed + burned = received");
        assertEq(token.totalBurned() - burnedBefore, L.polBurn, "leftover THALER burned");
        assertEq(token.balanceOf(address(treasury)), 0);
        assertLt(L.polBurn * 1e6, L.polThaler, "THALER leftover is rounding dust");

        // ETH: the un-swapped half is deployed; the vault keeps only what the pool did not take
        // plus the ETH LP fees the position collected on the way (1% of all ETH swap volume so far)
        uint256 ethDrop = balBefore - address(treasury).balance;
        assertEq(treasury.polVault(), vault - ethDrop, "polVault == leftover ETH, nothing else moved");
        assertEq(treasury.polVault(), vault - half + fee0 - L.polEth, "polVault = unswapped half + fees - deployed");
        assertGe(L.polEth, half * 97 / 100, "nearly all of the paired amount is deployed");
        assertLe(L.polEth, half);
        assertApproxEqAbs(fee0, (0.01 ether + half) / 100, 4, "collected LP fee = 1% of ETH swap volume");
        assertGe(treasury.polVault(), treasury.POL_MIN_COMPOUND(), "the uncompounded remainder stays in the vault");
        assertTreasuryInvariant();

        // same interval: the vault is above the threshold but nothing compounds until TICK_INTERVAL passes
        uint256 polAfter = treasury.polVault();
        vm.recordLogs();
        treasury.tick();
        TickLog memory L2 = _parse(vm.getRecordedLogs());
        assertEq(L2.compounds, 0, "rate limited");
        assertEq(L2.swaps, 0);
        assertEq(treasury.polVault(), polAfter);
        assertEq(treasury.polLiquidity(), liqBefore + L.polLiq);
        assertTreasuryInvariant();

        // next interval: the remainder compounds, again sized by the reserve cap
        vm.warp(vm.getBlockTimestamp() + treasury.TICK_INTERVAL());
        uint256 cap2 = treasury.poolEthReserve() * treasury.BUYBACK_RESERVE_BPS() / BPS;
        uint256 half2 = polAfter / 2 < cap2 ? polAfter / 2 : cap2;
        vm.recordLogs();
        treasury.tick();
        TickLog memory L3 = _parse(vm.getRecordedLogs());
        assertEq(L3.compounds, 1, "compounds again after the interval");
        assertEq(L3.swapSpent, half2, "sized by the reserve cap again");
        assertEq(treasury.polLiquidity(), liqBefore + L.polLiq + L3.polLiq);
        assertEq(token.balanceOf(address(treasury)), 0);
        assertTreasuryInvariant();
    }

    /// @dev fees the position collects can exceed the ETH the compound deploys; the surplus comes back through
    ///      PoolManager.take -> receive() and must be booked once (POL vault), not also as a deposit
    function test_TickPolCompoundFeesAboveDeploy() public {
        // two days in the buy tax is near its floor: a 2 ETH buy pushes ~1.95 ETH through the pool and leaves
        // ~0.0195 ETH of LP fees in the position, far more than the ~0.0035 ETH the compound deploys
        vm.warp(genesis + 2 days);
        uint256 ethIn = 2 ether;
        uint256 tax = ethIn * hook.buyTaxBps() / BPS;
        buy(bob, ethIn);
        assertEq(treasury.unallocated(), tax);
        uint256 toPol = tax * treasury.POL_BPS() / BPS;
        uint256 toTeam = tax * treasury.TEAM_BPS() / BPS;
        uint256 vault = treasury.polVault() + toPol;
        uint256 half = vault / 2;
        (uint128 liq, uint256 d0,) = _pendingFeeGrowth();
        uint256 fee0 = FullMath.mulDiv(d0 + _feeGrowthOfSwap(half, liq), liq, FixedPoint128.Q128);
        assertGt(fee0, vault - half, "collected ETH fees exceed the half being deployed");
        uint256 expAfter = treasury.expansionVault() + tax - toPol - toTeam;
        uint256 teamAfter = treasury.teamVault() + toTeam;
        uint256 balBefore = address(treasury).balance;

        vm.recordLogs();
        treasury.tick();
        TickLog memory L = _parse(vm.getRecordedLogs());

        assertEq(L.compounds, 1);
        assertEq(L.swapSpent, half);
        assertEq(treasury.unallocated(), 0, "ETH taken from the pool is not a deposit");
        assertEq(treasury.polVault(), vault - half + fee0 - L.polEth, "fee surplus lands in the POL vault once");
        assertEq(address(treasury).balance, balBefore - half - L.polEth + fee0, "net ETH movement");
        assertEq(treasury.expansionVault(), expAfter);
        assertEq(treasury.teamVault(), teamAfter);
        assertEq(treasury.contractionVault(), 0);
        uint256 booked = treasury.unallocated() + treasury.expansionVault() + treasury.contractionVault()
            + treasury.polVault() + treasury.teamVault();
        assertEq(address(treasury).balance, booked, "balance == booked vaults exactly");
        assertEq(token.balanceOf(address(treasury)), 0);
        assertTreasuryInvariant();
    }

    function test_TickPolBelowThresholdNoCompound() public {
        uint256 polBefore = treasury.polVault();
        assertLt(polBefore, 1e12, "seed leftover is dust");
        uint128 liqBefore = treasury.polLiquidity();

        // 0.003 ETH -> 0.00045 ETH to POL: just under POL_MIN_COMPOUND
        _send(alice, 0.003 ether);
        uint256 toPol1 = 0.003 ether * treasury.POL_BPS() / BPS;
        assertEq(toPol1, 0.00045 ether);
        assertLt(polBefore + toPol1, treasury.POL_MIN_COMPOUND());

        vm.recordLogs();
        treasury.tick();
        TickLog memory L1 = _parse(vm.getRecordedLogs());
        assertEq(L1.compounds, 0, "below threshold: no compound");
        assertEq(L1.swaps, 0);
        assertEq(L1.mods, 0);
        assertEq(treasury.polVault(), polBefore + toPol1, "vault accumulates");
        assertEq(treasury.polLiquidity(), liqBefore);
        assertEq(ipm.getLiquidity(poolId), liqBefore);
        assertTreasuryInvariant();

        // another 0.001 ETH -> 0.00015 ETH to POL: over the threshold, compounds at the next interval
        _send(alice, 0.001 ether);
        uint256 vault = polBefore + toPol1 + 0.001 ether * treasury.POL_BPS() / BPS;
        assertGe(vault, treasury.POL_MIN_COMPOUND());
        vm.warp(vm.getBlockTimestamp() + treasury.TICK_INTERVAL());
        vm.recordLogs();
        treasury.tick();
        TickLog memory L2 = _parse(vm.getRecordedLogs());
        assertEq(L2.compounds, 1, "at threshold: compounds");
        assertEq(L2.swapSpent, vault / 2);
        assertEq(treasury.polLiquidity(), liqBefore + L2.polLiq);
        assertGt(L2.polLiq, 0);
        assertEq(token.balanceOf(address(treasury)), 0);
        assertTreasuryInvariant();
    }

    // ================================================================== genesis one-shots

    function test_InitializePoolOneShotAndOwnerOnly() public {
        PoolKey memory k = treasury.poolKey();
        assertTrue(treasury.poolInitialized());

        vm.expectRevert(Treasury.AlreadyInitialized.selector);
        treasury.initializePool(SQRT_PRICE_X96);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        treasury.initializePool(SQRT_PRICE_X96);

        // a fresh treasury: hook wiring is one-shot and required before the pool
        Treasury t2 = new Treasury(address(token), pm, address(bank), team);
        vm.expectRevert(Treasury.HookNotSet.selector);
        t2.initializePool(SQRT_PRICE_X96);
        vm.expectRevert(Treasury.ZeroAddress.selector);
        t2.setHook(address(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        t2.setHook(address(hook));
        t2.setHook(address(hook));
        vm.expectRevert(Treasury.HookAlreadySet.selector);
        t2.setHook(address(hook));
        // initializePool only records the key and the price: the pool itself is created inside seedLiquidity,
        // and the hook is bound to the original treasury, so a second treasury cannot launch through it
        t2.initializePool(SQRT_PRICE_X96);
        assertTrue(t2.poolInitialized());
        assertEq(t2.initSqrtPriceX96(), SQRT_PRICE_X96);
        vm.expectRevert(Treasury.AlreadyInitialized.selector);
        t2.initializePool(SQRT_PRICE_X96);
        deal(address(token), address(this), 1e18, true);
        token.approve(address(t2), 1e18);
        vm.expectRevert();
        t2.seedLiquidity{value: 0.01 ether}(1e18);
        assertFalse(t2.seeded());
        assertEq(t2.polLiquidity(), 0);
        assertEq(token.balanceOf(address(this)), 1e18, "reverted seed returned the THALER");

        // original state untouched
        PoolKey memory k2 = treasury.poolKey();
        assertEq(PoolId.unwrap(k2.toId()), PoolId.unwrap(k.toId()));
        assertTrue(treasury.poolInitialized());
    }

    function test_SeedLiquidityOneShotAndOwnerOnly() public {
        uint128 liqBefore = treasury.polLiquidity();
        uint256 polBefore = treasury.polVault();
        assertTrue(treasury.seeded());
        assertGt(liqBefore, 0);

        token.approve(address(treasury), 1e18);
        vm.expectRevert(Treasury.AlreadySeeded.selector);
        treasury.seedLiquidity{value: 0.01 ether}(1e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        treasury.seedLiquidity{value: 0.01 ether}(1e18);

        // a fresh treasury cannot seed before its pool exists
        Treasury t2 = new Treasury(address(token), pm, address(bank), team);
        vm.expectRevert(Treasury.NotInitialized.selector);
        t2.seedLiquidity{value: 0.01 ether}(1e18);
        assertFalse(t2.seeded());

        assertEq(treasury.polLiquidity(), liqBefore);
        assertEq(treasury.polVault(), polBefore);
        assertEq(ipm.getLiquidity(poolId), liqBefore);
        assertTreasuryInvariant();
    }

    // ================================================================== team

    function test_ClaimTeamSendsToTeam() public {
        _send(alice, 1 ether);
        treasury.allocate();
        uint256 toTeam = 0.15 ether;
        assertEq(treasury.teamVault(), toTeam);
        uint256 expBefore = treasury.expansionVault();
        uint256 polBefore = treasury.polVault();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        treasury.claimTeam();
        assertEq(treasury.teamVault(), toTeam);

        uint256 teamBefore = team.balance;
        uint256 balBefore = address(treasury).balance;
        vm.expectEmit(address(treasury));
        emit ITreasury.TeamClaimed(team, toTeam);
        treasury.claimTeam();

        assertEq(team.balance, teamBefore + toTeam, "team received the vault");
        assertEq(address(treasury).balance, balBefore - toTeam);
        assertEq(treasury.teamVault(), 0);
        assertEq(treasury.expansionVault(), expBefore, "other vaults untouched");
        assertEq(treasury.polVault(), polBefore);
        assertTreasuryInvariant();

        // empty claim: no transfer, no revert
        treasury.claimTeam();
        assertEq(team.balance, teamBefore + toTeam);
        assertEq(treasury.teamVault(), 0);
        assertTreasuryInvariant();
    }

    // ================================================================== invariant

    /// @dev random sequences of every user- and keeper-facing operation; the treasury's ETH balance must
    ///      cover the booked vaults after each one and it must never hold THALER between operations
    function testFuzz_InvariantAcrossOperations(uint256 seed) public {
        uint256 t = vm.getBlockTimestamp();
        for (uint256 i = 0; i < 12; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 op = r % 8;
            uint256 x = r >> 16;
            if (op == 0) {
                buy(bob, bound(x, 0.001 ether, 3 ether));
            } else if (op == 1) {
                buy(alice, bound(x, 1, 0.01 ether));
            } else if (op == 2) {
                uint256 b = token.balanceOf(bob);
                if (b > 0) sell(bob, bound(x, 1, b));
            } else if (op == 3) {
                _send(carol, bound(x, 0, 2 ether));
            } else if (op == 4) {
                treasury.allocate();
            } else if (op == 5) {
                t += bound(x, 0, 2 * EPOCH);
                vm.warp(t);
                bank.rollEpochs();
                treasury.tick();
            } else if (op == 6) {
                t += treasury.TICK_INTERVAL();
                vm.warp(t);
                treasury.tick();
            } else {
                treasury.claimTeam();
            }
            assertTreasuryInvariant();
            assertEq(token.balanceOf(address(treasury)), 0, "no THALER parked in the treasury");
            assertEq(address(router).balance, 0);
            assertEq(address(hook).balance, 0);
        }
    }

    // ================================================================== router

    function test_RouterDeadlineAndMinOutRevert() public {
        uint256 now_ = vm.getBlockTimestamp();
        uint256 bobEth = bob.balance;
        uint256 unalloc = treasury.unallocated();

        // deadline in the past
        vm.prank(bob);
        vm.expectRevert(ThalerRouter.Expired.selector);
        router.swapExactIn{value: 0.1 ether}(true, 0.1 ether, 0, bob, now_ - 1);

        // wrong msg.value on both sides, zero amount, zero recipient
        vm.prank(bob);
        vm.expectRevert(ThalerRouter.WrongValue.selector);
        router.swapExactIn{value: 0.09 ether}(true, 0.1 ether, 0, bob, now_);
        vm.prank(bob);
        vm.expectRevert(ThalerRouter.WrongValue.selector);
        router.swapExactIn{value: 1 wei}(false, 1e18, 0, bob, now_);
        vm.prank(bob);
        vm.expectRevert(ThalerRouter.ZeroAmount.selector);
        router.swapExactIn(true, 0, 0, bob, now_);
        vm.prank(bob);
        vm.expectRevert(ThalerRouter.ZeroAddress.selector);
        router.swapExactIn{value: 0.1 ether}(true, 0.1 ether, 0, address(0), now_);

        // minOut one above what the pool pays: exact error args
        uint256 snap = vm.snapshotState();
        uint256 out = buy(bob, 0.1 ether);
        vm.revertToState(snap);
        assertGt(out, 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ThalerRouter.InsufficientOutput.selector, out, out + 1));
        router.swapExactIn{value: 0.1 ether}(true, 0.1 ether, out + 1, bob, now_);

        // every revert left no trace
        assertEq(bob.balance, bobEth);
        assertEq(token.balanceOf(bob), 0);
        assertEq(treasury.unallocated(), unalloc);
        assertEq(address(router).balance, 0);

        // deadline == now and minOut == out both pass
        vm.prank(bob);
        uint256 got = router.swapExactIn{value: 0.1 ether}(true, 0.1 ether, out, bob, now_);
        assertEq(got, out);

        // same checks on the sell side
        uint256 sellIn = got / 2;
        snap = vm.snapshotState();
        uint256 outSell = sell(bob, sellIn);
        vm.revertToState(snap);
        assertGt(outSell, 0);
        vm.startPrank(bob);
        token.approve(address(router), sellIn);
        vm.expectRevert(ThalerRouter.Expired.selector);
        router.swapExactIn(false, sellIn, 0, bob, now_ - 1);
        vm.expectRevert(abi.encodeWithSelector(ThalerRouter.InsufficientOutput.selector, outSell, outSell + 1));
        router.swapExactIn(false, sellIn, outSell + 1, bob, now_);
        vm.stopPrank();
        assertEq(token.balanceOf(bob), got, "reverted sell returned the THALER");
        assertEq(token.balanceOf(address(router)), 0);
        assertTreasuryInvariant();
    }

    /// @dev the hook takes the buy tax from the manager inside the swap, so the router pays the input first
    function test_RouterBuyTaxAbovePoolReserve() public {
        uint256 pmBefore = address(pm).balance;
        uint256 ethIn = 3 ether;
        uint256 tax = ethIn * hook.buyTaxBps() / BPS;
        assertEq(tax, 2.7 ether);
        assertGt(tax, pmBefore, "tax exceeds every wei the pool held before the buy");

        uint256 out = buy(bob, ethIn);

        assertGt(out, 0);
        assertEq(token.balanceOf(bob), out);
        assertEq(bob.balance, 100 ether - ethIn, "full input paid");
        assertEq(treasury.unallocated(), tax, "tax reached the treasury");
        assertEq(address(pm).balance, pmBefore + ethIn - tax, "pool keeps the net input");
        assertEq(address(router).balance, 0);
        (uint256 in0,) = hook.flowOf(bank.currentEpoch());
        assertEq(in0, ethIn - tax);
        assertTreasuryInvariant();
    }

    function test_RouterSellWithApproval() public {
        uint256 got = buy(bob, 0.1 ether);
        uint256 sellIn = got / 2;
        uint256 unallocBefore = treasury.unallocated();
        uint256 pmBefore = address(pm).balance;
        uint256 bobEth = bob.balance;
        uint256 carolEth = carol.balance;

        // no allowance: the token's own error bubbles through the router
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 0, sellIn)
        );
        router.swapExactIn(false, sellIn, 0, bob, type(uint256).max);

        // exact allowance, proceeds to a third party
        vm.startPrank(bob);
        token.approve(address(router), sellIn);
        vm.recordLogs();
        uint256 out = router.swapExactIn(false, sellIn, 0, carol, type(uint256).max);
        vm.stopPrank();

        (, uint256 gross) = hook.flowOf(bank.currentEpoch());
        uint256 tax = gross * hook.sellTaxBps() / BPS;
        assertGt(gross, 0);
        assertEq(out, gross - tax, "swapper gets gross ETH out minus the sell tax");
        assertEq(carol.balance, carolEth + out, "output goes to `to`");
        assertEq(bob.balance, bobEth, "payer's ETH untouched");
        assertEq(token.balanceOf(bob), got - sellIn, "exactly amountIn pulled");
        assertEq(token.allowance(bob, address(router)), 0, "allowance consumed");
        assertEq(treasury.unallocated(), unallocBefore + tax, "sell tax lands in the treasury");
        assertEq(address(pm).balance, pmBefore - gross, "pool paid the gross amount");
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(address(router).balance, 0);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(router)) continue;
            assertEq(logs[i].topics[0], IThalerRouter.Swapped.selector);
            assertEq(address(uint160(uint256(logs[i].topics[1]))), bob);
            assertEq(uint256(logs[i].topics[2]), 0, "buy = false");
            (uint256 eAmountIn, uint256 eAmountOut, address eTo) = abi.decode(logs[i].data, (uint256, uint256, address));
            assertEq(eAmountIn, sellIn);
            assertEq(eAmountOut, out);
            assertEq(eTo, carol);
            seen = true;
        }
        assertTrue(seen, "Swapped emitted");
        assertTreasuryInvariant();
    }

    // ================================================================== helpers

    /// @dev buy in epoch 0, sell everything in epoch 1, roll at epoch 2: last completed epoch has net outflow
    function _enterContraction(uint256 buyEth) internal {
        buy(bob, buyEth);
        vm.warp(genesis + EPOCH);
        sell(bob, token.balanceOf(bob));
        vm.warp(genesis + 2 * EPOCH);
        bank.rollEpochs();
        assertEq(uint8(bank.regime()), uint8(ICentralBank.Regime.Contraction), "regime is Contraction");
        assertEq(bank.lastRolledEpoch(), 1);
    }

    function _send(address from, uint256 amount) internal {
        vm.prank(from);
        (bool ok,) = address(treasury).call{value: amount}("");
        assertTrue(ok, "treasury.receive reverted");
    }

    /// @dev fee growth the POL position has not collected yet (what modifyLiquidity will pay out)
    function _pendingFeeGrowth() internal view returns (uint128 liq, uint256 d0, uint256 d1) {
        uint256 last0;
        uint256 last1;
        (liq, last0, last1) = ipm.getPositionInfo(poolId, address(treasury), TICK_LOWER, TICK_UPPER, bytes32(0));
        (uint256 in0, uint256 in1) = ipm.getFeeGrowthInside(poolId, TICK_LOWER, TICK_UPPER);
        unchecked {
            d0 = in0 - last0;
            d1 = in1 - last1;
        }
    }

    /// @dev fee growth a 1% exact-input ETH swap adds when it stops short of the price limit (v4 SwapMath)
    function _feeGrowthOfSwap(uint256 ethIn, uint128 liq) internal pure returns (uint256) {
        uint256 feeAmount = ethIn - FullMath.mulDiv(ethIn, 1e6 - 10_000, 1e6);
        return FullMath.mulDiv(feeAmount, FixedPoint128.Q128, liq);
    }

    function _parse(Vm.Log[] memory logs) internal view returns (TickLog memory L) {
        bytes32 buybackSig = ITreasury.Buyback.selector;
        bytes32 polSig = ITreasury.PolCompounded.selector;
        bytes32 swapSig = IPoolManager.Swap.selector;
        bytes32 modSig = IPoolManager.ModifyLiquidity.selector;
        for (uint256 i = 0; i < logs.length; ++i) {
            Vm.Log memory lg = logs[i];
            if (lg.emitter == address(treasury)) {
                if (lg.topics[0] == buybackSig) {
                    (L.bbEth, L.bbThaler) = abi.decode(lg.data, (uint256, uint256));
                    L.buybacks++;
                } else if (lg.topics[0] == polSig) {
                    (L.polEth, L.polThaler, L.polLiq, L.polBurn) =
                        abi.decode(lg.data, (uint256, uint256, uint128, uint256));
                    L.compounds++;
                }
            } else if (lg.emitter == address(pm) && lg.topics.length == 3) {
                if (address(uint160(uint256(lg.topics[2]))) != address(treasury)) continue;
                if (lg.topics[0] == swapSig) {
                    (int128 a0, int128 a1,,,,) = abi.decode(lg.data, (int128, int128, uint160, uint128, int24, uint24));
                    assertLe(a0, 0, "treasury only sells ETH");
                    assertGe(a1, 0, "treasury only receives THALER");
                    L.swapSpent += uint256(-int256(a0));
                    L.swapGot += uint256(int256(a1));
                    L.swaps++;
                } else if (lg.topics[0] == modSig) {
                    (int24 lo, int24 hi, int256 dl,) = abi.decode(lg.data, (int24, int24, int256, bytes32));
                    assertEq(lo, TICK_LOWER);
                    assertEq(hi, TICK_UPPER);
                    L.liqDelta += dl;
                    L.mods++;
                }
            }
        }
    }
}
