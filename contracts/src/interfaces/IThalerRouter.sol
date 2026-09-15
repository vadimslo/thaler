// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal exact-input router for the canonical pool so the frontend does not need Permit2 / UniversalRouter.
/// Buy: send ETH (msg.value = amountIn). Sell: approve THALER to the router.
interface IThalerRouter {
    event Swapped(address indexed sender, bool indexed buy, uint256 amountIn, uint256 amountOut, address to);
    function treasury() external view returns (address);
    /// @param buy true = ETH -> THALER (zeroForOne), false = THALER -> ETH
    function swapExactIn(bool buy, uint256 amountIn, uint256 minAmountOut, address to, uint256 deadline)
        external payable returns (uint256 amountOut);
}
