// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Uniswap v4 hook on the canonical ETH/THALER pool. currency0 = native ETH (address 0), currency1 = THALER.
/// Taxes swaps in ETH (buy tax on ETH input in beforeSwap, sell tax on ETH output in afterSwap), sends tax to Treasury,
/// and records gross ETH in / out per CentralBank epoch. Exact-output swaps are not supported in v1 (revert).
/// Treasury is tax-exempt (buybacks and POL compounding).
interface IFlowHook {
    event Taxed(bool indexed isBuy, uint256 ethAmount, uint256 tax, uint256 epoch);
    event PoolBound(bytes32 poolId);

    function centralBank() external view returns (address);
    function treasury() external view returns (address);
    function poolKey() external view returns (PoolKey memory);
    function poolBound() external view returns (bool);

    // tax schedule: rate = floor + (LAUNCH_RATE - floor) * 0.5^(elapsed / HALF_LIFE)
    function LAUNCH_TAX_BPS() external view returns (uint256);   // 9_000
    function BUY_FLOOR_BPS() external view returns (uint256);    // 200
    function SELL_FLOOR_BPS() external view returns (uint256);   // 300
    function TAX_HALF_LIFE() external view returns (uint256);    // seconds
    function launchedAt() external view returns (uint256);       // set when pool initialized
    function buyTaxBps() external view returns (uint256);
    function sellTaxBps() external view returns (uint256);

    /// @return ethIn gross ETH that entered via buys, ethOut gross ETH that left via sells, for a CentralBank epoch index
    function flowOf(uint256 epoch) external view returns (uint256 ethIn, uint256 ethOut);
    function totalEthIn() external view returns (uint256);
    function totalEthOut() external view returns (uint256);
    function totalTaxed() external view returns (uint256);
}
