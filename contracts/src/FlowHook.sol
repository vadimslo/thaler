// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";

import {BaseHook} from "./base/BaseHook.sol";
import {Decay} from "./base/Decay.sol";
import {IFlowHook} from "./interfaces/IFlowHook.sol";
import {ICentralBank} from "./interfaces/ICentralBank.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";

/// @notice Uniswap v4 hook on the canonical ETH/THALER pool. Taxes buys on ETH input (beforeSwap) and sells on
/// ETH output (afterSwap), forwards the tax to the Treasury and records ETH in / out per CentralBank epoch.
contract FlowHook is BaseHook, IFlowHook {
    using SafeCast for uint256;

    error NotTreasury();
    error AlreadyBound();
    error InvalidPoolKey();
    error WrongPool();
    error ExactOutputNotSupported();

    uint256 public constant LAUNCH_TAX_BPS = 9_000;
    uint256 public constant BUY_FLOOR_BPS = 200;
    uint256 public constant SELL_FLOOR_BPS = 300;
    uint256 public constant TAX_HALF_LIFE = 6 hours;

    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant POOL_TICK_SPACING = 200;
    uint256 internal constant BPS = 1e4;

    address public immutable centralBank;
    address public immutable treasury;

    struct Flow {
        uint256 ethIn;
        uint256 ethOut;
    }

    PoolKey internal _poolKey;
    PoolId internal _poolId;
    bool public poolBound;
    uint256 public launchedAt;

    mapping(uint256 epoch => Flow) internal _flow;
    uint256 public totalEthIn;
    uint256 public totalEthOut;
    uint256 public totalTaxed;

    constructor(IPoolManager _poolManager, address _centralBank, address _treasury) BaseHook(_poolManager) {
        centralBank = _centralBank;
        treasury = _treasury;
    }

    // ------------------------------------------------------------------ permissions

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ------------------------------------------------------------------ views

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    function buyTaxBps() public view returns (uint256) {
        return _taxBps(BUY_FLOOR_BPS);
    }

    function sellTaxBps() public view returns (uint256) {
        return _taxBps(SELL_FLOOR_BPS);
    }

    function flowOf(uint256 epoch) external view returns (uint256 ethIn, uint256 ethOut) {
        Flow storage f = _flow[epoch];
        return (f.ethIn, f.ethOut);
    }

    function _taxBps(uint256 floor) internal view returns (uint256) {
        if (launchedAt == 0) return LAUNCH_TAX_BPS;
        return Decay.decay(LAUNCH_TAX_BPS, floor, block.timestamp - launchedAt, TAX_HALF_LIFE);
    }

    function _epoch() internal view returns (uint256) {
        return ICentralBank(centralBank).currentEpoch();
    }

    // ------------------------------------------------------------------ initialize

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal override returns (bytes4) {
        if (sender != treasury) revert NotTreasury();
        if (poolBound) revert AlreadyBound();
        if (
            Currency.unwrap(key.currency0) != address(0)
                || Currency.unwrap(key.currency1) != ITreasury(treasury).token() || key.fee != POOL_FEE
                || key.tickSpacing != POOL_TICK_SPACING
        ) revert InvalidPoolKey();

        _poolKey = key;
        PoolId id = key.toId();
        _poolId = id;
        poolBound = true;
        launchedAt = block.timestamp;
        emit PoolBound(PoolId.unwrap(id));
        return IHooks.beforeInitialize.selector;
    }

    // ------------------------------------------------------------------ swaps

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _checkPool(key);
        if (sender == treasury) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        if (params.amountSpecified >= 0) revert ExactOutputNotSupported();
        // sell (THALER in): taxed on the ETH output in afterSwap
        if (!params.zeroForOne) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        uint256 tax = _taxBuy(key, uint256(-params.amountSpecified));
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(tax.toInt128(), 0), 0);
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        _checkPool(key);
        if (sender == treasury) return (IHooks.afterSwap.selector, 0);
        // buy: already taxed in beforeSwap
        if (params.zeroForOne) return (IHooks.afterSwap.selector, 0);

        int128 a0 = delta.amount0();
        uint256 ethOut = a0 > 0 ? uint256(uint128(a0)) : 0;
        uint256 tax = _taxSell(key, ethOut);
        return (IHooks.afterSwap.selector, tax.toInt128());
    }

    /// @dev takes the buy tax to the treasury and records net ETH entering the pool
    function _taxBuy(PoolKey calldata key, uint256 amountIn) internal returns (uint256 tax) {
        tax = amountIn * buyTaxBps() / BPS;
        if (tax > 0) poolManager.take(key.currency0, treasury, tax);
        uint256 epoch = _epoch();
        uint256 net = amountIn - tax;
        _flow[epoch].ethIn += net;
        totalEthIn += net;
        totalTaxed += tax;
        emit Taxed(true, amountIn, tax, epoch);
    }

    /// @dev takes the sell tax to the treasury and records gross ETH leaving the pool
    function _taxSell(PoolKey calldata key, uint256 ethOut) internal returns (uint256 tax) {
        tax = ethOut * sellTaxBps() / BPS;
        if (tax > 0) poolManager.take(key.currency0, treasury, tax);
        uint256 epoch = _epoch();
        _flow[epoch].ethOut += ethOut;
        totalEthOut += ethOut;
        totalTaxed += tax;
        emit Taxed(false, ethOut, tax, epoch);
    }

    function _checkPool(PoolKey calldata key) internal view {
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(_poolId)) revert WrongPool();
    }
}
