"use client";
import { useBalance, useBlockNumber, useReadContracts } from "wagmi";
import { centralBankAbi, charterNFTAbi, flowHookAbi, thalerTokenAbi, treasuryAbi } from "@/abi";
import { deployed, deployments } from "@/lib/deployments";
import { POLL_MS } from "@/lib/wagmi";
import { HAS_WITHDRAW_FEE } from "@/lib/abiFlags";
import { MOCK, MOCK_LOADED_AT, mockBlock, mockCharterDetails, mockParams, mockPolicy, mockSale, mockTreasury, mockTreasuryEth } from "@/lib/mock";

const bank = { address: deployments.centralBank, abi: centralBankAbi } as const;
const token = { address: deployments.token, abi: thalerTokenAbi } as const;
const hook = { address: deployments.hook, abi: flowHookAbi } as const;
const treasury = { address: deployments.treasury, abi: treasuryAbi } as const;
const charter = { address: deployments.charter, abi: charterNFTAbi } as const;

/** Reads only run against real addresses; the mock flag short-circuits every hook below. */
const live = deployed && !MOCK;

const poll = (interval = POLL_MS) => ({
  enabled: live,
  refetchInterval: interval,
  refetchIntervalInBackground: false,
  staleTime: interval / 2,
});

function pick<T>(r: { status: string; result?: unknown } | undefined): T | undefined {
  return r && r.status === "success" ? (r.result as T) : undefined;
}

/**
 * The fee read per charter. `withdrawFeeBps` is used when the synced interface exposes it,
 * otherwise `resolveFeeBps`. Both are `(uint256) view returns (uint256)`.
 */
