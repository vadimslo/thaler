// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {BaseTest} from "./Base.t.sol";
import {CentralBank} from "../src/CentralBank.sol";
import {ThalerToken} from "../src/ThalerToken.sol";
import {ICentralBank} from "../src/interfaces/ICentralBank.sol";

/// @dev Stand-in for FlowHook: tests set the recorded flow per epoch directly.
contract MockHook {
    mapping(uint256 => uint256) internal _in;
    mapping(uint256 => uint256) internal _out;

    function set(uint256 epoch, uint256 ethIn, uint256 ethOut) external {
        _in[epoch] = ethIn;
        _out[epoch] = ethOut;
    }

    function flowOf(uint256 epoch) external view returns (uint256 ethIn, uint256 ethOut) {
        return (_in[epoch], _out[epoch]);
    }
}

/// @dev Stand-in for CharterNFT: owner registry plus the two calls the bank makes.
contract MockCharter {
    mapping(uint256 => address) public ownerOf;
    address public bank;

    function setBank(address bank_) external {
        bank = bank_;
    }

    function mint(uint256 tokenId, address to) external {
        ownerOf[tokenId] = to;
        ICentralBank(bank).registerCharter(tokenId, to);
    }

    function burnFromBank(uint256 tokenId) external {
        require(msg.sender == bank, "not bank");
        delete ownerOf[tokenId];
    }
}

