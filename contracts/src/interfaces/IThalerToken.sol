// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice $THALER. Hard cap 1e9 * 1e18. Only the CentralBank may mint. Anyone may burn their own balance.
interface IThalerToken is IERC20 {
    function CAP() external view returns (uint256);
    function centralBank() external view returns (address);
    function totalBurned() external view returns (uint256);
    /// @dev one-shot, owner only, reverts if already set
    function setCentralBank(address bank) external;
    /// @dev CentralBank only. Reverts if totalSupply + amount > CAP.
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    /// @dev requires allowance, standard ERC20Burnable semantics
    function burnFrom(address account, uint256 amount) external;
}
