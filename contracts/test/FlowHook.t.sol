// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapMath} from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

import {BaseTest} from "./Base.t.sol";
import {FlowHook} from "../src/FlowHook.sol";
import {BaseHook} from "../src/base/BaseHook.sol";
import {IFlowHook} from "../src/interfaces/IFlowHook.sol";
import {ICentralBank} from "../src/interfaces/ICentralBank.sol";

/// @dev Minimal unlock-callback caller so a test can hand the PoolManager arbitrary swap params
///      (the router only builds exact-input swaps). Only used for swaps that are expected to revert
///      inside the hook, so it never settles.
contract RawSwapper is IUnlockCallback {
    IPoolManager internal immutable pm;

    constructor(IPoolManager _pm) {
        pm = _pm;
    }

    function swap(PoolKey memory key, SwapParams memory params) external {
        pm.unlock(abi.encode(key, params));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (PoolKey memory key, SwapParams memory params) = abi.decode(data, (PoolKey, SwapParams));
        pm.swap(key, params, "");
        return "";
    }
}

/// @notice FlowHook unit tests: tax split, tax decay, per-epoch flow, exact-output rejection,
///         treasury exemption, pool binding.
contract FlowHookTest is BaseTest {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 internal constant BPS = 1e4;
    uint256 internal constant LAUNCH = 9_000;
    uint256 internal constant BUY_FLOOR = 200;
    uint256 internal constant SELL_FLOOR = 300;
    uint256 internal constant HALF_LIFE = 6 hours;

    bytes32 internal constant TAXED_SIG = keccak256("Taxed(bool,uint256,uint256,uint256)");

    // ------------------------------------------------------------------ helpers

    /// @dev Exact-input quote against the current pool state: one SwapMath step, the same math the pool runs
    ///      while the swap stays inside the current tick word (true for every swap size used here).
    function _quote(bool zeroForOne, uint256 amountIn) internal view returns (uint256 amountOut) {
        IPoolManager ipm = IPoolManager(address(pm));
        (uint160 sqrtP,,,) = ipm.getSlot0(poolId);
        uint128 liquidity = ipm.getLiquidity(poolId);
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        (,, amountOut,) = SwapMath.computeSwapStep(sqrtP, limit, liquidity, -int256(amountIn), key.fee);
    }

    /// @dev Revert data the PoolManager produces when a hook callback reverts with a bare custom error.
    function _hookRevert(address h, bytes4 fn, bytes4 err) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            h,
            fn,
            abi.encodeWithSelector(err),
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }

    /// @dev A second FlowHook at another flag-correct address, wired to the same bank/treasury, not bound.
    function _freshHook(uint16 seed) internal returns (FlowHook h) {
        address addr = address(HOOK_FLAGS ^ (uint160(seed) << 144));
        deployCodeTo("FlowHook.sol:FlowHook", abi.encode(pm, address(bank), address(treasury)), addr);
        h = FlowHook(addr);
        vm.label(addr, "FlowHook2");
    }

    function _keyWith(IHooks h) internal view returns (PoolKey memory k) {
        k = key;
        k.hooks = h;
    }

    function _exactIn(bool zeroForOne, uint256 amountIn) internal pure returns (SwapParams memory) {
        return SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(amountIn),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    function _countTaxed(Vm.Log[] memory logs) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] == TAXED_SIG) ++n;
        }
    }

    /// @dev sell through the router while expecting the hook's Taxed event; the approve in `sell()` would
    ///      otherwise be the call the expectation attaches to
    function _sellExpectTaxed(address user, uint256 thalerIn, uint256 gross, uint256 tax, uint256 epoch)
        internal
        returns (uint256 amountOut)
    {
        vm.startPrank(user);
        token.approve(address(router), thalerIn);
        vm.expectEmit(true, false, false, true, address(hook));
        emit IFlowHook.Taxed(false, gross, tax, epoch);
        amountOut = router.swapExactIn(false, thalerIn, 0, user, type(uint256).max);
        vm.stopPrank();
    }

    function _fund(address from, uint256 amount) internal {
        vm.prank(from);
        (bool ok,) = address(treasury).call{value: amount}("");
        assertTrue(ok, "fund treasury");
    }

    // ------------------------------------------------------------------ buy tax

    function test_BuyTax_ExactSplit() public {
        uint256 amountIn = 0.5 ether;
        uint256 tax = amountIn * LAUNCH / BPS; // 0.45 ETH at launch
        assertEq(tax, 0.45 ether);
        uint256 net = amountIn - tax;
        uint256 expectedOut = _quote(true, net);
        assertGt(expectedOut, 0);
        assertLt(expectedOut, _quote(true, amountIn), "pool must swap only the net amount");

        uint256 bobEth0 = bob.balance;
        uint256 pmEth0 = address(pm).balance;
        uint256 unalloc0 = treasury.unallocated();

        vm.expectEmit(true, false, false, true, address(hook));
        emit IFlowHook.Taxed(true, amountIn, tax, 0);
        uint256 out = buy(bob, amountIn);

        assertEq(out, expectedOut, "THALER out = quote(amountIn - tax)");
        assertEq(token.balanceOf(bob), expectedOut);
        assertEq(bobEth0 - bob.balance, amountIn, "swapper pays the full amountIn");
        assertEq(address(pm).balance - pmEth0, net, "pool receives amountIn - tax");
        assertEq(treasury.unallocated() - unalloc0, tax, "treasury.unallocated += tax");
        assertEq(address(hook).balance, 0, "hook never holds ETH");
        assertEq(address(router).balance, 0, "router holds no ETH");

        (uint256 ethIn, uint256 ethOut) = hook.flowOf(0);
        assertEq(ethIn, net, "flow records net ETH in");
        assertEq(ethOut, 0);
        assertEq(hook.totalEthIn(), net);
        assertEq(hook.totalTaxed(), tax);
        assertTreasuryInvariant();
    }

    function test_BuyTax_RoundsDownToZero() public {
        // 1 wei * 9000 / 1e4 = 0: no take, but the flow is still recorded
        uint256 unalloc0 = treasury.unallocated();
        uint256 bobEth0 = bob.balance;

        vm.expectEmit(true, false, false, true, address(hook));
        emit IFlowHook.Taxed(true, 1, 0, 0);
        buy(bob, 1);

        assertEq(treasury.unallocated(), unalloc0, "no tax taken");
        assertEq(bobEth0 - bob.balance, 1);
        (uint256 ethIn,) = hook.flowOf(0);
        assertEq(ethIn, 1);
        assertEq(hook.totalTaxed(), 0);
    }

    // ------------------------------------------------------------------ sell tax

    function test_SellTax_ExactOnEthOutput() public {
        uint256 thaler = buy(bob, 1 ether);
        assertGt(thaler, 0);

        uint256 gross = _quote(false, thaler);
        uint256 tax = gross * LAUNCH / BPS;
        assertGt(tax, 0);

        uint256 bobEth0 = bob.balance;
        uint256 pmEth0 = address(pm).balance;
        uint256 unalloc0 = treasury.unallocated();
        uint256 taxed0 = hook.totalTaxed();

        uint256 received = _sellExpectTaxed(bob, thaler, gross, tax, 0);

        assertEq(received, gross - tax, "swapper receives gross - tax");
        assertEq(bob.balance - bobEth0, gross - tax);
        assertEq(pmEth0 - address(pm).balance, gross, "pool pays the gross output");
        assertEq(treasury.unallocated() - unalloc0, tax, "treasury.unallocated += sell tax");
        assertEq(hook.totalTaxed() - taxed0, tax);
        assertEq(token.balanceOf(bob), 0);
        assertEq(address(hook).balance, 0, "hook never holds ETH");
        assertEq(address(router).balance, 0);

        (, uint256 ethOut) = hook.flowOf(0);
        assertEq(ethOut, gross, "flow records gross ETH out");
        assertEq(hook.totalEthOut(), gross);
        assertTreasuryInvariant();
    }

    // ------------------------------------------------------------------ decay

    function test_TaxDecay_Schedule() public {
        uint256 t0 = hook.launchedAt();
        assertEq(t0, genesis, "pool bound in the genesis block");
        assertEq(hook.LAUNCH_TAX_BPS(), LAUNCH);
        assertEq(hook.BUY_FLOOR_BPS(), BUY_FLOOR);
        assertEq(hook.SELL_FLOOR_BPS(), SELL_FLOOR);
        assertEq(hook.TAX_HALF_LIFE(), HALF_LIFE);

        // t = 0
        assertEq(hook.buyTaxBps(), 9_000);
        assertEq(hook.sellTaxBps(), 9_000);

        // half a half-life: linear interpolation inside the halving, gap * (1 - 1/4)
        vm.warp(t0 + 3 hours);
        assertEq(hook.buyTaxBps(), 6_800); // 200 + 8800 - 8800*3h/12h
        assertEq(hook.sellTaxBps(), 6_825); // 300 + 8700 - 8700*3h/12h

        // exact multiples of the half-life: floor + gap >> n
        vm.warp(t0 + HALF_LIFE);
        assertEq(hook.buyTaxBps(), 4_600);
        assertEq(hook.sellTaxBps(), 4_650);
        vm.warp(t0 + 2 * HALF_LIFE);
        assertEq(hook.buyTaxBps(), 2_400);
        assertEq(hook.sellTaxBps(), 2_475);
        vm.warp(t0 + 3 * HALF_LIFE);
        assertEq(hook.buyTaxBps(), 1_300);
        assertEq(hook.sellTaxBps(), 1_387);
        for (uint256 n = 4; n <= 13; ++n) {
            vm.warp(t0 + n * HALF_LIFE);
            assertEq(hook.buyTaxBps(), BUY_FLOOR + ((LAUNCH - BUY_FLOOR) >> n));
            assertEq(hook.sellTaxBps(), SELL_FLOOR + ((LAUNCH - SELL_FLOOR) >> n));
        }

        // fully decayed: floors exactly
        vm.warp(t0 + 30 days);
        assertEq(hook.buyTaxBps(), BUY_FLOOR);
        assertEq(hook.sellTaxBps(), SELL_FLOOR);
        vm.warp(t0 + 10 * 365 days);
        assertEq(hook.buyTaxBps(), BUY_FLOOR);
        assertEq(hook.sellTaxBps(), SELL_FLOOR);
    }

    function test_TaxDecay_AppliedToSwaps() public {
        vm.warp(hook.launchedAt() + 2 * HALF_LIFE); // 2400 / 2475 bps
        uint256 epoch = bank.currentEpoch();
        assertEq(epoch, 2);

        uint256 amountIn = 1 ether;
        uint256 buyTax = amountIn * 2_400 / BPS;
        assertEq(buyTax, 0.24 ether);
        uint256 unalloc0 = treasury.unallocated();
        uint256 bobEth0 = bob.balance;
        uint256 expectedOut = _quote(true, amountIn - buyTax);

        vm.expectEmit(true, false, false, true, address(hook));
        emit IFlowHook.Taxed(true, amountIn, buyTax, epoch);
        uint256 thaler = buy(bob, amountIn);
        assertEq(thaler, expectedOut);
        assertEq(treasury.unallocated() - unalloc0, buyTax);
        assertEq(bobEth0 - bob.balance, amountIn);

        uint256 gross = _quote(false, thaler);
        uint256 sellTax = gross * 2_475 / BPS;
        unalloc0 = treasury.unallocated();
        bobEth0 = bob.balance;

        uint256 received = _sellExpectTaxed(bob, thaler, gross, sellTax, epoch);
        assertEq(received, gross - sellTax);
        assertEq(bob.balance - bobEth0, gross - sellTax);
        assertEq(treasury.unallocated() - unalloc0, sellTax);

        (uint256 ethIn, uint256 ethOut) = hook.flowOf(epoch);
        assertEq(ethIn, amountIn - buyTax);
        assertEq(ethOut, gross);
        assertEq(hook.totalTaxed(), buyTax + sellTax);
        assertTreasuryInvariant();
    }

    // ------------------------------------------------------------------ flow per epoch

    function test_FlowOf_RecordsPerEpochAndTotals() public {
        // epoch 0: two buys at 9000 bps
        uint256 aliceThaler = buy(alice, 0.2 ether);
        uint256 bobThaler = buy(bob, 0.3 ether);
        uint256 in0 = 0.02 ether + 0.03 ether;
        uint256 tax0 = 0.18 ether + 0.27 ether;
        (uint256 ethIn, uint256 ethOut) = hook.flowOf(0);
        assertEq(ethIn, in0);
        assertEq(ethOut, 0);

        // epoch 1: two sells at 4650 bps; epoch 0 untouched
        vm.warp(genesis + EPOCH);
        assertEq(bank.currentEpoch(), 1);
        uint256 g1 = _quote(false, bobThaler);
        _sellExpectTaxed(bob, bobThaler, g1, g1 * 4_650 / BPS, 1);
        uint256 g2 = _quote(false, aliceThaler / 2);
        sell(alice, aliceThaler / 2);
        uint256 out1 = g1 + g2;
        uint256 tax1 = g1 * 4_650 / BPS + g2 * 4_650 / BPS;

        (ethIn, ethOut) = hook.flowOf(1);
        assertEq(ethIn, 0);
        assertEq(ethOut, out1);
        (ethIn, ethOut) = hook.flowOf(0);
        assertEq(ethIn, in0, "epoch 0 unchanged");
        assertEq(ethOut, 0, "epoch 0 unchanged");

        // epoch 2: one buy at 2400 bps and one sell at 2475 bps in the same epoch
        vm.warp(genesis + 2 * EPOCH);
        assertEq(bank.currentEpoch(), 2);
        uint256 carolThaler = buy(carol, 1 ether);
        uint256 in2 = 1 ether - 0.24 ether;
        uint256 g3 = _quote(false, carolThaler);
        sell(carol, carolThaler);
        uint256 tax2 = 0.24 ether + g3 * 2_475 / BPS;

        (ethIn, ethOut) = hook.flowOf(2);
        assertEq(ethIn, in2);
        assertEq(ethOut, g3);
        (ethIn, ethOut) = hook.flowOf(3);
        assertEq(ethIn, 0, "future epoch empty");
        assertEq(ethOut, 0);

        assertEq(hook.totalEthIn(), in0 + in2, "totalEthIn = sum of net buys");
        assertEq(hook.totalEthOut(), out1 + g3, "totalEthOut = sum of gross sells");
        assertEq(hook.totalTaxed(), tax0 + tax1 + tax2, "totalTaxed = every tax");
        assertEq(treasury.unallocated(), tax0 + tax1 + tax2, "every wei of tax reached the treasury");
        assertTreasuryInvariant();
    }

    // ------------------------------------------------------------------ exact output

    function test_ExactOutput_Reverts() public {
        RawSwapper raw = new RawSwapper(pm);
        bytes memory expected = _hookRevert(address(hook), IHooks.beforeSwap.selector, FlowHook.ExactOutputNotSupported.selector);

        // buy, exact output of THALER
        vm.expectRevert(expected);
        raw.swap(key, SwapParams({zeroForOne: true, amountSpecified: 1e18, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}));

        // sell, exact output of ETH
        vm.expectRevert(expected);
        raw.swap(key, SwapParams({zeroForOne: false, amountSpecified: 1e15, sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}));

        // nothing was recorded
        assertEq(hook.totalTaxed(), 0);
        (uint256 ethIn, uint256 ethOut) = hook.flowOf(0);
        assertEq(ethIn + ethOut, 0);
    }

    // ------------------------------------------------------------------ treasury exemption

    struct FlowSnap {
        uint256 ethIn;
        uint256 ethOut;
        uint256 totalIn;
        uint256 totalOut;
        uint256 taxed;
    }

    function _snap(uint256 epoch) internal view returns (FlowSnap memory s) {
        (s.ethIn, s.ethOut) = hook.flowOf(epoch);
        s.totalIn = hook.totalEthIn();
        s.totalOut = hook.totalEthOut();
        s.taxed = hook.totalTaxed();
    }

    /// @dev runs tick() and returns how many Taxed events the hook emitted during it
    function _tickCountingTaxed() internal returns (uint256) {
        vm.recordLogs();
        treasury.tick();
        return _countTaxed(vm.getRecordedLogs());
    }

    /// @dev buy in epoch 0, sell everything in epoch 1, roll at epoch 2: last completed epoch net < 0
    function _forceContraction() internal {
        uint256 thaler = buy(bob, 1 ether);
        vm.warp(genesis + EPOCH);
        sell(bob, thaler);
        vm.warp(genesis + 2 * EPOCH);
        bank.rollEpochs();
        assertEq(uint8(bank.regime()), uint8(ICentralBank.Regime.Contraction), "regime forced to Contraction");
        assertEq(bank.lastRolledEpoch(), 1);
    }

    function test_TreasurySwaps_TaxExempt() public {
        _forceContraction();

        // fund the treasury and split: 70% lands in the contraction vault
        _fund(alice, 1 ether);
        uint256 pot = treasury.unallocated();
        treasury.allocate();
        assertEq(treasury.contractionVault(), pot - pot * 1_500 / BPS - pot * 1_500 / BPS);
        assertEq(treasury.unallocated(), 0);
        uint256 buyback = treasury.nextBuybackAmount();
        assertGt(buyback, 0);
        assertGe(treasury.polVault(), treasury.POL_MIN_COMPOUND(), "POL compound will also swap");
        uint256 pol0 = treasury.polLiquidity();

        uint256 epoch = bank.currentEpoch();
        FlowSnap memory before = _snap(epoch);
        uint256 taxedEvents = _tickCountingTaxed();
        FlowSnap memory after_ = _snap(epoch);

        // both treasury swaps happened (buyback + POL compound)...
        assertEq(treasury.totalEthSpentOnBuybacks(), buyback, "buyback swapped through the pool");
        assertGt(treasury.totalBoughtBack(), 0);
        assertGt(treasury.polLiquidity(), pol0, "POL compound swapped through the pool");
        // ...and none of them was taxed or recorded
        assertEq(taxedEvents, 0, "no Taxed event");
        assertEq(after_.taxed, before.taxed, "no tax recorded");
        assertEq(after_.totalIn, before.totalIn, "no flow recorded");
        assertEq(after_.totalOut, before.totalOut, "no flow recorded");
        assertEq(after_.ethIn, before.ethIn);
        assertEq(after_.ethOut, before.ethOut);
        assertEq(treasury.unallocated(), 0, "no tax came back to the treasury");
        assertEq(address(hook).balance, 0);
        assertTreasuryInvariant();

        // a user swap in the same epoch is still taxed (2400 bps at genesis + 12h)
        buy(bob, 0.1 ether);
        assertEq(treasury.unallocated(), 0.024 ether);
        assertEq(hook.totalTaxed(), before.taxed + 0.024 ether);
    }

    // ------------------------------------------------------------------ wrong pool

    function test_WrongPool_Reverts() public {
        PoolKey memory badFee = key;
        badFee.fee = 3_000;
        PoolKey memory badHook = _keyWith(IHooks(address(0)));
        SwapParams memory p = _exactIn(true, 1 ether);
        BalanceDelta d = toBalanceDelta(-1e18, 1e26);

        vm.startPrank(address(pm));
        vm.expectRevert(FlowHook.WrongPool.selector);
        hook.beforeSwap(alice, badFee, p, "");
        vm.expectRevert(FlowHook.WrongPool.selector);
        hook.beforeSwap(alice, badHook, p, "");
        vm.expectRevert(FlowHook.WrongPool.selector);
        hook.afterSwap(alice, badFee, p, d, "");
        vm.expectRevert(FlowHook.WrongPool.selector);
        hook.afterSwap(alice, badHook, p, d, "");
        // the pool check comes before the treasury exemption
        vm.expectRevert(FlowHook.WrongPool.selector);
        hook.beforeSwap(address(treasury), badFee, p, "");
        vm.expectRevert(FlowHook.WrongPool.selector);
        hook.afterSwap(address(treasury), badFee, p, d, "");

        // the bound key with the treasury as sender passes and returns zero deltas
        (bytes4 sel, BeforeSwapDelta bd, uint24 fee) = hook.beforeSwap(address(treasury), key, p, "");
        assertEq(sel, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(bd), BeforeSwapDelta.unwrap(BeforeSwapDeltaLibrary.ZERO_DELTA));
        assertEq(fee, 0);
        (sel, ) = hook.afterSwap(address(treasury), key, p, d, "");
        assertEq(sel, IHooks.afterSwap.selector);
        vm.stopPrank();

        // callbacks are PoolManager-only
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(alice, key, p, "");
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(alice, key, p, d, "");
    }

    // ------------------------------------------------------------------ beforeInitialize

    function test_BeforeInitialize_RejectsNonTreasurySender() public {
        FlowHook hook2 = _freshHook(0x5555);
        PoolKey memory key2 = _keyWith(IHooks(address(hook2)));
        bytes memory expected = _hookRevert(address(hook2), IHooks.beforeInitialize.selector, FlowHook.NotTreasury.selector);

        vm.prank(alice);
        vm.expectRevert(expected);
        pm.initialize(key2, SQRT_PRICE_X96);

        // the deployer / owner is not the treasury either
        vm.expectRevert(expected);
        pm.initialize(key2, SQRT_PRICE_X96);

        // and the callback cannot be called around the PoolManager
        vm.prank(alice);
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook2.beforeInitialize(address(treasury), key2, SQRT_PRICE_X96);

        assertFalse(hook2.poolBound());
        assertEq(hook2.launchedAt(), 0);
        // before launch the tax stays at the launch rate, whatever the clock says
        vm.warp(block.timestamp + 30 days);
        assertEq(hook2.buyTaxBps(), LAUNCH);
        assertEq(hook2.sellTaxBps(), LAUNCH);
    }

    function test_BeforeInitialize_RejectsWrongKey() public {
        FlowHook hook2 = _freshHook(0x6666);

        // each field checked, direct callback with the treasury as sender
        PoolKey memory k;
        vm.startPrank(address(pm));
        k = _keyWith(IHooks(address(hook2)));
        k.currency0 = Currency.wrap(address(token));
        vm.expectRevert(FlowHook.InvalidPoolKey.selector);
        hook2.beforeInitialize(address(treasury), k, SQRT_PRICE_X96);
        k = _keyWith(IHooks(address(hook2)));
        k.currency1 = Currency.wrap(address(0xBEEF));
        vm.expectRevert(FlowHook.InvalidPoolKey.selector);
        hook2.beforeInitialize(address(treasury), k, SQRT_PRICE_X96);
        k = _keyWith(IHooks(address(hook2)));
        k.fee = 3_000;
        vm.expectRevert(FlowHook.InvalidPoolKey.selector);
        hook2.beforeInitialize(address(treasury), k, SQRT_PRICE_X96);
        k = _keyWith(IHooks(address(hook2)));
        k.tickSpacing = 60;
        vm.expectRevert(FlowHook.InvalidPoolKey.selector);
        hook2.beforeInitialize(address(treasury), k, SQRT_PRICE_X96);
        vm.stopPrank();
        assertFalse(hook2.poolBound());

        // end to end through the PoolManager: wrong fee from the treasury
        k = _keyWith(IHooks(address(hook2)));
        k.fee = 3_000;
        vm.prank(address(treasury));
        vm.expectRevert(_hookRevert(address(hook2), IHooks.beforeInitialize.selector, FlowHook.InvalidPoolKey.selector));
        pm.initialize(k, SQRT_PRICE_X96);
        assertFalse(hook2.poolBound());
    }

    function test_BeforeInitialize_BindsOnceForTreasury() public {
        FlowHook hook2 = _freshHook(0x7777);
        PoolKey memory key2 = _keyWith(IHooks(address(hook2)));
        vm.warp(genesis + 1 days);

        vm.expectEmit(false, false, false, true, address(hook2));
        emit IFlowHook.PoolBound(PoolId.unwrap(key2.toId()));
        vm.prank(address(treasury));
        pm.initialize(key2, SQRT_PRICE_X96);

        assertTrue(hook2.poolBound());
        assertEq(hook2.launchedAt(), genesis + 1 days, "launchedAt = bind time");
        PoolKey memory stored = hook2.poolKey();
        assertEq(PoolId.unwrap(stored.toId()), PoolId.unwrap(key2.toId()));
        assertEq(Currency.unwrap(stored.currency0), address(0));
        assertEq(Currency.unwrap(stored.currency1), address(token));
        assertEq(stored.fee, 10_000);
        assertEq(stored.tickSpacing, 200);
        assertEq(address(stored.hooks), address(hook2));
        assertEq(hook2.buyTaxBps(), LAUNCH);
        vm.warp(genesis + 1 days + HALF_LIFE);
        assertEq(hook2.buyTaxBps(), 4_600, "decay counts from bind time");

        // a second binding is refused, even by the treasury
        vm.prank(address(treasury));
        vm.expectRevert(_hookRevert(address(hook2), IHooks.beforeInitialize.selector, FlowHook.AlreadyBound.selector));
        pm.initialize(key2, SQRT_PRICE_X96);
    }
}
