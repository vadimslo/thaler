// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";

import {ThalerToken} from "../src/ThalerToken.sol";
import {CharterNFT} from "../src/CharterNFT.sol";
import {CentralBank} from "../src/CentralBank.sol";
import {Treasury} from "../src/Treasury.sol";
import {FlowHook} from "../src/FlowHook.sol";
import {ThalerRouter} from "../src/ThalerRouter.sol";

/// @notice Full deployment in the DESIGN.md order. The broadcaster key comes from the CLI
///         (`--private-key` / `--account`); the script never touches it.
///
/// Required env: POOL_MANAGER, TEAM, SEED_ETH (wei), SEED_THALER (wei), SQRT_PRICE_X96, EPOCH_SECONDS.
/// Optional env (testnet defaults): RESOLVE_FEE_PERIOD, FOUNDING_PRICE, AUCTION_PER_DAY, AUCTION_FLOOR.
///
/// Example (Sepolia, 1 ETH : 100M THALER):
///   POOL_MANAGER=0x... TEAM=0x... SEED_ETH=1000000000000000000 SEED_THALER=100000000000000000000000000 \
///   SQRT_PRICE_X96=792281625142643375935439503360000 EPOCH_SECONDS=21600 \
///   forge script script/Deploy.s.sol --rpc-url sepolia --account deployer --broadcast --verify
contract Deploy is Script {
    using PoolIdLibrary for PoolKey;

    /// @dev Foundry's default CREATE2 deployer; `new X{salt: s}` inside a broadcast routes through it.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    /// @dev ThalerToken mints this to the deployer at construction; the seed cannot exceed it.
    uint256 internal constant GENESIS_MINT = 100_000_000e18;

    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    struct Params {
        address poolManager;
        address team;
        uint256 seedEth;
        uint256 seedThaler;
        uint160 sqrtPriceX96;
        uint256 epochSeconds;
        uint256 resolveFeePeriod;
        uint256 foundingPrice;
        uint256 auctionPerDay;
        uint256 auctionFloor;
    }

    struct Deployed {
        ThalerToken token;
        CharterNFT charter;
        CentralBank bank;
        Treasury treasury;
        FlowHook hook;
        ThalerRouter router;
    }

    function run() external {
        Params memory p = _params();

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        require(deployer.balance >= p.seedEth, "deployer cannot fund the seed");

        Deployed memory d;
        d.token = new ThalerToken();
        d.charter = new CharterNFT(p.foundingPrice, p.auctionPerDay, p.auctionFloor);
        d.bank = new CentralBank(address(d.token), address(d.charter), p.epochSeconds, p.resolveFeePeriod);
        d.token.setCentralBank(address(d.bank));
        d.charter.setCentralBank(address(d.bank));
        d.treasury = new Treasury(address(d.token), IPoolManager(p.poolManager), address(d.bank), p.team);
        d.charter.setTreasury(address(d.treasury));

        // hook: CREATE2 salt mined so the address carries exactly the permission flags
        bytes memory ctorArgs = abi.encode(IPoolManager(p.poolManager), address(d.bank), address(d.treasury));
        (address expectedHook, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, HOOK_FLAGS, type(FlowHook).creationCode, ctorArgs);
        d.hook = new FlowHook{salt: salt}(IPoolManager(p.poolManager), address(d.bank), address(d.treasury));
        require(address(d.hook) == expectedHook, "hook address mismatch");

        d.bank.setHook(address(d.hook));
        d.treasury.setHook(address(d.hook));
        d.router = new ThalerRouter(IPoolManager(p.poolManager), address(d.treasury));

        d.treasury.initializePool(p.sqrtPriceX96);
        d.token.approve(address(d.treasury), p.seedThaler);
        d.treasury.seedLiquidity{value: p.seedEth}(p.seedThaler);
        vm.stopBroadcast();

        _check(d, p, deployer);
        _write(d, p, deployer);
    }

    // ------------------------------------------------------------------ env

    function _params() internal view returns (Params memory p) {
        p.poolManager = vm.envAddress("POOL_MANAGER");
        p.team = vm.envAddress("TEAM");
        p.seedEth = vm.envUint("SEED_ETH");
        p.seedThaler = vm.envUint("SEED_THALER");
        uint256 sqrtPrice = vm.envUint("SQRT_PRICE_X96");
        require(sqrtPrice > 0 && sqrtPrice <= type(uint160).max, "SQRT_PRICE_X96 out of range");
        p.sqrtPriceX96 = uint160(sqrtPrice);
        p.epochSeconds = vm.envUint("EPOCH_SECONDS");
        p.resolveFeePeriod = vm.envOr("RESOLVE_FEE_PERIOD", uint256(30 days));
        p.foundingPrice = vm.envOr("FOUNDING_PRICE", uint256(0.001 ether));
        p.auctionPerDay = vm.envOr("AUCTION_PER_DAY", uint256(10));
        p.auctionFloor = vm.envOr("AUCTION_FLOOR", uint256(0.001 ether));
        require(p.poolManager != address(0) && p.team != address(0), "zero address");
        require(p.seedEth > 0 && p.seedThaler > 0 && p.epochSeconds > 0, "zero param");
        require(p.seedThaler <= GENESIS_MINT, "SEED_THALER exceeds the genesis mint");
    }

    // ------------------------------------------------------------------ post-deploy checks

    function _check(Deployed memory d, Params memory p, address deployer) internal view {
        require(d.token.centralBank() == address(d.bank), "token: bank not set");
        require(d.charter.centralBank() == address(d.bank), "charter: bank not set");
        require(d.charter.treasury() == address(d.treasury), "charter: treasury not set");
        require(d.bank.hook() == address(d.hook), "bank: hook not set");
        require(d.treasury.hook() == address(d.hook), "treasury: hook not set");
        require(d.hook.poolBound(), "hook not bound");
        require(d.treasury.poolInitialized(), "pool not initialized");
        require(d.treasury.seeded(), "pool not seeded");
        require(d.treasury.polLiquidity() > 0, "no POL liquidity");
        require(d.token.balanceOf(address(d.treasury)) == 0, "treasury holds THALER");
        require(d.router.treasury() == address(d.treasury), "router: wrong treasury");

        PoolKey memory k = d.treasury.poolKey();
        require(PoolId.unwrap(k.toId()) == PoolId.unwrap(d.hook.poolKey().toId()), "hook/treasury pool mismatch");
        require(address(k.hooks) == address(d.hook), "pool key: wrong hook");
        require(k.fee == 10_000 && k.tickSpacing == 200, "pool key: wrong fee/spacing");

        require(d.token.owner() == deployer, "token owner");
        require(d.charter.owner() == deployer, "charter owner");
        require(d.bank.owner() == deployer, "bank owner");
        require(d.treasury.owner() == deployer, "treasury owner");
        require(d.bank.EPOCH() == p.epochSeconds, "epoch");
        require(d.treasury.team() == p.team, "team");
    }

    // ------------------------------------------------------------------ deployments/<chainId>.json

    function _write(Deployed memory d, Params memory p, address deployer) internal {
        PoolKey memory k = d.treasury.poolKey();
        string memory obj = "deployment";
        vm.serializeAddress(obj, "token", address(d.token));
        vm.serializeAddress(obj, "charter", address(d.charter));
        vm.serializeAddress(obj, "centralBank", address(d.bank));
        vm.serializeAddress(obj, "treasury", address(d.treasury));
        vm.serializeAddress(obj, "hook", address(d.hook));
        vm.serializeAddress(obj, "router", address(d.router));
        vm.serializeAddress(obj, "poolManager", p.poolManager);
        vm.serializeBytes32(obj, "poolId", PoolId.unwrap(k.toId()));
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "block", block.number);
        vm.serializeAddress(obj, "deployer", deployer);
        string memory json = vm.serializeUint(obj, "genesis", d.bank.GENESIS());

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console2.log("chainId      ", block.chainid);
        console2.log("token        ", address(d.token));
        console2.log("charter      ", address(d.charter));
        console2.log("centralBank  ", address(d.bank));
        console2.log("treasury     ", address(d.treasury));
        console2.log("hook         ", address(d.hook));
        console2.log("router       ", address(d.router));
        console2.log("poolManager  ", p.poolManager);
        console2.log("genesis      ", d.bank.GENESIS());
        console2.log("written      ", path);
    }
}
