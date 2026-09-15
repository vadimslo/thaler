// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IThalerToken} from "./interfaces/IThalerToken.sol";

/// @title ThalerToken ($THALER)
/// @notice Hard-capped ERC20. The CentralBank is the only minter (set once by the owner).
///         The constructor mints the 100M genesis seed to the deployer. Anyone may burn their own balance;
///         `burnFrom` follows standard ERC20Burnable allowance semantics.
contract ThalerToken is ERC20, Ownable2Step, IThalerToken {
    /// @inheritdoc IThalerToken
    uint256 public constant CAP = 1_000_000_000e18;
    /// @notice Minted to the deployer at construction (genesis liquidity seed).
    uint256 public constant GENESIS_MINT = 100_000_000e18;

    /// @inheritdoc IThalerToken
    address public centralBank;
    /// @inheritdoc IThalerToken
    uint256 public totalBurned;

    event CentralBankSet(address indexed bank);

    error NotCentralBank();
    error CentralBankAlreadySet();
    error ZeroAddress();
    error CapExceeded(uint256 requested, uint256 available);

    constructor() ERC20("Thaler", "THALER") Ownable(msg.sender) {
        _mint(msg.sender, GENESIS_MINT);
    }

    /// @inheritdoc IThalerToken
    function setCentralBank(address bank) external onlyOwner {
        if (centralBank != address(0)) revert CentralBankAlreadySet();
        if (bank == address(0)) revert ZeroAddress();
        centralBank = bank;
        emit CentralBankSet(bank);
    }

    /// @inheritdoc IThalerToken
    function mint(address to, uint256 amount) external {
        if (msg.sender != centralBank) revert NotCentralBank();
        uint256 supply = totalSupply();
        if (supply + amount > CAP) revert CapExceeded(amount, CAP - supply);
        _mint(to, amount);
    }

    /// @inheritdoc IThalerToken
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        totalBurned += amount;
    }

    /// @inheritdoc IThalerToken
    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
        totalBurned += amount;
    }
}
