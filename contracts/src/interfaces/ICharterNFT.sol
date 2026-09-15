// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Banking charter. ERC721, soulbound until the owner flips `transfersEnabled`.
/// Founding phase: fixed price, FOUNDING_SUPPLY units, max FOUNDING_PER_WALLET per wallet.
/// After that (and in parallel), a daily Dutch auction in ETH, supply per day set by policy (owner).
/// All ETH proceeds are forwarded to the Treasury (plain transfer, Treasury.receive()).
interface ICharterNFT is IERC721 {
    event FoundingMinted(address indexed to, uint256 indexed tokenId, uint256 price);
    event AuctionBought(address indexed to, uint256 indexed tokenId, uint256 price);
    event AuctionSupplySet(uint256 perDay);
    event TransfersEnabled();

    function FOUNDING_SUPPLY() external view returns (uint256);
    function FOUNDING_PRICE() external view returns (uint256);
    function FOUNDING_PER_WALLET() external view returns (uint256);
    function foundingMinted() external view returns (uint256);
    function foundingMintedBy(address) external view returns (uint256);
    function centralBank() external view returns (address);
    function treasury() external view returns (address);
    function transfersEnabled() external view returns (bool);
    function totalMinted() external view returns (uint256);

    // ----- founding -----
    function mintFounding(uint256 qty) external payable;

    // ----- Dutch auction (ETH) -----
    /// @return price current ask, decays from 3x last close toward `auctionFloor` with 4h half-life, resets daily
    function auctionPrice() external view returns (uint256 price);
    function auctionRemainingToday() external view returns (uint256);
    function auctionPerDay() external view returns (uint256);
    function auctionFloor() external view returns (uint256);
    function lastAuctionClose() external view returns (uint256);
    function buyAtAuction() external payable;
    function setAuctionPerDay(uint256 perDay) external; // owner
    function setAuctionFloor(uint256 floor) external; // owner

    // ----- wiring -----
    function setCentralBank(address bank) external; // owner, one-shot
    function setTreasury(address t) external; // owner, one-shot
    function enableTransfers() external; // owner, irreversible
    /// @dev CentralBank only (charter resolution)
    function burnFromBank(uint256 tokenId) external;
}
