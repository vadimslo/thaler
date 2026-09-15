// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The monetary authority. Owns the epoch clock, the issuance multiplier, per-charter branch
/// accounting (MasterChef-style accumulator), expansion licenses (Dutch auction paid in THALER, 100% burned),
/// the withdrawal fee (quadratic decay with charter age; half never minted, half to the other branches) and
/// charter resolution (a final withdrawal, then the NFT is burned).
///
/// Units: multiplier in 1e4 (10_000 = 1.00x). Issuance in wei of THALER per day at 1.00x.
interface ICentralBank {
    enum Regime { Expansion, Contraction }

    event CharterRegistered(uint256 indexed tokenId, address indexed owner);
    event BranchOpened(uint256 indexed tokenId, uint8 branches, uint256 pricePaid);
    event Withdrawn(uint256 indexed tokenId, address indexed to, uint256 amount, uint256 fee);
    event CharterResolved(uint256 indexed tokenId, address indexed to, uint256 paid, uint256 burned, uint256 redistributed);
    event EpochRolled(uint256 indexed epoch, int256 netFlow, uint256 multiplier, Regime regime);
    event HookSet(address hook);

    // ----- constants / params (all public, all published in the whitepaper) -----
    function GENESIS() external view returns (uint256);           // timestamp
    function EPOCH() external view returns (uint256);             // seconds
    function BASE_ISSUANCE_PER_DAY() external view returns (uint256); // 700_000e18
    function ISSUANCE_BUDGET() external view returns (uint256);   // 900_000_000e18
    function MULT_MIN() external view returns (uint256);          // 2_000
    function MULT_MAX() external view returns (uint256);          // 12_500
    function MULT_CUT() external view returns (uint256);          // 1_500
    function MULT_RAISE() external view returns (uint256);        // 1_000
    function MAX_BRANCHES() external view returns (uint8);        // 10
    function LICENSES_PER_DAY() external view returns (uint256);  // 100
    function RESOLVE_FEE_MIN_BPS() external view returns (uint256); // 200 : withdrawal fee once RESOLVE_FEE_PERIOD has passed
    function RESOLVE_FEE_MAX_BPS() external view returns (uint256); // 6000 : withdrawal fee at mint
    function RESOLVE_FEE_PERIOD() external view returns (uint256);  // seconds over which the withdrawal fee decays quadratically

    // ----- state -----
    function token() external view returns (address);
    function charter() external view returns (address);
    function hook() external view returns (address);
    function multiplier() external view returns (uint256);
    function regime() external view returns (Regime);
    function currentEpoch() external view returns (uint256);
    function lastRolledEpoch() external view returns (uint256);
    function consecutivePositive() external view returns (uint256);
    function totalBranches() external view returns (uint256);
    function totalIssued() external view returns (uint256);        // minted via withdraw, counts against ISSUANCE_BUDGET
    function accPerBranch() external view returns (uint256);       // 1e18-scaled accumulator
    function branchesOf(uint256 tokenId) external view returns (uint8);
    function mintedAt(uint256 tokenId) external view returns (uint256);
    function pending(uint256 tokenId) external view returns (uint256);
    /// @return perSecond current issuance rate in wei/sec (BASE * multiplier / 1e4 / 86400), 0 if no branches
    function issuancePerSecond() external view returns (uint256 perSecond);
    function issuancePerBranchPerDay() external view returns (uint256);

    // ----- licenses (expansion) -----
    /// @return price current ask in THALER; opens at 2x last close, decays (4h half-life) to floor = 2 days of one branch's issuance; resets daily
    function licensePrice() external view returns (uint256 price);
    function licensesRemainingToday() external view returns (uint256);
    function lastLicenseClose() external view returns (uint256);
    /// @dev caller must own tokenId and have approved this contract for `licensePrice()` THALER; burns it, branches += 1
    function openBranch(uint256 tokenId) external;

    // ----- withdraw / resolve -----
    /// @dev Settles pending P, charges fee = P * withdrawFeeBps / 1e4 and mints P - fee to the owner, capped by the
    ///      remaining budget (the capped remainder stays owed). Half the fee is never minted, half is credited to the
    ///      accumulator of every branch except this charter's own; with no other branches that half is not minted either.
    /// @return minted THALER minted to the owner
    function withdraw(uint256 tokenId) external returns (uint256 minted);
    /// @return feeBps fee charged on every withdrawal of this charter, resolution included: quadratic decay from
    ///         RESOLVE_FEE_MAX_BPS at mint to RESOLVE_FEE_MIN_BPS once RESOLVE_FEE_PERIOD has passed
    function withdrawFeeBps(uint256 tokenId) external view returns (uint256 feeBps);
    /// @return feeBps same value as withdrawFeeBps: the fee of the final withdrawal performed by resolve
    function resolveFeeBps(uint256 tokenId) external view returns (uint256 feeBps);
    /// @dev A final withdraw (same fee, same split, emits Withdrawn), then the charter's branches leave totalBranches,
    ///      its accounting is deleted and the NFT is burned. Licenses are not refunded.
    /// @return paid THALER minted to the owner by the final withdrawal
    function resolve(uint256 tokenId) external returns (uint256 paid);

    // ----- epochs -----
    /// @dev permissionless. Rolls every completed epoch not yet rolled, reading flow from the hook.
    /// Policy: net(trailing 2 epochs) < 0 -> multiplier -= MULT_CUT (floor MULT_MIN), consecutivePositive = 0.
    ///         trailing >= 0 and epoch net > 0 -> consecutivePositive += 1; when it reaches 2 -> multiplier += MULT_RAISE (cap MULT_MAX), reset to 0.
    ///         trailing >= 0 and epoch net < 0 -> consecutivePositive = 0, multiplier unchanged. Epoch net == 0 changes nothing.
    /// Regime = Contraction if last completed epoch net flow < 0 else Expansion.
    function rollEpochs() external;

    // ----- hooks in -----
    /// @dev CharterNFT only
    function registerCharter(uint256 tokenId, address owner) external;
    function setHook(address hook) external; // owner, one-shot
}
