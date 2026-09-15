import { encodeAbiParameters, keccak256, type Hex } from "viem";

/** Uniswap v4 PoolManager: `mapping(PoolId => Pool.State) _pools` lives at slot 6. */
const POOLS_SLOT = 6n;
/** Pool.State layout: slot0, feeGrowthGlobal0, feeGrowthGlobal1, liquidity, ... */
const LIQUIDITY_OFFSET = 3n;

export const extsloadAbi = [
  {
    type: "function",
    name: "extsload",
    stateMutability: "view",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ name: "value", type: "bytes32" }],
  },
] as const;

export function poolStateSlot(poolId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId, POOLS_SLOT]));
}

export function poolLiquiditySlot(poolId: Hex): Hex {
  const base = BigInt(poolStateSlot(poolId));
  return ("0x" + (base + LIQUIDITY_OFFSET).toString(16).padStart(64, "0")) as Hex;
}

const MASK160 = (1n << 160n) - 1n;
const MASK24 = (1n << 24n) - 1n;
export const Q96 = 1n << 96n;

/** Slot0 packing: [24 empty | 24 lpFee | 24 protocolFee | 24 tick | 160 sqrtPriceX96]. */
export function decodeSlot0(word: Hex) {
  const v = BigInt(word);
  const sqrtPriceX96 = v & MASK160;
  let tick = Number((v >> 160n) & MASK24);
  if (tick >= 1 << 23) tick -= 1 << 24;
  const protocolFee = Number((v >> 184n) & MASK24);
  const lpFee = Number((v >> 208n) & MASK24);
  return { sqrtPriceX96, tick, protocolFee, lpFee };
}

export function decodeLiquidity(word: Hex): bigint {
  return BigInt(word) & ((1n << 128n) - 1n);
}

/** Virtual reserves of a single full-range position: x = L·2^96/√P (ETH), y = L·√P/2^96 (THALER). */
export function reserves(liquidity: bigint, sqrtPriceX96: bigint) {
  if (liquidity === 0n || sqrtPriceX96 === 0n) return { eth: 0n, thaler: 0n };
  return { eth: (liquidity * Q96) / sqrtPriceX96, thaler: (liquidity * sqrtPriceX96) / Q96 };
}

/** THALER per ETH as a float, for display. */
export function priceThalerPerEth(sqrtPriceX96: bigint): number {
  const r = Number(sqrtPriceX96) / Number(Q96);
  return r * r;
}

/**
 * Rough exact-input quote on constant-product reserves. Ignores tick crossings (there is one full-range
 * position, so this is close) and rounding. Tax in bps, lpFee in hundredths of a bip (1e6 = 100%).
 */
export function quoteBuy(ethIn: bigint, r: { eth: bigint; thaler: bigint }, buyTaxBps: bigint, lpFee: number): bigint {
  if (ethIn <= 0n || r.eth === 0n) return 0n;
  const net = ethIn - (ethIn * buyTaxBps) / 10_000n;
  const eff = (net * BigInt(1_000_000 - lpFee)) / 1_000_000n;
  return (r.thaler * eff) / (r.eth + eff);
}

export function quoteSell(thalerIn: bigint, r: { eth: bigint; thaler: bigint }, sellTaxBps: bigint, lpFee: number): bigint {
  if (thalerIn <= 0n || r.thaler === 0n) return 0n;
  const eff = (thalerIn * BigInt(1_000_000 - lpFee)) / 1_000_000n;
  const out = (r.eth * eff) / (r.thaler + eff);
  return out - (out * sellTaxBps) / 10_000n;
}
