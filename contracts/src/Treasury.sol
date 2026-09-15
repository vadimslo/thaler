// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {ITreasury} from "./interfaces/ITreasury.sol";
import {IThalerToken} from "./interfaces/IThalerToken.sol";
import {ICentralBank} from "./interfaces/ICentralBank.sol";

/// @notice Holds all protocol ETH: vault split, buyback+burn, protocol-owned full-range liquidity,
/// pool initialization and the genesis seed.
contract Treasury is ITreasury, IUnlockCallback, Ownable2Step {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    error NotPoolManager();
    error HookAlreadySet();
    error HookNotSet();
    error ZeroAddress();
    error AlreadyInitialized();
    error NotInitialized();
    error AlreadySeeded();
    error ZeroLiquidity();
    error EthTransferFailed();
    error InsufficientVault();

    /// @notice ETH moved out of the expansion vault by the owner (reserve purchases).
    event ExpansionWithdrawn(address to, uint256 amount);

    enum Action {
        Swap,
        AddLiquidity
    }

    uint256 public constant ACTIVE_BPS = 7_000;
    uint256 public constant POL_BPS = 1_500;
    uint256 public constant TEAM_BPS = 1_500;
    uint256 public constant BUYBACK_VAULT_BPS = 1_000;
    uint256 public constant BUYBACK_RESERVE_BPS = 20;
    uint256 public constant TICK_INTERVAL = 1 hours;
    uint256 public constant POL_MIN_COMPOUND = 0.0005 ether;

    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant POOL_TICK_SPACING = 200;
    int24 internal constant TICK_LOWER = -887200;
    int24 internal constant TICK_UPPER = 887200;
    uint256 internal constant BPS = 1e4;

    address public immutable token;
    IPoolManager public immutable poolManager;
    address public immutable centralBank;
    address public immutable team;

    address public hook;
    PoolKey internal _poolKey;
    PoolId internal _poolId;
    bool public poolInitialized;
    bool public seeded;
    /// @dev price passed to initializePool; the pool itself is created inside seedLiquidity
    uint160 public initSqrtPriceX96;

    uint256 public unallocated;
    uint256 public expansionVault;
    uint256 public contractionVault;
    uint256 public polVault;
    uint256 public teamVault;
    uint128 public polLiquidity;
    uint256 public totalBoughtBack;
    uint256 public totalEthSpentOnBuybacks;
    uint256 public lastTick;

    constructor(address _token, IPoolManager _poolManager, address _centralBank, address _team) Ownable(msg.sender) {
        if (_token == address(0) || address(_poolManager) == address(0) || _centralBank == address(0) || _team == address(0)) {
            revert ZeroAddress();
        }
        token = _token;
        poolManager = _poolManager;
        centralBank = _centralBank;
        team = _team;
    }

    /// @dev every inbound ETH (hook tax, charter sales) lands here; must never revert
    receive() external payable {
        unallocated += msg.value;
    }

    // ------------------------------------------------------------------ views

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    function poolEthReserve() public view returns (uint256 ethReserve) {
        if (!poolInitialized) return 0;
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(_poolId);
        if (sqrtPriceX96 == 0) return 0;
        // treasury-owned liquidity only: third-party (JIT) liquidity cannot inflate the per-tick caps
        ethReserve = FullMath.mulDiv(polLiquidity, FixedPoint96.Q96, sqrtPriceX96);
    }

    function nextBuybackAmount() public view returns (uint256) {
        uint256 byVault = contractionVault * BUYBACK_VAULT_BPS / BPS;
        uint256 byReserve = poolEthReserve() * BUYBACK_RESERVE_BPS / BPS;
        return byVault < byReserve ? byVault : byReserve;
    }

    // ------------------------------------------------------------------ allocation

    function allocate() public {
        uint256 a = unallocated;
        if (a == 0) return;
        uint256 toTeam = a * TEAM_BPS / BPS;
        uint256 toPol = a * POL_BPS / BPS;
        uint256 toActive = a - toTeam - toPol;
        // settle every completed epoch first so the split follows the regime of the last completed epoch
        ICentralBank(centralBank).rollEpochs();
        bool contraction = ICentralBank(centralBank).regime() == ICentralBank.Regime.Contraction;
        if (contraction) contractionVault += toActive;
        else expansionVault += toActive;
        polVault += toPol;
        teamVault += toTeam;
        unallocated = 0;
        emit Allocated(a, toActive, toPol, toTeam, contraction);
    }

    function tick() external {
        allocate();
        if (block.timestamp < lastTick + TICK_INTERVAL) return;
        // both swaps are sized from the pre-tick reserve: at most 0.2% of it each, once per interval
        uint256 buyback = nextBuybackAmount();
        uint256 polCap = poolEthReserve() * BUYBACK_RESERVE_BPS / BPS;
        if (buyback > 0) _buyback(buyback);
        if (seeded && polVault >= POL_MIN_COMPOUND) _compoundPol(polCap);
        lastTick = block.timestamp;
    }

    function _buyback(uint256 buyback) internal {
        contractionVault -= buyback;
        (uint256 spent, uint256 got) = _swapEthForThaler(buyback);
        // the pool only stops short of `buyback` at the price limit; whatever it left goes back to the vault
        if (spent < buyback) contractionVault += buyback - spent;
        totalBoughtBack += got;
        totalEthSpentOnBuybacks += spent;
        if (got > 0) IThalerToken(token).burn(got);
        emit Buyback(spent, got);
    }

    /// @dev swaps min(polVault / 2, cap) ETH to THALER and pairs it with the same amount of ETH into the
    ///      full-range position; whatever the cap leaves behind waits for the next interval
    function _compoundPol(uint256 cap) internal {
        uint256 vault = polVault;
        uint256 half = vault / 2;
        if (half > cap) half = cap;
        if (half == 0) return;
        polVault = 0;
        (uint256 spent, uint256 got) = _swapEthForThaler(half);

        (uint128 liquidity, uint256 ethLeft, uint256 thalerLeft, uint256 used0, uint256 used1) =
            _addFullRange(half, got);
        polVault = vault - spent - half + ethLeft;
        polLiquidity += liquidity;
        if (thalerLeft > 0) IThalerToken(token).burn(thalerLeft);
        emit PolCompounded(used0, used1, liquidity, thalerLeft);
    }

    function claimTeam() external onlyOwner {
        uint256 amount = teamVault;
        teamVault = 0;
        _sendEth(team, amount);
        emit TeamClaimed(team, amount);
    }

    /// @notice Moves ETH out of the expansion vault (reserve purchases happen off this contract).
    function withdrawExpansion(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount > expansionVault) revert InsufficientVault();
        expansionVault -= amount;
        _sendEth(to, amount);
        emit ExpansionWithdrawn(to, amount);
    }

    // ------------------------------------------------------------------ wiring & genesis

    function setHook(address _hook) external onlyOwner {
        if (hook != address(0)) revert HookAlreadySet();
        if (_hook == address(0)) revert ZeroAddress();
        hook = _hook;
    }

    function initializePool(uint160 sqrtPriceX96) external onlyOwner {
        if (poolInitialized) revert AlreadyInitialized();
        if (hook == address(0)) revert HookNotSet();
        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(hook)
        });
        _poolKey = key;
        _poolId = key.toId();
        poolInitialized = true;
        initSqrtPriceX96 = sqrtPriceX96;
    }

    /// @dev creates the pool and seeds it in one transaction: an empty pool's price can be moved for free,
    ///      so nothing may run between initialize and the first liquidity
    function seedLiquidity(uint256 thalerAmount) external payable onlyOwner {
        if (!poolInitialized) revert NotInitialized();
        if (seeded) revert AlreadySeeded();
        seeded = true;
        IERC20(token).safeTransferFrom(msg.sender, address(this), thalerAmount);
        poolManager.initialize(_poolKey, initSqrtPriceX96);

        (uint128 liquidity, uint256 ethLeft, uint256 thalerLeft, uint256 used0, uint256 used1) =
            _addFullRange(msg.value, thalerAmount);
        if (liquidity == 0 || used0 == 0 || used1 == 0) revert ZeroLiquidity();
        if (thalerLeft > 0) IThalerToken(token).burn(thalerLeft);
        polVault += ethLeft;
        polLiquidity += liquidity;
        emit Seeded(used0, used1, liquidity);
    }

    // ------------------------------------------------------------------ pool interaction

    /// @dev computes the full-range liquidity for (ethAmount, thalerAmount) and adds it. Fees accrued to the
    /// position are collected on the way and counted into the leftovers.
    function _addFullRange(uint256 ethAmount, uint256 thalerAmount)
        internal
        returns (uint128 liquidity, uint256 ethLeft, uint256 thalerLeft, uint256 used0, uint256 used1)
    {
        liquidity = _liquidityFor(ethAmount, thalerAmount);
        uint256 fee0 = 0;
        uint256 fee1 = 0;
        if (liquidity > 0) {
            bytes memory res = poolManager.unlock(abi.encode(Action.AddLiquidity, uint256(liquidity)));
            (used0, used1, fee0, fee1) = abi.decode(res, (uint256, uint256, uint256, uint256));
        }
        ethLeft = _leftover(ethAmount, used0, fee0);
        thalerLeft = _leftover(thalerAmount, used1, fee1);
    }

    function _liquidityFor(uint256 ethAmount, uint256 thalerAmount) internal view returns (uint128) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(_poolId);
        return LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(TICK_LOWER),
            TickMath.getSqrtPriceAtTick(TICK_UPPER),
            ethAmount,
            thalerAmount
        );
    }

    /// @return spent ETH actually consumed by the pool, got THALER received
    function _swapEthForThaler(uint256 ethIn) internal returns (uint256 spent, uint256 got) {
        if (ethIn == 0) return (0, 0);
        bytes memory res = poolManager.unlock(abi.encode(Action.Swap, ethIn));
        (spent, got) = abi.decode(res, (uint256, uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (Action action, uint256 amount) = abi.decode(data, (Action, uint256));
        if (action == Action.Swap) {
            (uint256 spent, uint256 got) = _doSwap(amount);
            return abi.encode(spent, got);
        }
        (uint256 used0, uint256 used1, uint256 fee0, uint256 fee1) = _doAddLiquidity(uint128(amount));
        return abi.encode(used0, used1, fee0, fee1);
    }

    function _doSwap(uint256 ethIn) internal returns (uint256 spent, uint256 got) {
        BalanceDelta delta = poolManager.swap(
            _poolKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(ethIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );
        spent = _neg(delta.amount0());
        got = _pos(delta.amount1());
        _settleNative(spent);
        _take(_poolKey.currency1, got);
    }

    function _doAddLiquidity(uint128 liquidity)
        internal
        returns (uint256 used0, uint256 used1, uint256 fee0, uint256 fee1)
    {
        (BalanceDelta callerDelta, BalanceDelta feesAccrued) = poolManager.modifyLiquidity(
            _poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );
        BalanceDelta principal = callerDelta - feesAccrued;
        used0 = _neg(principal.amount0());
        used1 = _neg(principal.amount1());
        fee0 = _pos(feesAccrued.amount0());
        fee1 = _pos(feesAccrued.amount1());
        _settleDelta(_poolKey.currency0, callerDelta.amount0());
        _settleDelta(_poolKey.currency1, callerDelta.amount1());
    }

    /// @dev pays a negative delta, takes a positive one
    function _settleDelta(Currency currency, int128 delta) internal {
        if (delta < 0) {
            uint256 amount = _neg(delta);
            if (currency.isAddressZero()) _settleNative(amount);
            else _settleErc20(currency, amount);
        } else if (delta > 0) {
            _take(currency, _pos(delta));
        }
    }

    function _settleNative(uint256 amount) internal {
        if (amount == 0) return;
        poolManager.sync(CurrencyLibrary.ADDRESS_ZERO);
        poolManager.settle{value: amount}();
    }

    function _settleErc20(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _take(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        poolManager.take(currency, address(this), amount);
        // native takes arrive through receive(), which books them as a deposit; the caller books them itself
        if (currency.isAddressZero()) unallocated -= amount;
    }

    // ------------------------------------------------------------------ helpers

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @dev saturating: the pool may round a wei above the computed amount
    function _leftover(uint256 given, uint256 used, uint256 fee) internal pure returns (uint256) {
        uint256 back = given + fee;
        return back > used ? back - used : 0;
    }

    function _neg(int128 x) internal pure returns (uint256) {
        return x < 0 ? uint256(-int256(x)) : 0;
    }

    function _pos(int128 x) internal pure returns (uint256) {
        return x > 0 ? uint256(uint128(x)) : 0;
    }
}
