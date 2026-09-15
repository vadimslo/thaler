// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";

import {IThalerRouter} from "./interfaces/IThalerRouter.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";

/// @notice Minimal exact-input router for the canonical ETH/THALER pool (unlock-callback pattern).
contract ThalerRouter is IThalerRouter, IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using TransientStateLibrary for IPoolManager;

    error NotPoolManager();
    error Expired();
    error ZeroAmount();
    error ZeroAddress();
    error WrongValue();
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);

    struct SwapData {
        PoolKey key;
        bool buy;
        uint256 amountIn;
        address payer;
        address to;
    }

    IPoolManager public immutable poolManager;
    address public immutable treasury;

    constructor(IPoolManager _poolManager, address _treasury) {
        if (address(_poolManager) == address(0) || _treasury == address(0)) revert ZeroAddress();
        poolManager = _poolManager;
        treasury = _treasury;
    }

    function swapExactIn(bool buy, uint256 amountIn, uint256 minAmountOut, address to, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 amountOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        PoolKey memory key = ITreasury(treasury).poolKey();

        if (buy) {
            if (msg.value != amountIn) revert WrongValue();
        } else {
            if (msg.value != 0) revert WrongValue();
            IERC20(Currency.unwrap(key.currency1)).safeTransferFrom(msg.sender, address(this), amountIn);
        }

        bytes memory res = poolManager.unlock(abi.encode(SwapData(key, buy, amountIn, msg.sender, to)));
        amountOut = abi.decode(res, (uint256));
        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);
        emit Swapped(msg.sender, buy, amountIn, amountOut, to);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        SwapData memory d = abi.decode(data, (SwapData));
        Currency cIn = d.buy ? d.key.currency0 : d.key.currency1;
        Currency cOut = d.buy ? d.key.currency1 : d.key.currency0;

        // pay the input before swapping: the hook takes the buy tax from the manager inside the swap,
        // so the manager must already hold it (settling afterwards fails once tax > pool ETH balance)
        _settle(cIn, d.amountIn);

        poolManager.swap(
            d.key,
            SwapParams({
                zeroForOne: d.buy,
                amountSpecified: -int256(d.amountIn),
                sqrtPriceLimitX96: d.buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        _refundUnused(cIn, d.payer);
        uint256 amountOut = _takeOutput(cOut, d.to);
        return abi.encode(amountOut);
    }

    /// @dev whatever the manager says is still ours after the swap is the unconsumed input: back to the payer
    function _refundUnused(Currency currency, address payer) internal {
        int256 delta = poolManager.currencyDelta(address(this), currency);
        if (delta > 0) poolManager.take(currency, payer, uint256(delta));
    }

    function _takeOutput(Currency currency, address to) internal returns (uint256 amountOut) {
        int256 delta = poolManager.currencyDelta(address(this), currency);
        if (delta <= 0) return 0;
        amountOut = uint256(delta);
        poolManager.take(currency, to, amountOut);
    }

    function _settle(Currency currency, uint256 amount) internal {
        if (currency.isAddressZero()) {
            poolManager.sync(CurrencyLibrary.ADDRESS_ZERO);
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
    }
}