const withdrawFeeAbi = [
  {
    type: "function",
    name: "withdrawFeeBps",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
export { HAS_WITHDRAW_FEE };
const feeRead = (id: bigint) =>
  HAS_WITHDRAW_FEE
    ? ({ address: deployments.centralBank, abi: withdrawFeeAbi, functionName: "withdrawFeeBps", args: [id] } as const)
    : ({ ...bank, functionName: "resolveFeeBps", args: [id] } as const);

/** Immutable parameters. Read once, never refetched. */
export function useParams() {
  const q = useReadContracts({
    contracts: [
      { ...bank, functionName: "GENESIS" },
      { ...bank, functionName: "EPOCH" },
      { ...bank, functionName: "BASE_ISSUANCE_PER_DAY" },
      { ...bank, functionName: "ISSUANCE_BUDGET" },
      { ...bank, functionName: "MULT_MIN" },
      { ...bank, functionName: "MULT_MAX" },
      { ...bank, functionName: "MULT_CUT" },
      { ...bank, functionName: "MULT_RAISE" },
      { ...bank, functionName: "MAX_BRANCHES" },
      { ...bank, functionName: "LICENSES_PER_DAY" },
      { ...bank, functionName: "RESOLVE_FEE_MIN_BPS" },
      { ...bank, functionName: "RESOLVE_FEE_MAX_BPS" },
      { ...bank, functionName: "RESOLVE_FEE_PERIOD" },
      { ...token, functionName: "CAP" },
      { ...hook, functionName: "LAUNCH_TAX_BPS" },
      { ...hook, functionName: "BUY_FLOOR_BPS" },
      { ...hook, functionName: "SELL_FLOOR_BPS" },
      { ...hook, functionName: "TAX_HALF_LIFE" },
      { ...hook, functionName: "launchedAt" },
      { ...treasury, functionName: "ACTIVE_BPS" },
      { ...treasury, functionName: "POL_BPS" },
      { ...treasury, functionName: "TEAM_BPS" },
      { ...treasury, functionName: "BUYBACK_VAULT_BPS" },
      { ...treasury, functionName: "BUYBACK_RESERVE_BPS" },
      { ...treasury, functionName: "TICK_INTERVAL" },
      { ...treasury, functionName: "POL_MIN_COMPOUND" },
      { ...charter, functionName: "FOUNDING_SUPPLY" },
      { ...charter, functionName: "FOUNDING_PRICE" },
      { ...charter, functionName: "FOUNDING_PER_WALLET" },
    ],
    query: { enabled: live, staleTime: Infinity, gcTime: Infinity },
  });
  if (MOCK) return { isLoading: false, ...mockParams };
  const d = q.data;
  return {
    isLoading: q.isLoading,
    genesis: pick<bigint>(d?.[0]),
    epoch: pick<bigint>(d?.[1]),
    baseIssuancePerDay: pick<bigint>(d?.[2]),
    issuanceBudget: pick<bigint>(d?.[3]),
    multMin: pick<bigint>(d?.[4]),
    multMax: pick<bigint>(d?.[5]),
    multCut: pick<bigint>(d?.[6]),
    multRaise: pick<bigint>(d?.[7]),
    maxBranches: pick<number>(d?.[8]),
    licensesPerDay: pick<bigint>(d?.[9]),
    resolveFeeMin: pick<bigint>(d?.[10]),
    resolveFeeMax: pick<bigint>(d?.[11]),
    resolveFeePeriod: pick<bigint>(d?.[12]),
    cap: pick<bigint>(d?.[13]),
    launchTaxBps: pick<bigint>(d?.[14]),
    buyFloorBps: pick<bigint>(d?.[15]),
    sellFloorBps: pick<bigint>(d?.[16]),
    taxHalfLife: pick<bigint>(d?.[17]),
    launchedAt: pick<bigint>(d?.[18]),
    activeBps: pick<bigint>(d?.[19]),
    polBps: pick<bigint>(d?.[20]),
    teamBps: pick<bigint>(d?.[21]),
    buybackVaultBps: pick<bigint>(d?.[22]),
    buybackReserveBps: pick<bigint>(d?.[23]),
    tickInterval: pick<bigint>(d?.[24]),
    polMinCompound: pick<bigint>(d?.[25]),
    foundingSupply: pick<bigint>(d?.[26]),
    foundingPrice: pick<bigint>(d?.[27]),
    foundingPerWallet: pick<bigint>(d?.[28]),
  };
}

/** Live policy + supply readings. Polled every 12s. */
export function usePolicy() {
  const q = useReadContracts({
    contracts: [
      { ...bank, functionName: "multiplier" },
      { ...bank, functionName: "regime" },
      { ...bank, functionName: "currentEpoch" },
      { ...bank, functionName: "lastRolledEpoch" },
      { ...bank, functionName: "consecutivePositive" },
      { ...bank, functionName: "totalBranches" },
      { ...bank, functionName: "totalIssued" },
      { ...bank, functionName: "issuancePerSecond" },
      { ...bank, functionName: "issuancePerBranchPerDay" },
      { ...bank, functionName: "licensePrice" },
      { ...bank, functionName: "licensesRemainingToday" },
      { ...bank, functionName: "lastLicenseClose" },
      { ...token, functionName: "totalSupply" },
      { ...token, functionName: "totalBurned" },
      { ...hook, functionName: "buyTaxBps" },
      { ...hook, functionName: "sellTaxBps" },
      { ...hook, functionName: "totalEthIn" },
      { ...hook, functionName: "totalEthOut" },
      { ...hook, functionName: "totalTaxed" },
      { ...hook, functionName: "poolBound" },
    ],
    query: poll(),
  });
  if (MOCK) return { isLoading: false, isError: false, refetch: q.refetch, dataUpdatedAt: Date.now(), ...mockPolicy };
  const d = q.data;
  return {
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
    dataUpdatedAt: q.dataUpdatedAt,
    multiplier: pick<bigint>(d?.[0]),
    regime: pick<number>(d?.[1]),
    currentEpoch: pick<bigint>(d?.[2]),
    lastRolledEpoch: pick<bigint>(d?.[3]),
    consecutivePositive: pick<bigint>(d?.[4]),
    totalBranches: pick<bigint>(d?.[5]),
    totalIssued: pick<bigint>(d?.[6]),
    issuancePerSecond: pick<bigint>(d?.[7]),
    issuancePerBranchPerDay: pick<bigint>(d?.[8]),
    licensePrice: pick<bigint>(d?.[9]),
    licensesRemainingToday: pick<bigint>(d?.[10]),
    lastLicenseClose: pick<bigint>(d?.[11]),
    totalSupply: pick<bigint>(d?.[12]),
    totalBurned: pick<bigint>(d?.[13]),
    buyTaxBps: pick<bigint>(d?.[14]),
    sellTaxBps: pick<bigint>(d?.[15]),
    totalEthIn: pick<bigint>(d?.[16]),
    totalEthOut: pick<bigint>(d?.[17]),
    totalTaxed: pick<bigint>(d?.[18]),
    poolBound: pick<boolean>(d?.[19]),
  };
}

export function useTreasury() {
  const q = useReadContracts({
    contracts: [
      { ...treasury, functionName: "unallocated" },
      { ...treasury, functionName: "expansionVault" },
      { ...treasury, functionName: "contractionVault" },
      { ...treasury, functionName: "polVault" },
      { ...treasury, functionName: "teamVault" },
      { ...treasury, functionName: "polLiquidity" },
      { ...treasury, functionName: "nextBuybackAmount" },
      { ...treasury, functionName: "lastTick" },
      { ...treasury, functionName: "poolEthReserve" },
      { ...treasury, functionName: "totalBoughtBack" },
      { ...treasury, functionName: "totalEthSpentOnBuybacks" },
      { ...treasury, functionName: "poolInitialized" },
      { ...treasury, functionName: "team" },
    ],
    query: poll(),
  });
  if (MOCK) return { isLoading: false, refetch: q.refetch, ...mockTreasury };
  const d = q.data;
  return {
    isLoading: q.isLoading,
    refetch: q.refetch,
    unallocated: pick<bigint>(d?.[0]),
    expansionVault: pick<bigint>(d?.[1]),
    contractionVault: pick<bigint>(d?.[2]),
    polVault: pick<bigint>(d?.[3]),
    teamVault: pick<bigint>(d?.[4]),
    polLiquidity: pick<bigint>(d?.[5]),
    nextBuybackAmount: pick<bigint>(d?.[6]),
    lastTick: pick<bigint>(d?.[7]),
    poolEthReserve: pick<bigint>(d?.[8]),
    totalBoughtBack: pick<bigint>(d?.[9]),
    totalEthSpentOnBuybacks: pick<bigint>(d?.[10]),
    poolInitialized: pick<boolean>(d?.[11]),
    team: pick<`0x${string}`>(d?.[12]),
  };
}

/** ETH held by the treasury contract, polled with the rest. */
export function useTreasuryEth(): bigint | undefined {
  const q = useBalance({ address: deployments.treasury, query: { enabled: live, refetchInterval: POLL_MS, staleTime: POLL_MS / 2 } });
  if (MOCK) return mockTreasuryEth;
  return q.data?.value;
}

/** Latest block, refreshed with the polling interval. Readable before deployment. */
export function useBlock(): { block: bigint | undefined; isError: boolean } {
  const q = useBlockNumber({ query: { enabled: !MOCK, refetchInterval: POLL_MS, staleTime: POLL_MS / 2 } });
  if (MOCK) return { block: mockBlock, isError: false };
  return { block: q.data, isError: q.isError };
}

/** Charter sale state. The auction price decays continuously, so it polls every 10s. */
export function useCharterSale(account?: `0x${string}`) {
  const q = useReadContracts({
    contracts: [
      { ...charter, functionName: "foundingMinted" },
      { ...charter, functionName: "auctionPrice" },
      { ...charter, functionName: "auctionRemainingToday" },
      { ...charter, functionName: "auctionPerDay" },
      { ...charter, functionName: "auctionFloor" },
      { ...charter, functionName: "lastAuctionClose" },
      { ...charter, functionName: "totalMinted" },
      { ...charter, functionName: "transfersEnabled" },
      { ...charter, functionName: "foundingMintedBy", args: [account ?? "0x0000000000000000000000000000000000000000"] },
    ],
    query: poll(10_000),
  });
  if (MOCK) return { isLoading: false, refetch: q.refetch, ...mockSale, foundingMintedBy: account ? mockSale.foundingMintedBy : undefined };
  const d = q.data;
  return {
    isLoading: q.isLoading,
    refetch: q.refetch,
    foundingMinted: pick<bigint>(d?.[0]),
    auctionPrice: pick<bigint>(d?.[1]),
    auctionRemainingToday: pick<bigint>(d?.[2]),
    auctionPerDay: pick<bigint>(d?.[3]),
    auctionFloor: pick<bigint>(d?.[4]),
    lastAuctionClose: pick<bigint>(d?.[5]),
    totalMinted: pick<bigint>(d?.[6]),
    transfersEnabled: pick<boolean>(d?.[7]),
    foundingMintedBy: account ? pick<bigint>(d?.[8]) : undefined,
  };
}

export type CharterDetail = { id: bigint; branches?: number; pending?: bigint; feeBps?: bigint; mintedAt?: bigint };

/** Per-charter readings for a list of token ids. `dataUpdatedAt` lets the UI interpolate pending issuance between polls. */
export function useCharterDetails(ids: bigint[]) {
  const contracts = ids.flatMap((id) => [
    { ...bank, functionName: "branchesOf", args: [id] } as const,
    { ...bank, functionName: "pending", args: [id] } as const,
    feeRead(id),
    { ...bank, functionName: "mintedAt", args: [id] } as const,
  ]);
  const q = useReadContracts({
    contracts,
    query: { ...poll(), enabled: live && ids.length > 0 },
  });
  if (MOCK) {
    const rows: CharterDetail[] = ids.map((id) => mockCharterDetails.find((m) => m.id === id) ?? { id });
    return { rows, isLoading: false, refetch: q.refetch, dataUpdatedAt: MOCK_LOADED_AT };
  }
  const d = q.data;
  const rows: CharterDetail[] = ids.map((id, i) => ({
    id,
    branches: pick<number>(d?.[i * 4]),
    pending: pick<bigint>(d?.[i * 4 + 1]),
    feeBps: pick<bigint>(d?.[i * 4 + 2]),
    mintedAt: pick<bigint>(d?.[i * 4 + 3]),
  }));
  return { rows, isLoading: q.isLoading, refetch: q.refetch, dataUpdatedAt: q.dataUpdatedAt };
}

/** Wallet balances + allowances relevant to the UI. */
export function useWallet(account?: `0x${string}`) {
  const a = account ?? "0x0000000000000000000000000000000000000000";
  const q = useReadContracts({
    contracts: [
      { ...token, functionName: "balanceOf", args: [a] },
      { ...token, functionName: "allowance", args: [a, deployments.router] },
      { ...token, functionName: "allowance", args: [a, deployments.centralBank] },
    ],
    query: { ...poll(), enabled: live && !!account },
  });
  const d = q.data;
  return {
    refetch: q.refetch,
    thalerBalance: pick<bigint>(d?.[0]),
    routerAllowance: pick<bigint>(d?.[1]),
    bankAllowance: pick<bigint>(d?.[2]),
  };
}

/** Epoch clock derived from immutable params and the wall clock; the chain reading wins when present. */
export function epochClock(p: { genesis?: bigint; epoch?: bigint }, chainEpoch: bigint | undefined, now: number) {
  let local: bigint | undefined;
  let toNext: number | undefined;
  if (p.genesis !== undefined && p.epoch !== undefined && p.epoch > 0n && now > 0) {
    const elapsed = BigInt(now) - p.genesis;
    local = elapsed < 0n ? 0n : elapsed / p.epoch;
    toNext = Number(p.genesis + (local + 1n) * p.epoch - BigInt(now));
  }
  return { epoch: chainEpoch ?? local, toNext };
}
