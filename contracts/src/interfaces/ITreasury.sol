// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Holds all protocol ETH. Every inbound ETH (hook tax, charter sales) lands in `unallocated` via receive()
/// and is split on `allocate()`: 70% active vault (expansion vault if regime == Expansion, else contraction vault),
/// 15% POL vault, 15% team vault.
/// - contraction vault: buys THALER on the canonical pool and burns everything it buys (`tick`, rate limited)
/// - POL vault: half swapped to THALER, paired with the other half into the full-range position owned by this
///   contract. There is no function to remove liquidity: POL only grows.
/// - expansion vault: accumulates ETH reserves (reserve asset purchases are a later update)
/// - team vault: claimable by owner to `team`
/// Also owns pool initialization and the genesis seed.
interface ITreasury {
    event Allocated(uint256 amount, uint256 toActive, uint256 toPol, uint256 toTeam, bool contraction);
    event Buyback(uint256 ethSpent, uint256 thalerBurned);
    event PolCompounded(uint256 ethUsed, uint256 thalerUsed, uint128 liquidityAdded, uint256 thalerBurnedLeftover);
    event Seeded(uint256 eth, uint256 thaler, uint128 liquidity);
    event TeamClaimed(address to, uint256 amount);

    function ACTIVE_BPS() external view returns (uint256);       // 7_000
    function POL_BPS() external view returns (uint256);          // 1_500
    function TEAM_BPS() external view returns (uint256);         // 1_500
    function BUYBACK_VAULT_BPS() external view returns (uint256);  // 1_000 : max 10% of contraction vault per tick
    function BUYBACK_RESERVE_BPS() external view returns (uint256); // 20 : max 0.2% of pool ETH reserve per tick
    function TICK_INTERVAL() external view returns (uint256);    // 3600
    function POL_MIN_COMPOUND() external view returns (uint256); // wei of ETH before POL compounds

    function token() external view returns (address);
    function centralBank() external view returns (address);
    function hook() external view returns (address);
    function team() external view returns (address);
    function poolKey() external view returns (PoolKey memory);
    function poolInitialized() external view returns (bool);

    function unallocated() external view returns (uint256);
    function expansionVault() external view returns (uint256);
    function contractionVault() external view returns (uint256);
    function polVault() external view returns (uint256);
    function teamVault() external view returns (uint256);
    function polLiquidity() external view returns (uint128);
    function totalBoughtBack() external view returns (uint256);
    function totalEthSpentOnBuybacks() external view returns (uint256);
    function lastTick() external view returns (uint256);

    /// @return ethReserve estimate of pool ETH reserve = liquidity * 2^96 / sqrtPriceX96
    function poolEthReserve() external view returns (uint256 ethReserve);
    function nextBuybackAmount() external view returns (uint256);

    function allocate() external;
    /// @dev permissionless: allocate(), then buyback (if contraction vault > 0 and TICK_INTERVAL passed), then POL compound
    function tick() external;
    function claimTeam() external; // owner

    // ----- wiring & genesis (owner) -----
    function setHook(address hook) external; // one-shot
    /// @dev initializes the ETH/THALER pool with fee 10_000 (1%), tickSpacing 200 and `hook`. one-shot
    function initializePool(uint160 sqrtPriceX96) external;
    /// @dev pulls `thalerAmount` from msg.sender (approve first), pairs with msg.value into the full-range position. one-shot
    function seedLiquidity(uint256 thalerAmount) external payable;
}
