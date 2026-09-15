// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {ICharterNFT} from "./interfaces/ICharterNFT.sol";
import {ICentralBank} from "./interfaces/ICentralBank.sol";
import {Decay} from "./base/Decay.sol";

/// @title CharterNFT
/// @notice Banking charter. Soulbound ERC721 until the owner enables transfers.
///         Founding phase: fixed price, FOUNDING_SUPPLY units, FOUNDING_PER_WALLET per wallet.
///         In parallel: a daily Dutch auction in ETH (independent supply, set by the owner).
///         Every mint registers the charter with the CentralBank; all ETH is forwarded to the Treasury.
contract CharterNFT is ERC721, Ownable2Step, ICharterNFT {
    using Strings for uint256;

    // ----- constants (identical on testnet and mainnet) -----
    /// @inheritdoc ICharterNFT
    uint256 public constant FOUNDING_SUPPLY = 1000;
    /// @inheritdoc ICharterNFT
    uint256 public constant FOUNDING_PER_WALLET = 3;
    /// @notice Auction opens each day at this multiple of the last close (or of the floor if no close yet).
    uint256 public constant AUCTION_OPEN_MULTIPLE = 3;
    /// @notice Half-life of the auction price decay toward the floor.
    uint256 public constant AUCTION_HALF_LIFE = 4 hours;

    // ----- immutables (vary between testnet and mainnet) -----
    /// @inheritdoc ICharterNFT
    uint256 public immutable FOUNDING_PRICE;

    // ----- wiring -----
    /// @inheritdoc ICharterNFT
    address public centralBank;
    /// @inheritdoc ICharterNFT
    address public treasury;
    /// @inheritdoc ICharterNFT
    bool public transfersEnabled;

    // ----- supply -----
    /// @inheritdoc ICharterNFT
    uint256 public totalMinted;
    /// @inheritdoc ICharterNFT
    uint256 public foundingMinted;
    /// @inheritdoc ICharterNFT
    mapping(address => uint256) public foundingMintedBy;

    // ----- auction -----
    /// @inheritdoc ICharterNFT
    uint256 public auctionPerDay;
    /// @inheritdoc ICharterNFT
    uint256 public auctionFloor;
    /// @inheritdoc ICharterNFT
    uint256 public lastAuctionClose;
    uint256 private _auctionDay;
    uint256 private _auctionSoldToday;

    event AuctionFloorSet(uint256 floor);
    event CentralBankSet(address indexed bank);
    event TreasurySet(address indexed treasury);

    error NotCentralBank();
    error NotWired();
    error AlreadySet();
    error ZeroAddress();
    error ZeroQuantity();
    error FoundingSupplyExceeded();
    error FoundingWalletLimitExceeded();
    error WrongPayment(uint256 expected, uint256 sent);
    error InsufficientPayment(uint256 price, uint256 sent);
    error AuctionSoldOutToday();
    error Soulbound();
    error EthTransferFailed(address to, uint256 amount);

    /// @param foundingPrice_ price per founding charter in wei (testnet 0.001 ether, mainnet 0.15 ether)
    /// @param auctionPerDay_ initial daily auction supply (testnet 10; owner-settable)
    /// @param auctionFloor_ initial auction floor in wei (testnet 0.001 ether; owner-settable)
    constructor(uint256 foundingPrice_, uint256 auctionPerDay_, uint256 auctionFloor_)
        ERC721("Thaler Charter", "CHARTER")
        Ownable(msg.sender)
    {
        FOUNDING_PRICE = foundingPrice_;
        auctionPerDay = auctionPerDay_;
        auctionFloor = auctionFloor_;
    }

    // ============================================================
    //                          founding
    // ============================================================

    /// @inheritdoc ICharterNFT
    function mintFounding(uint256 qty) external payable {
        _requireWired();
        if (qty == 0) revert ZeroQuantity();
        if (foundingMinted + qty > FOUNDING_SUPPLY) revert FoundingSupplyExceeded();
        if (foundingMintedBy[msg.sender] + qty > FOUNDING_PER_WALLET) revert FoundingWalletLimitExceeded();
        uint256 cost = qty * FOUNDING_PRICE;
        if (msg.value != cost) revert WrongPayment(cost, msg.value);

        foundingMinted += qty;
        foundingMintedBy[msg.sender] += qty;

        for (uint256 i = 0; i < qty; ++i) {
            uint256 tokenId = _mintCharter(msg.sender);
            emit FoundingMinted(msg.sender, tokenId, FOUNDING_PRICE);
        }

        _send(treasury, cost);
    }

    // ============================================================
    //                       Dutch auction (ETH)
    // ============================================================

    /// @inheritdoc ICharterNFT
    function auctionPrice() public view returns (uint256 price) {
        uint256 start = lastAuctionClose == 0
            ? AUCTION_OPEN_MULTIPLE * auctionFloor
            : AUCTION_OPEN_MULTIPLE * lastAuctionClose;
        uint256 elapsed = block.timestamp % 1 days; // since the start of the current day
        price = Decay.decay(start, auctionFloor, elapsed, AUCTION_HALF_LIFE);
    }

    /// @inheritdoc ICharterNFT
    function auctionRemainingToday() public view returns (uint256) {
        uint256 sold = _auctionDay == block.timestamp / 1 days ? _auctionSoldToday : 0;
        return auctionPerDay > sold ? auctionPerDay - sold : 0;
    }

    /// @inheritdoc ICharterNFT
    function buyAtAuction() external payable {
        _requireWired();

        uint256 today = block.timestamp / 1 days;
        if (_auctionDay != today) {
            _auctionDay = today;
            _auctionSoldToday = 0;
        }
        if (_auctionSoldToday >= auctionPerDay) revert AuctionSoldOutToday();

        uint256 price = auctionPrice();
        if (msg.value < price) revert InsufficientPayment(price, msg.value);

        _auctionSoldToday += 1;
        lastAuctionClose = price;

        uint256 tokenId = _mintCharter(msg.sender);
        emit AuctionBought(msg.sender, tokenId, price);

        _send(treasury, price);
        uint256 excess = msg.value - price;
        if (excess > 0) _send(msg.sender, excess);
    }

    /// @inheritdoc ICharterNFT
    function setAuctionPerDay(uint256 perDay) external onlyOwner {
        auctionPerDay = perDay;
        emit AuctionSupplySet(perDay);
    }

    /// @inheritdoc ICharterNFT
    function setAuctionFloor(uint256 floor) external onlyOwner {
        auctionFloor = floor;
        emit AuctionFloorSet(floor);
    }

    // ============================================================
    //                            wiring
    // ============================================================

    /// @inheritdoc ICharterNFT
    function setCentralBank(address bank) external onlyOwner {
        if (centralBank != address(0)) revert AlreadySet();
        if (bank == address(0)) revert ZeroAddress();
        centralBank = bank;
        emit CentralBankSet(bank);
    }

    /// @inheritdoc ICharterNFT
    function setTreasury(address t) external onlyOwner {
        if (treasury != address(0)) revert AlreadySet();
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasurySet(t);
    }

    /// @inheritdoc ICharterNFT
    function enableTransfers() external onlyOwner {
        if (transfersEnabled) revert AlreadySet();
        transfersEnabled = true;
        emit TransfersEnabled();
    }

    /// @inheritdoc ICharterNFT
    function burnFromBank(uint256 tokenId) external {
        if (msg.sender != centralBank) revert NotCentralBank();
        _burn(tokenId);
    }

    // ============================================================
    //                           metadata
    // ============================================================

    /// @notice On-chain data URI with a tiny JSON: name, description, and the charter's branch count.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint256 branches = ICentralBank(centralBank).branchesOf(tokenId);
        string memory json = string.concat(
            '{"name":"Thaler Charter #',
            tokenId.toString(),
            '","description":"A Thaler banking charter. Accrues THALER issuance per branch.",',
            '"attributes":[{"trait_type":"Branches","value":',
            branches.toString(),
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // ============================================================
    //                          internals
    // ============================================================

    /// @dev Soulbound: while transfers are disabled, only mints (from == 0) and burns (to == 0) pass.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && !transfersEnabled) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function _mintCharter(address to) internal returns (uint256 tokenId) {
        tokenId = ++totalMinted; // sequential ids starting at 1
        _mint(to, tokenId);
        ICentralBank(centralBank).registerCharter(tokenId, to);
    }

    function _requireWired() internal view {
        if (centralBank == address(0) || treasury == address(0)) revert NotWired();
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed(to, amount);
    }
}