/// @notice CentralBank unit tests: accrual, licenses, the withdrawal fee, resolve, budget cap and the multiplier policy.
///         Tests that need controlled flow or controlled branch counts use a bank wired to the mocks above.
contract CentralBankTest is BaseTest {
    uint256 internal constant BPS = 1e4;
    uint256 internal constant BASE = 700_000e18;
    uint256 internal constant BUDGET = 900_000_000e18;
    /// @dev day boundary so `block.timestamp % 1 days == 0` at genesis
    uint256 internal constant DAY0 = 20_000 days;
    /// @dev issuance per second at 1.00x
    uint256 internal constant IPS = BASE / 1 days;

    address internal dave = makeAddr("dave");

    // mock-wired bank (built per test by _mockBank)
    ThalerToken internal token2;
    MockCharter internal charter2;
    MockHook internal flow;
    CentralBank internal bank2;

    function setUp() public override {
        vm.warp(DAY0);
        super.setUp();
        vm.deal(dave, 100 ether);
        assertEq(genesis, DAY0);
    }

    // ------------------------------------------------------------------ helpers

    /// @dev Fresh token + mock charter + mock hook + bank, deployed now (GENESIS = block.timestamp).
    function _mockBank() internal {
        token2 = new ThalerToken();
        charter2 = new MockCharter();
        flow = new MockHook();
        bank2 = new CentralBank(address(token2), address(charter2), EPOCH, RESOLVE_FEE_PERIOD);
        token2.setCentralBank(address(bank2));
        charter2.setBank(address(bank2));
        bank2.setHook(address(flow));
    }

    /// @dev Warps so that epochs [0, n) are complete and rolls them.
    function _rollTo(uint256 n) internal {
        vm.warp(bank2.GENESIS() + n * EPOCH);
        bank2.rollEpochs();
    }

    /// @dev Gives `user` THALER (supply adjusted) and approves the bank for all of it.
    function _fund(address user, uint256 amount) internal {
        deal(address(token), user, amount, true);
        vm.prank(user);
        token.approve(address(bank), type(uint256).max);
    }

    function _mintCharters(address user, uint256 qty) internal {
        vm.prank(user);
        charter.mintFounding{value: qty * FOUNDING_PRICE}(qty);
    }

    function _open(address user, uint256 tokenId) internal returns (uint256 price) {
        price = bank.licensePrice();
        vm.prank(user);
        bank.openBranch(tokenId);
    }

    // ------------------------------------------------------------------ accrual

    /// Charter 1 keeps one branch, charter 2 opens a second at t0 and charter 1 catches up a day later.
    /// Pending is checked against the accumulator formula at every step, then withdrawn exactly.
    function test_AccrualTwoChartersUnequalBranches() public {
        uint256 t0 = genesis;
        _mintCharters(alice, 2);
        _fund(alice, 10_000_000e18);

        // acc == 0 here, so opening now settles nothing: c1 = 1 branch, c2 = 2 branches, total 3
        _open(alice, 2);
        assertEq(bank.totalBranches(), 3);
        assertEq(bank.branchesOf(1), 1);
        assertEq(bank.branchesOf(2), 2);
        assertEq(bank.issuancePerSecond(), IPS);
        assertEq(bank.issuancePerBranchPerDay(), BASE / 3);

        // phase 1: one day at 1:2
        uint256 t1 = t0 + 1 days;
        vm.warp(t1);
        uint256 acc1 = IPS * 1 days * 1e18 / 3;
        assertEq(bank.pending(1), acc1 / 1e18, "c1 after day 1");
        assertEq(bank.pending(2), 2 * acc1 / 1e18, "c2 after day 1");
        // the two shares add up to the day's issuance at 1.00x (rounding only)
        assertApproxEqAbs(bank.pending(1) + bank.pending(2), BASE, 1e6);

        // charter 1 opens a branch: its accrual so far is settled into `owed`, debt reset at 2 branches
        _open(alice, 1);
        assertEq(bank.accPerBranch(), acc1, "acc booked at open");
        assertEq(bank.totalBranches(), 4);
        assertEq(bank.pending(1), acc1 / 1e18, "settle keeps pending");

        // phase 2: twelve hours at 2:2 over four branches
        uint256 t2 = t1 + 12 hours;
        vm.warp(t2);
        uint256 acc2 = acc1 + IPS * 12 hours * 1e18 / 4;
        uint256 owed1 = acc1 / 1e18;
        uint256 debt1 = 2 * acc1 / 1e18;
        uint256 exp1 = owed1 + 2 * acc2 / 1e18 - debt1;
        uint256 exp2 = 2 * acc2 / 1e18;
        assertEq(bank.pending(1), exp1, "c1 after phase 2");
        assertEq(bank.pending(2), exp2, "c2 after phase 2");
        assertGt(exp2, exp1);

        // withdraw mints pending minus the fee, once; c2 (the other 2 of 4 branches) receives half the fee
        uint256 fee1 = exp1 * feeBpsAt(t2 - t0) / BPS;
        uint256 balBefore = token.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.Withdrawn(1, alice, exp1 - fee1, fee1);
        vm.prank(alice);
        uint256 minted = bank.withdraw(1);
        assertEq(minted, exp1 - fee1);
        assertEq(token.balanceOf(alice) - balBefore, minted);
        assertEq(bank.totalIssued(), minted);
        assertEq(bank.pending(1), 0);
        assertEq(bank.pending(2), exp2 + fee1 / 2, "c2 receives the redistributed half of c1's fee");
        assertEq(bank.totalFeesUnminted(), fee1 - fee1 / 2);
        vm.prank(alice);
        assertEq(bank.withdraw(1), 0, "nothing left");

        // only the owner can withdraw
        vm.expectRevert(abi.encodeWithSignature("NotCharterOwner()"));
        vm.prank(bob);
        bank.withdraw(2);
    }

    // ------------------------------------------------------------------ license price

    /// Opens at 2x last close, 4h half-life toward the floor, resets at the day boundary.
    function test_LicensePriceOpensAtTwiceLastCloseAndDecays() public {
        uint256 t0 = genesis;
        _mintCharters(alice, 1);
        _fund(alice, 100_000_000e18);

        // no close yet: ask == floor all day (1 branch -> floor = 2 * 700k)
        assertEq(bank.lastLicenseClose(), 0);
        assertEq(bank.licensePrice(), 1_400_000e18);
        vm.warp(t0 + 3 hours);
        assertEq(bank.licensePrice(), 1_400_000e18, "flat at floor before any close");

        uint256 paid = _open(alice, 1);
        assertEq(paid, 1_400_000e18);
        assertEq(bank.lastLicenseClose(), 1_400_000e18);

        // now 2 branches: floor 700k, start 2.8M, 3h into the day -> gap 2.1M * (1 - 3/8)
        assertEq(bank.licensePrice(), 2_012_500e18, "3h");
        vm.warp(t0 + 4 hours);
        assertEq(bank.licensePrice(), 1_750_000e18, "one half-life");
        vm.warp(t0 + 6 hours);
        assertEq(bank.licensePrice(), 1_487_500e18, "1.5 half-lives");
        vm.warp(t0 + 8 hours);
        assertEq(bank.licensePrice(), 1_225_000e18, "two half-lives");
        vm.warp(t0 + 23 hours);
        assertEq(bank.licensePrice(), 741_015_625_000_000_000_000_000, "23h: 5 halvings + 3/8 of the sixth");
        vm.warp(t0 + 1 days - 1);
        assertGt(bank.licensePrice(), 700_000e18);
        assertLt(bank.licensePrice(), 741_015_625_000_000_000_000_000);

        // day boundary: back to 2x last close, then the same curve
        vm.warp(t0 + 1 days);
        assertEq(bank.licensePrice(), 2_800_000e18, "reopens at 2x last close");
        vm.warp(t0 + 1 days + 4 hours);
        assertEq(bank.licensePrice(), 1_750_000e18);

        // a close mid-day restarts from 2x that close at the current elapsed time, with the new floor
        paid = _open(alice, 1);
        assertEq(paid, 1_750_000e18);
        uint256 floor3 = 2 * (BASE / 3);
        assertEq(floor3, 466_666_666_666_666_666_666_666);
        assertEq(bank.licensePrice(), floor3 + (3_500_000e18 - floor3) / 2, "restart from 3.5M at 4h");
    }

    /// floor = max(2 days of one branch's issuance, 1e18): checked at 0, 1 and 2 branches on the real bank
    /// and at MULT_MIN with 10 branches on the mock bank.
    function test_LicenseFloorTwoDaysOfBranchIssuance() public {
        assertEq(bank.LICENSE_MIN_PRICE(), 1e18);
        assertEq(bank.LICENSE_FLOOR_DAYS(), 2);
        assertEq(bank.LICENSE_HALF_LIFE(), 4 hours);
        assertEq(bank.LICENSE_OPEN_MULTIPLE(), 2);

        // no charters: floor uses the whole issuance as one branch
        assertEq(bank.totalBranches(), 0);
        assertEq(bank.issuancePerBranchPerDay(), BASE);
        assertEq(bank.licensePrice(), 1_400_000e18);

        _mintCharters(alice, 1);
        assertEq(bank.licensePrice(), 1_400_000e18);
        _mintCharters(bob, 1);
        assertEq(bank.issuancePerBranchPerDay(), 350_000e18);
        assertEq(bank.licensePrice(), 700_000e18);

        // mock bank at MULT_MIN with 10 branches: 2 * 140k / 10
        _mockBank();
        for (uint256 e = 0; e < 8; ++e) {
            flow.set(e, 0, 1 ether);
        }
        flow.set(8, 1 ether, 0); // stops the trailing cascade
        _rollTo(9);
        assertEq(bank2.multiplier(), 2_000);
        for (uint256 i = 1; i <= 10; ++i) {
            charter2.mint(i, alice);
        }
        assertEq(bank2.issuancePerBranchPerDay(), 14_000e18);
        assertEq(bank2.licensePrice(), 28_000e18);
        // the 1e18 minimum is unreachable with published params (needs > 280_000 branches at MULT_MIN)
        assertGt(bank2.licensePrice(), 1e18);
    }

    /// 100 licenses per day across all charters, then NoLicensesToday; a new day reopens the window.
    function test_LicensesPerDayCap() public {
        assertEq(bank.LICENSES_PER_DAY(), 100);
        address[4] memory wallets = [alice, bob, carol, dave];
        for (uint256 w = 0; w < 4; ++w) {
            _mintCharters(wallets[w], 3); // ids 1..12
            // asks double on every close within a day, so 100 closes need an astronomical balance
            _fund(wallets[w], 2 ** 200);
        }
        assertEq(bank.licensesRemainingToday(), 100);

        for (uint256 i = 0; i < 100; ++i) {
            uint256 tokenId = 1 + (i % 12);
            _open(wallets[(i % 12) / 3], tokenId);
            assertEq(bank.licensesRemainingToday(), 99 - i);
        }
        assertEq(bank.licensesRemainingToday(), 0);
        assertEq(bank.totalBranches(), 112);
        assertEq(bank.branchesOf(1), 10);
        assertEq(bank.branchesOf(12), 9);

        vm.expectRevert(abi.encodeWithSignature("NoLicensesToday()"));
        vm.prank(dave);
        bank.openBranch(12);

        // still capped one second before midnight
        vm.warp(genesis + 1 days - 1);
        assertEq(bank.licensesRemainingToday(), 0);
        vm.expectRevert(abi.encodeWithSignature("NoLicensesToday()"));
        vm.prank(dave);
        bank.openBranch(12);

        // new day: window resets
        vm.warp(genesis + 1 days);
        assertEq(bank.licensesRemainingToday(), 100);
        _open(dave, 12);
        assertEq(bank.licensesRemainingToday(), 99);
        assertEq(bank.branchesOf(12), 10);
    }

    // ------------------------------------------------------------------ openBranch

    /// Every license burns exactly the ask from the caller; the tenth branch is refused.
    function test_OpenBranchBurnsThalerAndEnforcesMaxBranches() public {
        assertEq(bank.MAX_BRANCHES(), 10);
        _mintCharters(alice, 1);

        uint256 burnedBefore = token.totalBurned();
        uint256 totalPaid;
        for (uint8 i = 1; i < 10; ++i) {
            uint256 price = bank.licensePrice();
            _fund(alice, price);
            uint256 supplyBefore = token.totalSupply();

            vm.expectEmit(true, false, false, true, address(bank));
            emit ICentralBank.BranchOpened(1, i + 1, price);
            vm.prank(alice);
            bank.openBranch(1);

            totalPaid += price;
            assertEq(token.balanceOf(alice), 0, "whole ask burned");
            assertEq(supplyBefore - token.totalSupply(), price, "supply shrinks by the ask");
            assertEq(token.totalBurned() - burnedBefore, totalPaid);
            assertEq(token.balanceOf(address(bank)), 0, "bank never holds THALER");
            assertEq(bank.lastLicenseClose(), price);
            assertEq(bank.branchesOf(1), i + 1);
            assertEq(bank.totalBranches(), i + 1);
        }
        assertEq(bank.branchesOf(1), 10);

        _fund(alice, bank.licensePrice());
        vm.expectRevert(abi.encodeWithSignature("MaxBranchesReached()"));
        vm.prank(alice);
        bank.openBranch(1);
        assertEq(token.balanceOf(alice), bank.licensePrice(), "nothing burned on revert");

        // only the owner, and only with allowance
        vm.expectRevert(abi.encodeWithSignature("NotCharterOwner()"));
        vm.prank(bob);
        bank.openBranch(1);

        _mintCharters(bob, 1);
        deal(address(token), bob, bank.licensePrice(), true);
        vm.expectRevert(); // ERC20InsufficientAllowance
        vm.prank(bob);
        bank.openBranch(2);
        assertEq(bank.branchesOf(2), 1);
    }

    // ------------------------------------------------------------------ withdrawal fee

    /// At age 0 the fee is 60%. A charter minted in the block another charter withdraws in receives half of that
    /// fee and, withdrawing at once, keeps 40% of it. Both halves of both fees are accounted to the wei.
    function test_WithdrawAtAgeZeroPaysFortyPercent() public {
        _mockBank();
        uint256 t0 = block.timestamp;
        charter2.mint(1, alice);
        vm.warp(t0 + 10 days);
        charter2.mint(2, bob); // age 0 from here on
        assertEq(bank2.withdrawFeeBps(2), 6_000);
        assertEq(bank2.resolveFeeBps(2), 6_000);
        assertEq(bank2.withdrawFeeBps(1), 2_777);

        // alice withdraws at day 10: half her fee goes to bob's one branch, half is unminted
        uint256 totalA = IPS * 10 days;
        assertEq(bank2.pending(1), totalA);
        uint256 feeA = totalA * 2_777 / BPS;
        uint256 redA = feeA / 2;
        vm.expectEmit(true, true, false, true, address(bank2));
        emit ICentralBank.Withdrawn(1, alice, totalA - feeA, feeA);
        vm.prank(alice);
        uint256 mintedA = bank2.withdraw(1);
        assertEq(mintedA, totalA - feeA);
        assertEq(bank2.pending(1), 0, "alice does not receive her own fee");
        assertEq(bank2.pending(2), redA, "bob receives the redistributed half");
        assertEq(bank2.accPerBranch(), totalA * 1e18 + redA * 1e18);
        assertEq(bank2.totalFeesUnminted(), feeA - redA);

        // bob withdraws at age 0: 60% fee, 40% kept; his fee splits the same way, half back to alice
        uint256 feeB = redA * 6_000 / BPS;
        uint256 redB = feeB / 2;
        uint256 netB = redA - feeB;
        vm.expectEmit(true, true, false, true, address(bank2));
        emit ICentralBank.Withdrawn(2, bob, netB, feeB);
        vm.prank(bob);
        uint256 mintedB = bank2.withdraw(2);
        assertEq(mintedB, netB);
        assertApproxEqAbs(mintedB, redA * 4_000 / BPS, 1, "40% of pending");
        assertEq(token2.balanceOf(bob), mintedB);
        assertEq(bank2.pending(2), 0);
        assertEq(bank2.pending(1), redB, "alice receives half of bob's fee");
        assertEq(bank2.accPerBranch(), totalA * 1e18 + redA * 1e18 + redB * 1e18);
        assertEq(bank2.totalFeesUnminted(), (feeA - redA) + (feeB - redB), "unminted halves of both fees");
        assertEq(bank2.totalIssued(), mintedA + mintedB);
        assertEq(bank2.totalIssued() + bank2.pending(1) + bank2.totalFeesUnminted(), totalA, "conservation");
    }

    /// Once RESOLVE_FEE_PERIOD has passed the fee is 2%: the banker keeps 98% of pending, and the fee stays at
    /// 2% however old the charter gets.
    function test_WithdrawAfterFeePeriodPaysNinetyEightPercent() public {
        _mintCharters(alice, 1);
        _mintCharters(bob, 1);
        vm.warp(genesis + RESOLVE_FEE_PERIOD + 5 days);
        assertEq(bank.withdrawFeeBps(1), 200);
        assertEq(bank.resolveFeeBps(1), 200);

        uint256 total = bank.pending(1);
        assertEq(total, IPS * (RESOLVE_FEE_PERIOD + 5 days) / 2);
        uint256 fee = total * 200 / BPS;
        uint256 pending2Before = bank.pending(2);
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.Withdrawn(1, alice, total - fee, fee);
        vm.prank(alice);
        uint256 minted = bank.withdraw(1);
        assertEq(minted, total - fee);
        assertApproxEqAbs(minted, total * 98 / 100, 1, "98% of pending");
        assertEq(token.balanceOf(alice), minted);
        assertEq(bank.pending(1), 0);
        assertEq(bank.pending(2), pending2Before + fee / 2, "bob receives half of the 2%");
        assertEq(bank.totalFeesUnminted(), fee - fee / 2);

        vm.warp(genesis + 3 * RESOLVE_FEE_PERIOD);
        assertEq(bank.withdrawFeeBps(1), 200, "never below the minimum");
        uint256 total2 = bank.pending(1);
        vm.prank(alice);
        assertEq(bank.withdraw(1), total2 - total2 * 200 / BPS);
    }

    /// Resolution is exactly a final withdrawal: withdrawing first and resolving in the same block charges the same
    /// total fee, mints the same amount and leaves the same accumulator as a direct resolution.
    function test_WithdrawThenResolveEqualsDirectResolve() public {
        _mintCharters(alice, 1);
        _mintCharters(bob, 1);
        _fund(alice, 10_000_000e18);
        _open(alice, 1); // alice 2 branches, 3 in total
        vm.warp(genesis + 7 days);
        uint256 total = bank.pending(1);
        assertGt(total, 0);
        uint256 fee = total * feeBpsAt(7 days) / BPS;
        uint256 aliceBefore = token.balanceOf(alice);

        uint256 snap = vm.snapshotState();

        // path A: withdraw, then resolve in the same block
        vm.startPrank(alice);
        uint256 mintedA = bank.withdraw(1);
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.Withdrawn(1, alice, 0, 0);
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.CharterResolved(1, alice, 0, 0, 0);
        uint256 paidA = bank.resolve(1);
        vm.stopPrank();
        assertEq(mintedA, total - fee);
        assertEq(paidA, 0, "nothing left to pay at resolution");
        uint256 balA = token.balanceOf(alice);
        uint256 accA = bank.accPerBranch();
        uint256 unmintedA = bank.totalFeesUnminted();
        uint256 issuedA = bank.totalIssued();
        uint256 pendingBobA = bank.pending(2);
        assertEq(unmintedA, fee - fee / 2);
        assertEq(bank.totalBranches(), 1);

        assertTrue(vm.revertToState(snap));
        assertEq(token.balanceOf(alice), aliceBefore);

        // path B: direct resolve
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.Withdrawn(1, alice, total - fee, fee);
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.CharterResolved(1, alice, total - fee, fee - fee / 2, fee / 2);
        vm.prank(alice);
        uint256 paidB = bank.resolve(1);
        assertEq(paidB, mintedA + paidA, "same amount minted");
        assertEq(token.balanceOf(alice), balA);
        assertEq(bank.accPerBranch(), accA, "same redistribution");
        assertEq(bank.totalFeesUnminted(), unmintedA, "same unminted half");
        assertEq(bank.totalIssued(), issuedA);
        assertEq(bank.pending(2), pendingBobA, "bob receives the same either way");
        assertEq(bank.totalBranches(), 1);
    }

    /// The redistributed half goes to every branch except the withdrawing charter's own: a 3-branch charter's fee
    /// lands entirely on the single other branch, and that branch's fee lands entirely on the 3.
    function test_WithdrawFeeGoesToOtherBranchesOnly() public {
        _mintCharters(alice, 1);
        _mintCharters(bob, 1);
        _fund(alice, 10_000_000e18);
        _open(alice, 1);
        _open(alice, 1); // alice 3 branches, bob 1
        assertEq(bank.branchesOf(1), 3);
        assertEq(bank.totalBranches(), 4);

        vm.warp(genesis + 10 days);
        uint256 acc = IPS * 10 days * 1e18 / 4;
        uint256 totalA = 3 * acc / 1e18;
        uint256 totalB = acc / 1e18;
        assertEq(bank.pending(1), totalA);
        assertEq(bank.pending(2), totalB);
        uint256 feeA = totalA * 2_777 / BPS;
        uint256 redA = feeA / 2;

        vm.prank(alice);
        bank.withdraw(1);
        assertEq(bank.pending(1), 0, "own fee not received");
        assertEq(bank.accPerBranch(), acc + redA * 1e18, "half the fee over the one other branch");
        assertEq(bank.pending(2), totalB + redA, "the other charter receives all of it");
        uint256 accAt10 = bank.accPerBranch();

        // alice keeps accruing normally afterwards: only the fee was excluded, not future issuance
        vm.warp(genesis + 11 days);
        assertApproxEqAbs(bank.pending(1), 3 * IPS * 1 days / 4, 2, "a day of 3 of 4 branches");

        // bob withdraws: his fee is split over alice's 3 branches, none of it back to him
        uint256 totalB2 = bank.pending(2);
        assertEq(totalB2, totalB + redA + IPS * 1 days / 4);
        uint256 feeB = totalB2 * feeBpsAt(11 days) / BPS;
        uint256 redB = feeB / 2;
        uint256 pendingABefore = bank.pending(1);
        vm.prank(bob);
        bank.withdraw(2);
        assertEq(bank.pending(2), 0, "own fee not received");
        assertEq(bank.accPerBranch(), accAt10 + IPS * 1 days * 1e18 / 4 + redB * 1e18 / 3, "half over the 3 other branches");
        assertApproxEqAbs(bank.pending(1) - pendingABefore, redB, 3, "alice's 3 branches receive bob's half");
        assertEq(bank.totalFeesUnminted(), (feeA - redA) + (feeB - redB));
    }

    /// With no other branches the redistributed half has nobody to go to and is unminted as well: the whole fee
    /// leaves supply and the accumulator is untouched. Once a second charter exists the next fee is split.
    function test_SoleCharterWithdrawFeeFullyUnminted() public {
        _mintCharters(alice, 1);
        vm.warp(genesis + 3 days);
        uint256 total = IPS * 3 days;
        assertEq(bank.pending(1), total);
        uint256 fee = total * feeBpsAt(3 days) / BPS;

        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.Withdrawn(1, alice, total - fee, fee);
        vm.prank(alice);
        uint256 minted = bank.withdraw(1);
        assertEq(minted, total - fee);
        assertEq(bank.totalFeesUnminted(), fee, "both halves unminted");
        assertEq(bank.totalResolveBurned(), fee, "alias getter");
        assertEq(bank.accPerBranch(), total * 1e18, "accumulator untouched: nothing redistributed");
        assertEq(bank.pending(1), 0);
        assertEq(bank.totalIssued(), minted);
        assertEq(bank.totalIssued() + bank.totalFeesUnminted(), total, "conservation");

        _mintCharters(bob, 1);
        vm.warp(genesis + 4 days);
        uint256 total2 = bank.pending(1);
        assertEq(total2, IPS * 1 days / 2);
        uint256 fee2 = total2 * feeBpsAt(4 days) / BPS;
        vm.prank(alice);
        bank.withdraw(1);
        assertEq(bank.totalFeesUnminted(), fee + (fee2 - fee2 / 2), "now only half is unminted");
        assertEq(bank.pending(2), IPS * 1 days / 2 + fee2 / 2, "the other half reaches bob");
    }

    // ------------------------------------------------------------------ resolve

    /// fee = MIN + (MAX - MIN) * (PERIOD - age)^2 / PERIOD^2, clamped at MIN once the period has passed.
    function test_ResolveFeeQuadratic() public {
        assertEq(bank.RESOLVE_FEE_MIN_BPS(), 200);
        assertEq(bank.RESOLVE_FEE_MAX_BPS(), 6_000);
        assertEq(bank.RESOLVE_FEE_PERIOD(), 30 days);
        _mintCharters(alice, 1);
        uint256 t0 = genesis;
        assertEq(bank.mintedAt(1), t0);

        assertEq(bank.resolveFeeBps(1), 6_000, "age 0");
        vm.warp(t0 + RESOLVE_FEE_PERIOD / 4);
        assertEq(bank.resolveFeeBps(1), 200 + uint256(5800) * 9 / 16, "quarter: 3462");
        assertEq(bank.resolveFeeBps(1), 3_462);
        vm.warp(t0 + RESOLVE_FEE_PERIOD / 2);
        assertEq(bank.resolveFeeBps(1), 1_650, "half: 200 + 5800/4");
        vm.warp(t0 + 10 days);
        assertEq(bank.resolveFeeBps(1), 2_777, "day 10: 200 + 5800 * 4/9");
        vm.warp(t0 + 3 * RESOLVE_FEE_PERIOD / 4);
        assertEq(bank.resolveFeeBps(1), 200 + uint256(5800) / 16, "three quarters: 562");
        vm.warp(t0 + RESOLVE_FEE_PERIOD - 1);
        assertEq(bank.resolveFeeBps(1), 200, "one second before the period ends rounds to MIN");
        vm.warp(t0 + RESOLVE_FEE_PERIOD);
        assertEq(bank.resolveFeeBps(1), 200, "age == period");
        vm.warp(t0 + 10 * RESOLVE_FEE_PERIOD);
        assertEq(bank.resolveFeeBps(1), 200, "age >> period");

        // a charter minted later has its own clock
        _mintCharters(bob, 1);
        assertEq(bank.resolveFeeBps(2), 6_000);
        assertEq(bank.resolveFeeBps(1), 200);
    }

    /// Resolving a 2-branch charter at day 10 among 4 branches: paid = P - fee, half the fee is never minted,
    /// half lands on the two remaining branches through the accumulator, the NFT is burned. The survivors'
    /// own withdrawals pay the same fee in turn.
    function test_ResolveSplitsFeeAndBurnsNFT() public {
        uint256 t0 = genesis;
        _mintCharters(alice, 2); // ids 1, 2
        _mintCharters(bob, 1); // id 3
        _fund(alice, 10_000_000e18);
        _open(alice, 2); // c2 has 2 branches; total 4
        uint256 aliceBal = token.balanceOf(alice);

        vm.warp(t0 + 10 days);
        uint256 accBefore = IPS * 10 days * 1e18 / 4;
        uint256 total = 2 * accBefore / 1e18;
        assertEq(bank.pending(2), total);
        uint256 feeBps = feeBpsAt(10 days);
        assertEq(feeBps, 2_777);
        uint256 fee = total * feeBps / BPS;
        uint256 paid = total - fee;
        uint256 redistributed = fee / 2;
        uint256 burned = fee - redistributed;
        uint256 pending1Before = bank.pending(1);
        uint256 pending3Before = bank.pending(3);
        assertEq(pending1Before, accBefore / 1e18);

        vm.expectRevert(abi.encodeWithSignature("NotCharterOwner()"));
        vm.prank(bob);
        bank.resolve(2);

        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.Withdrawn(2, alice, paid, fee);
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.CharterResolved(2, alice, paid, burned, redistributed);
        vm.prank(alice);
        uint256 got = bank.resolve(2);

        assertEq(got, paid);
        assertEq(token.balanceOf(alice) - aliceBal, paid, "paid minted to owner");
        assertEq(bank.totalIssued(), paid);
        assertEq(bank.totalFeesUnminted(), burned, "half the fee never enters supply");
        assertEq(bank.totalResolveBurned(), burned, "alias getter");
        assertEq(bank.accPerBranch(), accBefore + redistributed * 1e18 / 2, "half the fee over 2 remaining branches");
        assertEq(bank.pending(1), (accBefore + redistributed * 1e18 / 2) / 1e18);
        assertEq(bank.pending(1) - pending1Before, redistributed / 2, "c1 gets a quarter of the fee");
        assertEq(bank.pending(3) - pending3Before, redistributed / 2, "c3 gets a quarter of the fee");

        // charter 2 is gone everywhere
        assertEq(bank.totalBranches(), 2);
        assertEq(bank.branchesOf(2), 0);
        assertEq(bank.mintedAt(2), 0);
        assertEq(bank.pending(2), 0);
        assertEq(charter.balanceOf(alice), 1);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 2));
        charter.ownerOf(2);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 2));
        vm.prank(alice);
        bank.resolve(2);

        // the redistributed half is mintable by the survivors, less their own withdrawal fee; c3's fee half
        // goes to c1 (the only other branch), half is unminted
        uint256 total3 = pending3Before + redistributed / 2;
        uint256 fee3 = total3 * feeBps / BPS;
        uint256 pending1Mid = bank.pending(1);
        uint256 bobBal = token.balanceOf(bob);
        vm.prank(bob);
        uint256 minted3 = bank.withdraw(3);
        assertEq(minted3, total3 - fee3);
        assertEq(token.balanceOf(bob) - bobBal, minted3);
        assertEq(bank.pending(3), 0);
        assertEq(bank.pending(1), pending1Mid + fee3 / 2, "c1 receives half of c3's fee");
        assertEq(bank.totalFeesUnminted(), burned + (fee3 - fee3 / 2));

        // conservation: everything accrued in 10 days is either minted, still pending, or unminted fee (rounding only)
        uint256 accrued = IPS * 10 days;
        assertApproxEqAbs(bank.totalIssued() + bank.pending(1) + bank.totalFeesUnminted(), accrued, 1e6);
    }

    /// With nobody left to redistribute to, the whole fee is unminted.
    function test_ResolveLastCharterBurnsWholeFee() public {
        _mintCharters(alice, 1);
        vm.warp(genesis + RESOLVE_FEE_PERIOD); // fee at MIN
        uint256 total = IPS * RESOLVE_FEE_PERIOD;
        assertEq(bank.pending(1), total);
        uint256 fee = total * 200 / BPS;

        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.Withdrawn(1, alice, total - fee, fee);
        vm.expectEmit(true, true, false, true, address(bank));
        emit ICentralBank.CharterResolved(1, alice, total - fee, fee, 0);
        vm.prank(alice);
        uint256 paid = bank.resolve(1);

        assertEq(paid, total - fee);
        assertEq(token.balanceOf(alice), paid);
        assertEq(bank.totalFeesUnminted(), fee);
        assertEq(bank.totalBranches(), 0);
        assertEq(bank.accPerBranch(), IPS * RESOLVE_FEE_PERIOD * 1e18, "accumulator untouched");
        assertEq(charter.balanceOf(alice), 0);
    }

    // ------------------------------------------------------------------ issuance budget

    /// Drives the multiplier anywhere in [MIN, MAX] through the mock hook, lets one branch accrue for `dt`,
    /// and checks that withdraw never mints past ISSUANCE_BUDGET while the excess (net of fee) stays owed.
    function testFuzz_WithdrawNeverExceedsIssuanceBudget(uint8 cuts, uint8 raises, uint256 dt) public {
        cuts = uint8(bound(cuts, 0, 8));
        raises = uint8(bound(raises, 0, 4));
        dt = bound(dt, 1, 4000 days);
        _mockBank();

        // [-]*cuts then [+]*(2*raises); a lone [+] closes the trailing window when there are no raises
        uint256 e;
        for (uint256 i = 0; i < cuts; ++i) {
            flow.set(e++, 0, 10);
        }
        uint256 positives = raises == 0 ? 1 : 2 * uint256(raises);
        for (uint256 i = 0; i < positives; ++i) {
            flow.set(e++, 10, 0);
        }
        _rollTo(e);

        uint256 mult = 10_000;
        for (uint256 i = 0; i < cuts; ++i) {
            mult = mult > 2_000 + 1_500 ? mult - 1_500 : 2_000;
        }
        for (uint256 i = 0; i < raises; ++i) {
            mult = mult + 1_000 < 12_500 ? mult + 1_000 : 12_500;
        }
        assertEq(bank2.multiplier(), mult);

        charter2.mint(1, alice);
        vm.warp(block.timestamp + dt);
        uint256 expected = (BASE * mult / BPS / 1 days) * dt;
        assertEq(bank2.pending(1), expected);
        uint256 feeBps = feeBpsAt(dt);
        uint256 fee = expected * feeBps / BPS;
        uint256 net = expected - fee;

        vm.prank(alice);
        uint256 minted = bank2.withdraw(1);

        assertLe(bank2.totalIssued(), BUDGET);
        assertLe(token2.totalSupply(), token2.CAP());
        assertEq(token2.balanceOf(alice), minted);
        assertEq(bank2.totalIssued(), minted);
        assertEq(bank2.totalFeesUnminted(), fee, "sole charter: the whole fee is unminted");
        if (net > BUDGET) {
            assertEq(minted, BUDGET, "capped at the budget");
            assertEq(bank2.pending(1), net - BUDGET, "excess net of fee stays owed");
            // a further withdrawal mints nothing; the fee still applies to what is pending
            uint256 owed = net - BUDGET;
            uint256 fee2 = owed * feeBps / BPS;
            vm.prank(alice);
            assertEq(bank2.withdraw(1), 0, "budget exhausted: nothing more");
            assertEq(bank2.pending(1), owed - fee2);
            assertEq(bank2.totalIssued(), BUDGET);
        } else {
            assertEq(minted, net);
            assertEq(bank2.pending(1), 0);
        }
    }

    // ------------------------------------------------------------------ multiplier policy (mock hook)

    /// A negative trailing window cuts by 1_500 and resets the streak, even when the epoch itself is positive.
    function test_Policy_CutOnNegativeTrailingFlow() public {
        _mockBank();
        flow.set(0, 1, 6); // net -5
        flow.set(1, 3, 0); // net +3, trailing -2
        flow.set(2, 3, 0); // net +3, trailing +6
        flow.set(3, 1, 0); // net +1, trailing +4

        vm.expectEmit(true, false, false, true, address(bank2));
        emit ICentralBank.EpochRolled(0, -5, 8_500, ICentralBank.Regime.Contraction);
        _rollTo(1);
        assertEq(bank2.multiplier(), 8_500);
        assertEq(bank2.consecutivePositive(), 0);
        assertEq(uint8(bank2.regime()), uint8(ICentralBank.Regime.Contraction));

        vm.expectEmit(true, false, false, true, address(bank2));
        emit ICentralBank.EpochRolled(1, 3, 7_000, ICentralBank.Regime.Expansion);
        _rollTo(2);
        assertEq(bank2.multiplier(), 7_000, "positive epoch inside a negative window still cuts");
        assertEq(bank2.consecutivePositive(), 0, "cut resets the streak");
        assertEq(uint8(bank2.regime()), uint8(ICentralBank.Regime.Expansion), "regime follows the epoch sign");

        _rollTo(3);
        assertEq(bank2.multiplier(), 7_000);
        assertEq(bank2.consecutivePositive(), 1);

        vm.expectEmit(true, false, false, true, address(bank2));
        emit ICentralBank.EpochRolled(3, 1, 8_000, ICentralBank.Regime.Expansion);
        _rollTo(4);
        assertEq(bank2.multiplier(), 8_000);
        assertEq(bank2.consecutivePositive(), 0);
        assertEq(bank2.lastRolledEpoch(), 3);
    }

    /// An outflow epoch inside a non-negative trailing window does not cut, but it breaks the positive streak:
    /// the next positive epoch starts a new pair instead of completing the old one.
    function test_Policy_NegativeEpochResetsStreakWithoutCut() public {
        _mockBank();
        flow.set(0, 5, 0); // +5: streak 1
        flow.set(1, 0, 3); // -3, trailing +2: no cut, streak 0, regime Contraction
        flow.set(2, 4, 0); // +4, trailing +1: streak 1, no raise
        flow.set(3, 1, 0); // +1, trailing +5: streak 2 -> raise

        _rollTo(1);
        assertEq(bank2.consecutivePositive(), 1);

        vm.expectEmit(true, false, false, true, address(bank2));
        emit ICentralBank.EpochRolled(1, -3, 10_000, ICentralBank.Regime.Contraction);
        _rollTo(2);
        assertEq(bank2.multiplier(), 10_000, "non-negative window: no cut");
        assertEq(bank2.consecutivePositive(), 0, "outflow epoch breaks the streak");
        assertEq(uint8(bank2.regime()), uint8(ICentralBank.Regime.Contraction));

        _rollTo(3);
        assertEq(bank2.multiplier(), 10_000, "one positive epoch after the break is not a pair");
        assertEq(bank2.consecutivePositive(), 1);

        vm.expectEmit(true, false, false, true, address(bank2));
        emit ICentralBank.EpochRolled(3, 1, 11_000, ICentralBank.Regime.Expansion);
        _rollTo(4);
        assertEq(bank2.multiplier(), 11_000, "the pair completes");
        assertEq(bank2.consecutivePositive(), 0);
    }

    /// Two positive epochs raise by 1_000; zero epochs neither reset the streak nor count toward it.
    function test_Policy_RaiseAfterTwoPositiveEpochs() public {
        _mockBank();
        flow.set(0, 5, 0);
        flow.set(1, 5, 0);
        // epoch 2: zero
        flow.set(3, 1, 0);
        // epoch 4: zero
        flow.set(5, 1, 0);

        _rollTo(1);
        assertEq(bank2.multiplier(), 10_000, "one positive epoch is not enough");
        assertEq(bank2.consecutivePositive(), 1);

        vm.expectEmit(true, false, false, true, address(bank2));
        emit ICentralBank.EpochRolled(1, 5, 11_000, ICentralBank.Regime.Expansion);
        _rollTo(2);
        assertEq(bank2.multiplier(), 11_000);
        assertEq(bank2.consecutivePositive(), 0, "raise resets the streak");

        vm.expectEmit(true, false, false, true, address(bank2));
        emit ICentralBank.EpochRolled(2, 0, 11_000, ICentralBank.Regime.Expansion);
        _rollTo(3);
        assertEq(bank2.multiplier(), 11_000, "zero epoch changes nothing");
        assertEq(bank2.consecutivePositive(), 0);

        _rollTo(4);
        assertEq(bank2.consecutivePositive(), 1);
        _rollTo(5);
        assertEq(bank2.consecutivePositive(), 1, "zero epoch keeps the streak");
        assertEq(bank2.multiplier(), 11_000);
        _rollTo(6);
        assertEq(bank2.multiplier(), 12_000, "second positive epoch completes the pair");
        assertEq(bank2.consecutivePositive(), 0);
        assertEq(bank2.lastRolledEpoch(), 5);
    }

    /// Cuts floor at MULT_MIN, raises cap at MULT_MAX; regime is the sign of the last completed epoch alone.
    function test_Policy_BoundsAndRegime() public {
        _mockBank();
        assertEq(bank2.MULT_MIN(), 2_000);
        assertEq(bank2.MULT_MAX(), 12_500);

        // 8 negative epochs: 8500, 7000, 5500, 4000, 2500, 2000, 2000, 2000
        for (uint256 e = 0; e < 8; ++e) {
            flow.set(e, 0, 1);
        }
        uint256[8] memory path = [uint256(8_500), 7_000, 5_500, 4_000, 2_500, 2_000, 2_000, 2_000];
        for (uint256 e = 0; e < 8; ++e) {
            _rollTo(e + 1);
            assertEq(bank2.multiplier(), path[e]);
            assertEq(uint8(bank2.regime()), uint8(ICentralBank.Regime.Contraction));
        }

        // 12 positive epochs from 2000: +1000 per pair -> 8000 after 12, then on to the cap
        for (uint256 e = 8; e < 30; ++e) {
            flow.set(e, 2, 0);
        }
        _rollTo(9);
        assertEq(bank2.multiplier(), 2_000, "first positive after the run only zeroes the window");
        assertEq(uint8(bank2.regime()), uint8(ICentralBank.Regime.Expansion), "regime flips with a single positive epoch");
        _rollTo(10);
        assertEq(bank2.multiplier(), 3_000);
        _rollTo(28);
        assertEq(bank2.multiplier(), 12_000);
        _rollTo(30);
        assertEq(bank2.multiplier(), 12_500, "capped");
        for (uint256 e = 30; e < 34; ++e) {
            flow.set(e, 2, 0);
        }
        _rollTo(34);
        assertEq(bank2.multiplier(), 12_500, "stays at the cap");
        assertEq(bank2.consecutivePositive(), 0);

        // net -5 after +2: trailing -3 cuts; the zero epoch after it is still a negative window (cut), regime Expansion
        flow.set(34, 0, 5);
        _rollTo(35);
        assertEq(bank2.multiplier(), 12_500 - 1_500);
        assertEq(uint8(bank2.regime()), uint8(ICentralBank.Regime.Contraction));
        _rollTo(36);
        assertEq(bank2.multiplier(), 12_500 - 2 * 1_500);
        assertEq(uint8(bank2.regime()), uint8(ICentralBank.Regime.Expansion));
    }

    /// Epoch 0 has no predecessor (prevNet = 0); nothing rolls until an epoch completes; an unset hook reads as zero flow.
    function test_Policy_FirstEpochAndEpochZero() public {
        // no hook: rolling is a no-op on the multiplier
        ThalerToken t = new ThalerToken();
        MockCharter c = new MockCharter();
        CentralBank bare = new CentralBank(address(t), address(c), EPOCH, RESOLVE_FEE_PERIOD);
        assertEq(bare.hook(), address(0));
        vm.warp(bare.GENESIS() + 3 * EPOCH);
        bare.rollEpochs();
        assertEq(bare.multiplier(), 10_000);
        assertEq(bare.lastRolledEpoch(), 2);
        assertEq(uint8(bare.regime()), uint8(ICentralBank.Regime.Expansion));

        vm.warp(DAY0);
        _mockBank();
        uint256 g = bank2.GENESIS();
        flow.set(0, 0, 1); // net -1 in epoch 0

        // epoch 0 is not complete: nothing rolls, no event
        vm.warp(g + EPOCH - 1);
        assertEq(bank2.currentEpoch(), 0);
        vm.recordLogs();
        bank2.rollEpochs();
        assertEq(vm.getRecordedLogs().length, 0, "no roll before the first epoch completes");
        assertEq(bank2.multiplier(), 10_000);
        assertEq(bank2.lastRolledEpoch(), 0);

        // epoch 0 completes: prevNet is 0, so trailing == net(0) == -1 -> cut
        vm.warp(g + EPOCH);
        assertEq(bank2.currentEpoch(), 1);
        vm.expectEmit(true, false, false, true, address(bank2));
        emit ICentralBank.EpochRolled(0, -1, 8_500, ICentralBank.Regime.Contraction);
        bank2.rollEpochs();
        assertEq(bank2.multiplier(), 8_500);
        assertEq(bank2.lastRolledEpoch(), 0);

        // rerun in the same epoch: idempotent
        vm.recordLogs();
        bank2.rollEpochs();
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(bank2.multiplier(), 8_500);

        // flow in the running epoch is ignored until it completes; epoch 1 then sees epoch 0 as its predecessor
        flow.set(1, 1, 0); // net +1, trailing 0 -> streak 1, no cut
        bank2.rollEpochs();
        assertEq(bank2.multiplier(), 8_500);
        assertEq(bank2.consecutivePositive(), 0);
        _rollTo(2);
        assertEq(bank2.multiplier(), 8_500);
        assertEq(bank2.consecutivePositive(), 1);
        assertEq(uint8(bank2.regime()), uint8(ICentralBank.Regime.Expansion));
    }

    /// At most 50 epochs per call; the next call continues where the previous stopped.
    function test_Policy_LoopBound() public {
        _mockBank();
        assertEq(bank2.MAX_EPOCHS_PER_ROLL(), 50);
        flow.set(100, 0, 1); // the only flow, deep in the backlog
        vm.warp(bank2.GENESIS() + 120 * EPOCH);
        assertEq(bank2.currentEpoch(), 120);

        vm.recordLogs();
        bank2.rollEpochs();
        assertEq(vm.getRecordedLogs().length, 50, "first call rolls 50");
        assertEq(bank2.lastRolledEpoch(), 49);
        assertEq(bank2.multiplier(), 10_000);

        vm.recordLogs();
        bank2.rollEpochs();
        assertEq(vm.getRecordedLogs().length, 50, "second call rolls the next 50");
        assertEq(bank2.lastRolledEpoch(), 99);
        assertEq(bank2.multiplier(), 10_000);

        vm.recordLogs();
        bank2.rollEpochs();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 20, "third call finishes the backlog");
        assertEq(bank2.lastRolledEpoch(), 119);
        // epoch 100 cuts, epoch 101 (zero after negative) cuts again, then nothing
        assertEq(bank2.multiplier(), 7_000);
        assertEq(uint256(logs[0].topics[1]), 100);
        assertEq(uint256(logs[19].topics[1]), 119);

        vm.recordLogs();
        bank2.rollEpochs();
        assertEq(vm.getRecordedLogs().length, 0, "nothing left");
    }

    /// Accrual up to each epoch boundary is booked at the multiplier in force during that epoch; only time
    /// after the boundary uses the new one, however late the roll happens.
    function test_Policy_AccrualBookedAtOldRateBeforeCut() public {
        _mockBank();
        charter2.mint(1, alice);
        flow.set(0, 0, 1);

        vm.warp(bank2.GENESIS() + EPOCH);
        assertEq(bank2.pending(1), IPS * EPOCH);
        bank2.rollEpochs();
        assertEq(bank2.multiplier(), 8_500);
        assertEq(bank2.pending(1), IPS * EPOCH, "roll does not change what was accrued");
        assertEq(bank2.accPerBranch(), IPS * EPOCH * 1e18);
        assertEq(bank2.lastUpdate(), block.timestamp);

        uint256 ips85 = BASE * 8_500 / BPS / 1 days;
        assertEq(bank2.issuancePerSecond(), ips85);
        vm.warp(bank2.GENESIS() + 2 * EPOCH);
        assertEq(bank2.pending(1), IPS * EPOCH + ips85 * EPOCH, "second epoch accrues at 0.85x");

        // the same holds when the roll happens implicitly inside withdraw, many epochs late
        flow.set(1, 0, 1); // trailing -2 at epoch 1 -> 7000
        vm.warp(bank2.GENESIS() + 5 * EPOCH);
        vm.prank(alice);
        uint256 minted = bank2.withdraw(1);
        // epochs 1..4 are rolled inside withdraw, each booked at the multiplier that governed it:
        // epoch 1 at 0.85x, epoch 2 at 0.70x (trailing -2 cut), epochs 3 and 4 at 0.55x (zero after negative cuts)
        uint256 ips70 = BASE * 7_000 / BPS / 1 days;
        uint256 ips55 = BASE * 5_500 / BPS / 1 days;
        uint256 total = IPS * EPOCH + ips85 * EPOCH + ips70 * EPOCH + 2 * ips55 * EPOCH;
        assertEq(minted, total - total * feeBpsAt(5 * EPOCH) / BPS);
        assertEq(bank2.multiplier(), 7_000 - 1_500, "epoch 2: zero after negative cuts again");
    }
}
