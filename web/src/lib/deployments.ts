import raw from "@/config/deployments.json";
import { getAddress, type Address, type Hex } from "viem";
import { MOCK } from "./mock";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const CHAIN_ID_DEFAULT = 11155111;

export type Deployments = {
  token: Address;
  charter: Address;
  centralBank: Address;
  treasury: Address;
  hook: Address;
  router: Address;
  poolManager: Address;
  poolId: Hex;
  chainId: number;
  block: number;
  deployer: Address;
  genesis: number;
};

export const isZero = (a?: string) => !a || /^0x0{40}$/i.test(a);

/** Checksums an address regardless of how it was written in the JSON; zero stays zero, garbage becomes zero. */
function norm(a: unknown): Address {
  if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) return ZERO_ADDRESS;
  try {
    return getAddress(a.toLowerCase());
  } catch {
    return ZERO_ADDRESS;
  }
}

const r = raw as Partial<Record<keyof Deployments, unknown>>;
export const deployments: Deployments = {
  token: norm(r.token),
  charter: norm(r.charter),
  centralBank: norm(r.centralBank),
  treasury: norm(r.treasury),
  hook: norm(r.hook),
  router: norm(r.router),
  poolManager: norm(r.poolManager),
  poolId: typeof r.poolId === "string" && /^0x[0-9a-fA-F]{64}$/.test(r.poolId) ? (r.poolId.toLowerCase() as Hex) : ("0x" + "0".repeat(64)) as Hex,
  chainId: Number(r.chainId ?? CHAIN_ID_DEFAULT),
  block: Number(r.block ?? 0),
  deployer: norm(r.deployer),
  genesis: Number(r.genesis ?? 0),
};

/** True once every core contract has a non-zero address (or under the dev-only mock flag). */
export const onChain =
  !isZero(deployments.token) &&
  !isZero(deployments.charter) &&
  !isZero(deployments.centralBank) &&
  !isZero(deployments.treasury) &&
  !isZero(deployments.hook) &&
  !isZero(deployments.router);
export const deployed = onChain || MOCK;

export const CHAIN_ID = CHAIN_ID_DEFAULT;
export const ETHERSCAN = "https://sepolia.etherscan.io";
export const etherscanAddress = (a: string) => `${ETHERSCAN}/address/${a}`;
export const etherscanTx = (h: string) => `${ETHERSCAN}/tx/${h}`;

export const CONTRACTS: { key: keyof Deployments; name: string; role: string }[] = [
  { key: "token", name: "ThalerToken", role: "The currency. ERC-20, hard cap 1,000,000,000. Only the central bank mints." },
  { key: "charter", name: "CharterNFT", role: "Banking charters. ERC-721, soulbound. Founding mint and daily ETH auction." },
  { key: "centralBank", name: "CentralBank", role: "Epoch clock, multiplier, branch accounting, licenses, resolution." },
  { key: "hook", name: "FlowHook", role: "Uniswap v4 hook on the ETH/THALER pool. Taxes swaps, records flow per epoch." },
  { key: "treasury", name: "Treasury", role: "All protocol ETH. Vault split, buyback and burn, protocol-owned liquidity." },
  { key: "router", name: "ThalerRouter", role: "Exact-input swap helper for the canonical pool." },
];
