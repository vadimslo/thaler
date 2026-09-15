// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ICentralBank} from "./interfaces/ICentralBank.sol";
import {ICharterNFT} from "./interfaces/ICharterNFT.sol";
import {IThalerToken} from "./interfaces/IThalerToken.sol";
import {IFlowHook} from "./interfaces/IFlowHook.sol";
import {Decay} from "./base/Decay.sol";

/// @title CentralBank
/// @notice The monetary authority: epoch clock, issuance multiplier, per-charter branch accounting
///         (MasterChef-style accumulator), expansion licenses (Dutch auction in THALER, 100% burned), the
///         withdrawal fee (quadratic decay with charter age; half never minted, half to the other branches)
///         and charter resolution (a final withdrawal, then the NFT is burned).
contract CentralBank is Ownable2Step, ICentralBank {
    // ============================================================
    //                    constants (same on all networks)
    // ============================================================

    /// @inheritdoc ICentralBank
    uint256 public constant BASE_ISSUANCE_PER_DAY = 700_000e18;
    /// @inheritdoc ICentralBank
    uint256 public constant ISSUANCE_BUDGET = 900_000_000e18;
    /// @notice Multiplier at genesis (1.00x).
    uint256 public constant MULT_START = 10_000;
    /// @inheritdoc ICentralBank
    uint256 public constant MULT_MIN = 2_000;
    /// @inheritdoc ICentralBank
    uint256 public constant MULT_MAX = 12_500;
    /// @inheritdoc ICentralBank
    uint256 public constant MULT_CUT = 1_500;
    /// @inheritdoc ICentralBank
    uint256 public constant MULT_RAISE = 1_000;
    /// @inheritdoc ICentralBank
    uint8 public constant MAX_BRANCHES = 10;
    /// @inheritdoc ICentralBank
    uint256 public constant LICENSES_PER_DAY = 100;
    /// @notice License ask opens each day at this multiple of the last close.
    uint256 public constant LICENSE_OPEN_MULTIPLE = 2;
    /// @notice Half-life of the license price decay toward the floor.
    uint256 public constant LICENSE_HALF_LIFE = 4 hours;
    /// @notice License floor = this many days of one branch's issuance.
    uint256 public constant LICENSE_FLOOR_DAYS = 2;
    /// @notice Absolute minimum license price.
    uint256 public constant LICENSE_MIN_PRICE = 1e18;
    /// @inheritdoc ICentralBank
    uint256 public constant RESOLVE_FEE_MIN_BPS = 200;
    /// @inheritdoc ICentralBank
    uint256 public constant RESOLVE_FEE_MAX_BPS = 6_000;
    /// @notice Upper bound on epochs rolled per call; a further call continues.
    uint256 public constant MAX_EPOCHS_PER_ROLL = 50;

    uint256 private constant BPS = 1e4;
    uint256 private constant ACC_PRECISION = 1e18;

    // ============================================================
    //                 immutables (vary by network)
    // ============================================================

    /// @inheritdoc ICentralBank
    uint256 public immutable GENESIS;
    /// @inheritdoc ICentralBank
    uint256 public immutable EPOCH;
    /// @inheritdoc ICentralBank
    uint256 public immutable RESOLVE_FEE_PERIOD;
    /// @inheritdoc ICentralBank
    address public immutable token;
    /// @inheritdoc ICentralBank
    address public immutable charter;

    // ============================================================
    //                            state
    // ============================================================

    struct Charter {
        uint8 branches;
        uint256 mintedAt;
        uint256 debt; // branches * accPerBranch / 1e18 at last settlement
        uint256 owed; // settled but not yet minted
    }

    /// @inheritdoc ICentralBank
    address public hook;
    /// @inheritdoc ICentralBank
    uint256 public multiplier;
    /// @inheritdoc ICentralBank
    Regime public regime;
    /// @inheritdoc ICentralBank
    uint256 public consecutivePositive;
    /// @inheritdoc ICentralBank
    uint256 public totalBranches;
    /// @inheritdoc ICentralBank
    uint256 public totalIssued;
    /// @inheritdoc ICentralBank
    uint256 public accPerBranch;
    /// @notice Timestamp of the last accumulator update.
    uint256 public lastUpdate;
    /// @notice Withdrawal-fee THALER that never entered supply: the unminted half of every fee, plus the
    ///         redistributed half whenever there were no other branches to receive it.
    uint256 public totalFeesUnminted;
    /// @inheritdoc ICentralBank
    uint256 public lastLicenseClose;

    uint256 private _nextEpoch; // index of the next epoch to roll (== number of epochs rolled so far)
    uint256 private _licenseDay;
    uint256 private _licensesSoldToday;
    mapping(uint256 tokenId => Charter) private _charters;

    error ZeroAddress();
    error ZeroParam();
    error NotCharter();
    error NotCharterOwner();
    error AlreadyRegistered();
    error HookAlreadySet();
    error MaxBranchesReached();
    error NoLicensesToday();
    error BudgetExhausted();

    /// @param token_ ThalerToken
    /// @param charter_ CharterNFT
    /// @param epoch_ epoch length in seconds (testnet 6 hours, mainnet 3 days)
    /// @param resolveFeePeriod_ seconds over which the withdrawal fee decays quadratically (testnet 30 days, mainnet 365 days)
    constructor(address token_, address charter_, uint256 epoch_, uint256 resolveFeePeriod_) Ownable(msg.sender) {
        if (token_ == address(0) || charter_ == address(0)) revert ZeroAddress();
        if (epoch_ == 0 || resolveFeePeriod_ == 0) revert ZeroParam();
        token = token_;
        charter = charter_;
        EPOCH = epoch_;
        RESOLVE_FEE_PERIOD = resolveFeePeriod_;
        GENESIS = block.timestamp;
        lastUpdate = block.timestamp;
        multiplier = MULT_START;
        regime = Regime.Expansion;
    }

    // ============================================================
    //                            views
    // ============================================================

    /// @inheritdoc ICentralBank
    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - GENESIS) / EPOCH;
    }

    /// @inheritdoc ICentralBank
    function lastRolledEpoch() external view returns (uint256) {
        return _nextEpoch == 0 ? 0 : _nextEpoch - 1;
    }

    /// @inheritdoc ICentralBank
    function branchesOf(uint256 tokenId) external view returns (uint8) {
        return _charters[tokenId].branches;
    }

    /// @inheritdoc ICentralBank
    function mintedAt(uint256 tokenId) external view returns (uint256) {
        return _charters[tokenId].mintedAt;
    }

    /// @inheritdoc ICentralBank
    function pending(uint256 tokenId) public view returns (uint256) {
        Charter storage c = _charters[tokenId];
        if (c.branches == 0) return c.owed;
        return uint256(c.branches) * _accNow() / ACC_PRECISION - c.debt + c.owed;
    }

    /// @inheritdoc ICentralBank
    function issuancePerSecond() public view returns (uint256 perSecond) {
        if (totalBranches == 0) return 0;
        return BASE_ISSUANCE_PER_DAY * multiplier / BPS / 1 days;
    }

    /// @inheritdoc ICentralBank
    function issuancePerBranchPerDay() public view returns (uint256) {
        uint256 perDay = BASE_ISSUANCE_PER_DAY * multiplier / BPS;
        return totalBranches == 0 ? perDay : perDay / totalBranches;
    }

    /// @inheritdoc ICentralBank
    function licensePrice() public view returns (uint256 price) {
        uint256 floor = LICENSE_FLOOR_DAYS * issuancePerBranchPerDay();
        if (floor < LICENSE_MIN_PRICE) floor = LICENSE_MIN_PRICE;
        uint256 start = lastLicenseClose == 0 ? floor : LICENSE_OPEN_MULTIPLE * lastLicenseClose;
        uint256 elapsed = block.timestamp % 1 days; // since the start of the current day
        price = Decay.decay(start, floor, elapsed, LICENSE_HALF_LIFE);
    }

    /// @inheritdoc ICentralBank
    function licensesRemainingToday() public view returns (uint256) {
        uint256 sold = _licenseDay == block.timestamp / 1 days ? _licensesSoldToday : 0;
        return LICENSES_PER_DAY > sold ? LICENSES_PER_DAY - sold : 0;
    }

    /// @notice Alias of `totalFeesUnminted`.
    function totalResolveBurned() external view returns (uint256) {
        return totalFeesUnminted;
    }

    /// @inheritdoc ICentralBank
    function withdrawFeeBps(uint256 tokenId) external view returns (uint256 feeBps) {
        return resolveFeeBps(tokenId);
    }

    /// @inheritdoc ICentralBank
    function resolveFeeBps(uint256 tokenId) public view returns (uint256 feeBps) {
        uint256 age = block.timestamp - _charters[tokenId].mintedAt;
        if (age >= RESOLVE_FEE_PERIOD) return RESOLVE_FEE_MIN_BPS;
        uint256 remaining = RESOLVE_FEE_PERIOD - age;
        return RESOLVE_FEE_MIN_BPS
            + (RESOLVE_FEE_MAX_BPS - RESOLVE_FEE_MIN_BPS) * remaining * remaining / (RESOLVE_FEE_PERIOD * RESOLVE_FEE_PERIOD);
    }

    // ============================================================
    //                    licenses (expansion)
    // ============================================================

    /// @inheritdoc ICentralBank
    function openBranch(uint256 tokenId) external {
        _rollEpochs();
        _update();
        _requireOwner(tokenId);
        if (totalIssued >= ISSUANCE_BUDGET) revert BudgetExhausted();

        Charter storage c = _charters[tokenId];
        if (c.branches >= MAX_BRANCHES) revert MaxBranchesReached();

        uint256 today = block.timestamp / 1 days;
        if (_licenseDay != today) {
            _licenseDay = today;
            _licensesSoldToday = 0;
        }
        if (_licensesSoldToday >= LICENSES_PER_DAY) revert NoLicensesToday();

        uint256 price = licensePrice();
        IThalerToken(token).burnFrom(msg.sender, price);
        lastLicenseClose = price;
        _licensesSoldToday += 1;

        _settle(c);
        c.branches += 1;
        c.debt = uint256(c.branches) * accPerBranch / ACC_PRECISION;
        totalBranches += 1;

        emit BranchOpened(tokenId, c.branches, price);
    }

    // ============================================================
    //                      withdraw / resolve
    // ============================================================

    /// @inheritdoc ICentralBank
    function withdraw(uint256 tokenId) external returns (uint256 minted) {
        _rollEpochs();
        _update();
        address holder = _requireOwner(tokenId);
        (minted,,,) = _withdraw(tokenId, holder);
    }

    /// @inheritdoc ICentralBank
    function resolve(uint256 tokenId) external returns (uint256 paid) {
        _rollEpochs();
        _update();
        address holder = _requireOwner(tokenId);

        uint256 burned;
        uint256 redistributed;
        (paid,, burned, redistributed) = _withdraw(tokenId, holder);

        totalBranches -= _charters[tokenId].branches;
        delete _charters[tokenId];
        ICharterNFT(charter).burnFromBank(tokenId);

        emit CharterResolved(tokenId, holder, paid, burned, redistributed);
    }

    // ============================================================
    //                            epochs
    // ============================================================

    /// @inheritdoc ICentralBank
    function rollEpochs() external {
        _rollEpochs();
        _update();
    }

    // ============================================================
    //                           hooks in
    // ============================================================

    /// @inheritdoc ICentralBank
    function registerCharter(uint256 tokenId, address holder) external {
        if (msg.sender != charter) revert NotCharter();
        _rollEpochs();
        _update();

        Charter storage c = _charters[tokenId];
        if (c.mintedAt != 0) revert AlreadyRegistered();
        c.branches = 1;
        c.mintedAt = block.timestamp;
        c.debt = accPerBranch / ACC_PRECISION;
        totalBranches += 1;

        emit CharterRegistered(tokenId, holder);
    }

    /// @inheritdoc ICentralBank
    function setHook(address hook_) external onlyOwner {
        if (hook != address(0)) revert HookAlreadySet();
        if (hook_ == address(0)) revert ZeroAddress();
        hook = hook_;
        emit HookSet(hook_);
    }

    // ============================================================
    //                          internals
    // ============================================================

    /// @dev Accumulator as of now (stored value plus unbooked accrual).
    function _accNow() internal view returns (uint256) {
        if (totalBranches == 0) return accPerBranch;
        return accPerBranch + issuancePerSecond() * (block.timestamp - lastUpdate) * ACC_PRECISION / totalBranches;
    }

    /// @dev Books accrual since lastUpdate at the current multiplier.
    function _update() internal {
        _bookTo(block.timestamp, multiplier);
    }

    /// @dev Books accrual from lastUpdate up to `ts` at multiplier `mult`; no-op if `ts` is not in the future
    ///      of the last booking.
    function _bookTo(uint256 ts, uint256 mult) internal {
        if (ts <= lastUpdate) return;
        if (totalBranches > 0) {
            uint256 perSecond = BASE_ISSUANCE_PER_DAY * mult / BPS / 1 days;
            accPerBranch += perSecond * (ts - lastUpdate) * ACC_PRECISION / totalBranches;
        }
        lastUpdate = ts;
    }

    /// @dev Moves everything accrued since the last settlement into `owed` and resets the debt.
    function _settle(Charter storage c) internal {
        uint256 entitled = uint256(c.branches) * accPerBranch / ACC_PRECISION;
        c.owed += entitled - c.debt;
        c.debt = entitled;
    }

    /// @dev Settles the charter, charges the withdrawal fee on everything pending and mints the rest to `holder`
    ///      (budget-capped; the capped remainder stays owed). Half the fee is never minted, half is credited to
    ///      the accumulator of every other branch; the charter's own debt is re-based so it does not receive its
    ///      own fee. With no other branches the redistributed half is not minted either.
    function _withdraw(uint256 tokenId, address holder)
        internal
        returns (uint256 minted, uint256 fee, uint256 burned, uint256 redistributed)
    {
        Charter storage c = _charters[tokenId];
        _settle(c);
        uint256 total = c.owed;
        fee = total * resolveFeeBps(tokenId) / BPS;
        uint256 net = total - fee;
        uint256 room = ISSUANCE_BUDGET - totalIssued; // never mint over the budget
        minted = net > room ? room : net;
        c.owed = net - minted;

        redistributed = fee / 2;
        burned = fee - redistributed;
        uint256 others = totalBranches - c.branches;
        if (others > 0 && redistributed > 0) {
            accPerBranch += redistributed * ACC_PRECISION / others;
            c.debt = uint256(c.branches) * accPerBranch / ACC_PRECISION;
        } else {
            burned += redistributed;
            redistributed = 0;
        }
        totalFeesUnminted += burned;

        if (minted > 0) {
            totalIssued += minted;
            IThalerToken(token).mint(holder, minted);
        }
        emit Withdrawn(tokenId, holder, minted, fee);
    }

    function _requireOwner(uint256 tokenId) internal view returns (address holder) {
        holder = ICharterNFT(charter).ownerOf(tokenId);
        if (msg.sender != holder) revert NotCharterOwner();
    }

    /// @dev Rolls every completed epoch not yet rolled (bounded by MAX_EPOCHS_PER_ROLL).
    ///      Accrual up to the end of each epoch is booked at the multiplier that governed that epoch
    ///      before its policy is applied, however late the roll happens.
    function _rollEpochs() internal {
        uint256 cur = currentEpoch();
        uint256 e = _nextEpoch;
        if (e >= cur) return;

        uint256 stop = cur - e > MAX_EPOCHS_PER_ROLL ? e + MAX_EPOCHS_PER_ROLL : cur;
        address h = hook;
        int256 prevNet = e == 0 ? int256(0) : _netFlow(h, e - 1);
        uint256 mult = multiplier;
        uint256 streak = consecutivePositive;
        Regime r = regime;

        for (; e < stop; ++e) {
            _bookTo(GENESIS + (e + 1) * EPOCH, mult);
            int256 net = _netFlow(h, e);
            int256 trailing = net + prevNet;

            if (trailing < 0) {
                mult = mult > MULT_MIN + MULT_CUT ? mult - MULT_CUT : MULT_MIN;
                streak = 0;
            } else if (net > 0) {
                streak += 1;
                if (streak >= 2) {
                    mult = mult + MULT_RAISE < MULT_MAX ? mult + MULT_RAISE : MULT_MAX;
                    streak = 0;
                }
            } else if (net < 0) {
                streak = 0; // an outflow epoch breaks the streak even when the trailing window is still non-negative
            }
            r = net < 0 ? Regime.Contraction : Regime.Expansion;

            emit EpochRolled(e, net, mult, r);
            prevNet = net;
        }

        multiplier = mult;
        consecutivePositive = streak;
        regime = r;
        _nextEpoch = e;
    }

    function _netFlow(address h, uint256 epoch) internal view returns (int256) {
        if (h == address(0)) return 0;
        (uint256 ethIn, uint256 ethOut) = IFlowHook(h).flowOf(epoch);
        return int256(ethIn) - int256(ethOut);
    }
}
