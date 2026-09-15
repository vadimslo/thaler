/**
 * Dev-only mock readings. `NEXT_PUBLIC_MOCK=1 npm run build` (or `npm run dev`) renders the live
 * blocks against plausible numbers so the layout can be judged before the contracts exist.
 * The flag is inlined at build time; the default build never ships these values.
 */
export const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

const tok = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const eth = (n: number) => BigInt(Math.round(n * 1e9)) * 10n ** 9n;

/** A fixed instant, so prerendered and client-rendered mock text agree (no hydration mismatch). */
export const MOCK_T0 = 1789473600;
const GENESIS = MOCK_T0 - 3 * 86400 - 2 * 3600;
const LAUNCHED = MOCK_T0 - 7 * 3600;

export const mockParams = {
  genesis: BigInt(GENESIS),
  epoch: 21_600n,
  baseIssuancePerDay: tok(700_000),
  issuanceBudget: tok(900_000_000),
  multMin: 2_000n,
  multMax: 12_500n,
  multCut: 1_500n,
  multRaise: 1_000n,
  maxBranches: 10,
  licensesPerDay: 100n,
  resolveFeeMin: 200n,
  resolveFeeMax: 6_000n,
  resolveFeePeriod: 30n * 86_400n,
  cap: tok(1_000_000_000),
  launchTaxBps: 9_000n,
  buyFloorBps: 200n,
  sellFloorBps: 300n,
  taxHalfLife: 21_600n,
  launchedAt: BigInt(LAUNCHED),
  activeBps: 7_000n,
  polBps: 1_500n,
  teamBps: 1_500n,
  buybackVaultBps: 1_000n,
  buybackReserveBps: 20n,
  tickInterval: 3_600n,
  polMinCompound: eth(0.0005),
  foundingSupply: 1_000n,
  foundingPrice: eth(0.001),
  foundingPerWallet: 3n,
};

export const mockPolicy = {
  multiplier: 11_000n,
  regime: 0,
  currentEpoch: 12n,
  lastRolledEpoch: 11n,
  consecutivePositive: 1n,
  totalBranches: 1_340n,
  totalIssued: tok(2_310_412.5),
  issuancePerSecond: tok(770_000) / 86_400n,
  issuancePerBranchPerDay: tok(770_000) / 1_340n,
  licensePrice: tok(1_204.5),
  licensesRemainingToday: 63n,
  lastLicenseClose: tok(980.2),
  totalSupply: tok(100_000_000) + tok(2_310_412.5) - tok(41_230.8),
  totalBurned: tok(41_230.8),
  buyTaxBps: 4_120n,
  sellTaxBps: 4_260n,
  totalEthIn: eth(4.2137),
  totalEthOut: eth(1.3712),
  totalTaxed: eth(2.8614),
  poolBound: true,
};

export const mockTreasury = {
  unallocated: eth(0.0123),
  expansionVault: eth(2.0412),
  contractionVault: eth(0.3121),
  polVault: eth(0.0004),
  teamVault: eth(0.5142),
  polLiquidity: 17_527_000_000_000_000_000_000n,
  nextBuybackAmount: eth(0.0064),
  lastTick: BigInt(MOCK_T0 - 40 * 60),
  poolEthReserve: eth(3.2),
  totalBoughtBack: tok(38_400.2),
  totalEthSpentOnBuybacks: eth(0.1102),
  poolInitialized: true,
  team: "0x000000000000000000000000000000000000dEaD" as `0x${string}`,
};

export const mockSale = {
  foundingMinted: 812n,
  auctionPrice: eth(0.00214),
  auctionRemainingToday: 7n,
  auctionPerDay: 10n,
  auctionFloor: eth(0.001),
  lastAuctionClose: eth(0.0018),
  totalMinted: 823n,
  transfersEnabled: false,
  foundingMintedBy: 1n,
};

export const mockTreasuryEth = eth(2.8802);
export const mockBlock = 9_123_456n;
/** Client-side load instant; lets the mock pending counter tick between "polls". */
export const MOCK_LOADED_AT = typeof window === "undefined" ? 0 : Date.now();

const sqrtP = Math.sqrt(30_000_000);
const sqrtPriceX96 = BigInt(Math.floor(sqrtP * 2 ** 40)) << 56n;
const liquidity = (eth(3.2) * sqrtPriceX96) / (1n << 96n);
export const mockPool = {
  ready: true,
  isLoading: false,
  slot0: { sqrtPriceX96, tick: 172_000, protocolFee: 0, lpFee: 10_000 },
  liquidity,
  reserves: { eth: eth(3.2), thaler: (liquidity * sqrtPriceX96) / (1n << 96n) },
};

export const mockCharterIds = [12n, 847n];
export const mockCharterDetails = [
  { id: 12n, branches: 4, pending: tok(1_204.1042), feeBps: 5_412n, mintedAt: BigInt(GENESIS + 3_600) },
  { id: 847n, branches: 1, pending: tok(96.4401), feeBps: 5_980n, mintedAt: BigInt(MOCK_T0 - 5 * 3600) },
];

export type MockEvent = { block: number; ts: number; type: string; amount: string; tx: `0x${string}`; logIndex: number };
const txOf = (i: number) => ("0x" + (0x9a3f21b7c4d5e6f7n + BigInt(i) * 0x1f3a5b7c9d1e2f31n).toString(16).padStart(64, "0")) as `0x${string}`;
const seq: [string, string][] = [
  ["Taxed buy", "0.0500 ETH in · tax 0.0206"],
  ["Withdrawn", "#12 · 1,204.10 THALER"],
  ["Taxed sell", "0.0120 ETH out · tax 0.0051"],
  ["BranchOpened", "#12 · 4 branches · 1,204.50 THALER burned"],
  ["AuctionBought", "#823 · 0.00214 ETH"],
  ["Allocated", "0.0421 ETH · 70 / 15 / 15 · expansion"],
  ["Taxed buy", "0.2000 ETH in · tax 0.0824"],
  ["EpochRolled", "epoch 11 · net +0.4120 ETH · 1.10x · Expansion"],
  ["FoundingMinted", "#812 · 0.001 ETH"],
  ["Buyback", "0.0064 ETH · 19,200.10 THALER burned"],
  ["Taxed sell", "0.0800 ETH out · tax 0.0341"],
  ["PolCompounded", "0.0005 ETH + 15,000.00 THALER"],
  ["CharterResolved", "#640 · paid 812.40 · burned 20.31 · redistributed 20.31"],
  ["Taxed buy", "0.0100 ETH in · tax 0.0041"],
  ["FoundingMinted", "#811 · 0.001 ETH"],
  ["Withdrawn", "#203 · 402.77 THALER"],
  ["Taxed buy", "0.0300 ETH in · tax 0.0124"],
  ["EpochRolled", "epoch 10 · net +0.1802 ETH · 1.00x · Expansion"],
  ["Allocated", "0.0180 ETH · 70 / 15 / 15 · expansion"],
  ["Taxed sell", "0.0050 ETH out · tax 0.0021"],
];
export const mockEvents: MockEvent[] = seq.map(([type, amount], i) => ({
  block: Number(mockBlock) - i * 7 - (i % 3),
  ts: MOCK_T0 - i * 97 - (i % 5) * 13,
  type,
  amount,
  tx: txOf(i),
  logIndex: i % 4,
}));
