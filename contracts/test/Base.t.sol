// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

import {ThalerToken} from "../src/ThalerToken.sol";
import {CharterNFT} from "../src/CharterNFT.sol";
import {CentralBank} from "../src/CentralBank.sol";
import {Treasury} from "../src/Treasury.sol";
import {FlowHook} from "../src/FlowHook.sol";
import {ThalerRouter} from "../src/ThalerRouter.sol";
import {ICentralBank} from "../src/interfaces/ICentralBank.sol";

/// @notice Shared fixture: the full system deployed in the DESIGN.md order with testnet params,
///         a real PoolManager, the hook etched at a flag-correct address, and the genesis seed
///         of 100M THALER against 1 ETH.
abstract contract BaseTest is Test {
    using PoolIdLibrary for PoolKey;

    // ----- testnet params -----
    uint256 internal constant EPOCH = 6 hours;
    uint256 internal constant RESOLVE_FEE_PERIOD = 30 days;
    uint256 internal constant FOUNDING_PRICE = 0.001 ether;
    uint256 internal constant AUCTION_PER_DAY = 10;
    uint256 internal constant AUCTION_FLOOR = 0.001 ether;

    // ----- genesis seed: 1 ETH pairs with 100M THALER, i.e. 1e8 THALER per ETH -----
    uint256 internal constant SEED_THALER = 100_000_000e18;
    uint256 internal constant SEED_ETH = 1 ether;
    /// @dev sqrt(1e8) * 2^96 = 1e4 * 2^96
    uint160 internal constant SQRT_PRICE_X96 = 79228162514264337593543950336 * 10000;

    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    // ----- actors -----
    address internal team = makeAddr("team");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    // ----- system -----
    PoolManager internal pm;
    ThalerToken internal token;
    CharterNFT internal charter;
    CentralBank internal bank;
    Treasury internal treasury;
    FlowHook internal hook;
    ThalerRouter internal router;
    PoolKey internal key;
    PoolId internal poolId;

    uint256 internal genesis;

    function setUp() public virtual {
        pm = new PoolManager(address(0));

        // deploy order per DESIGN.md
        token = new ThalerToken();
        charter = new CharterNFT(FOUNDING_PRICE, AUCTION_PER_DAY, AUCTION_FLOOR);
        bank = new CentralBank(address(token), address(charter), EPOCH, RESOLVE_FEE_PERIOD);
        token.setCentralBank(address(bank));
        charter.setCentralBank(address(bank));
        treasury = new Treasury(address(token), pm, address(bank), team);
        charter.setTreasury(address(treasury));

        address hookAddr = address(HOOK_FLAGS ^ (uint160(0x4444) << 144));
        deployCodeTo("FlowHook.sol:FlowHook", abi.encode(pm, address(bank), address(treasury)), hookAddr);
        hook = FlowHook(hookAddr);

        bank.setHook(hookAddr);
        treasury.setHook(hookAddr);
        router = new ThalerRouter(pm, address(treasury));

        treasury.initializePool(SQRT_PRICE_X96);
        token.approve(address(treasury), SEED_THALER);
        treasury.seedLiquidity{value: SEED_ETH}(SEED_THALER);

        key = treasury.poolKey();
        poolId = key.toId();
        genesis = bank.GENESIS();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);

        vm.label(address(pm), "PoolManager");
        vm.label(address(token), "THALER");
        vm.label(address(charter), "CharterNFT");
        vm.label(address(bank), "CentralBank");
        vm.label(address(treasury), "Treasury");
        vm.label(hookAddr, "FlowHook");
        vm.label(address(router), "Router");
        vm.label(team, "team");
    }

    // ----- helpers -----

    /// @dev ETH -> THALER through the router; output lands on `user`.
    function buy(address user, uint256 ethIn) internal returns (uint256 amountOut) {
        vm.prank(user);
        amountOut = router.swapExactIn{value: ethIn}(true, ethIn, 0, user, type(uint256).max);
    }

    /// @dev THALER -> ETH through the router; output lands on `user`.
    function sell(address user, uint256 thalerIn) internal returns (uint256 amountOut) {
        vm.startPrank(user);
        token.approve(address(router), thalerIn);
        amountOut = router.swapExactIn(false, thalerIn, 0, user, type(uint256).max);
        vm.stopPrank();
    }

    /// @dev balance >= sum of vaults, equal up to dust.
    function assertTreasuryInvariant() internal view {
        uint256 booked = treasury.unallocated() + treasury.expansionVault() + treasury.contractionVault()
            + treasury.polVault() + treasury.teamVault();
        uint256 bal = address(treasury).balance;
        assertGe(bal, booked, "treasury balance < booked vaults");
        assertLe(bal - booked, 16, "treasury dust too large");
    }

    /// @dev Withdrawal fee in bps at charter age `age`: 200 + 5800 * ((PERIOD - age) / PERIOD)^2, 200 once the period has passed.
    function feeBpsAt(uint256 age) internal pure returns (uint256) {
        if (age >= RESOLVE_FEE_PERIOD) return 200;
        uint256 rem = RESOLVE_FEE_PERIOD - age;
        return 200 + 5800 * rem * rem / (RESOLVE_FEE_PERIOD * RESOLVE_FEE_PERIOD);
    }

    /// @dev Replays the CentralBank multiplier policy over the hook's recorded flow for epochs [0, last].
    function replayPolicy(uint256 last)
        internal
        view
        returns (uint256 mult, uint256 streak, ICentralBank.Regime regime)
    {
        mult = 10_000;
        regime = ICentralBank.Regime.Expansion;
        int256 prevNet = 0;
        for (uint256 e = 0; e <= last; ++e) {
            (uint256 ethIn, uint256 ethOut) = hook.flowOf(e);
            int256 net = int256(ethIn) - int256(ethOut);
            int256 trailing = net + prevNet;
            if (trailing < 0) {
                mult = mult > bank.MULT_MIN() + bank.MULT_CUT() ? mult - bank.MULT_CUT() : bank.MULT_MIN();
                streak = 0;
            } else if (net > 0) {
                streak += 1;
                if (streak >= 2) {
                    mult = mult + bank.MULT_RAISE() < bank.MULT_MAX() ? mult + bank.MULT_RAISE() : bank.MULT_MAX();
                    streak = 0;
                }
            } else if (net < 0) {
                streak = 0;
            }
            regime = net < 0 ? ICentralBank.Regime.Contraction : ICentralBank.Regime.Expansion;
            prevNet = net;
        }
    }
}
