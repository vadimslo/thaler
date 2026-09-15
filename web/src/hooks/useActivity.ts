"use client";
import { useQuery } from "@tanstack/react-query";
import type { AbiEvent, Hex, PublicClient } from "viem";
import { formatEther, formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import { centralBankAbi, charterNFTAbi, flowHookAbi, treasuryAbi } from "@/abi";
import { deployed, deployments } from "@/lib/deployments";
import { POLL_MS } from "@/lib/wagmi";
import { MOCK, mockEvents } from "@/lib/mock";

export type ActivityRow = {
  /** `${block}:${logIndex}` */
  id: string;
  block: number;
  logIndex: number;
  ts?: number;
  type: string;
  amount: string;
  tx: Hex;
};

type Store = { v: 1; head: number; tail: number; rows: ActivityRow[] };

export type Activity = {
  rows: ActivityRow[];
  /** Lowest block scanned so far. */
  from: number;
  /** Highest block scanned so far. */
  head: number;
  /** True while older windows still need reading to fill the list. */
  backfilling: boolean;
};

/** publicnode caps eth_getLogs ranges; 5,000 blocks is safely inside every public limit. */
const WINDOW = 5_000;
export const FEED_LIMIT = 20;
const MAX_ROWS = 200;
/** Older windows read per poll while the list is still short. Bounds RPC load per pass. */
const BACK_WINDOWS_PER_PASS = 4;

const EVENT_NAMES = new Set(["Taxed", "FoundingMinted", "AuctionBought", "BranchOpened", "Withdrawn", "CharterResolved", "EpochRolled", "Buyback", "PolCompounded", "Allocated"]);

function eventsOf(abi: readonly unknown[]): AbiEvent[] {
  return (abi as readonly { type: string; name?: string }[]).filter((e) => e.type === "event" && e.name && EVENT_NAMES.has(e.name)) as AbiEvent[];
}
const EVENTS: AbiEvent[] = [...eventsOf(flowHookAbi), ...eventsOf(charterNFTAbi), ...eventsOf(centralBankAbi), ...eventsOf(treasuryAbi)];
const ADDRESSES = [deployments.hook, deployments.charter, deployments.centralBank, deployments.treasury];

const storeKey = `thaler:activity:${deployments.chainId}:${deployments.centralBank}`;

function load(): Store | undefined {
  try {
    const raw = localStorage.getItem(storeKey);
    if (!raw) return undefined;
    const s = JSON.parse(raw) as Store;
    return s && s.v === 1 && Array.isArray(s.rows) ? s : undefined;
  } catch {
    return undefined;
  }
}
function save(s: Store) {
  try {
    localStorage.setItem(storeKey, JSON.stringify(s));
  } catch {
    // storage unavailable: the next pass rescans from the latest block
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries transient RPC failures (429, timeouts) with exponential backoff and jitter. */
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === tries - 1) break;
      await sleep(700 * 2 ** i + Math.random() * 300);
    }
  }
  throw last;
}

const eth = (v: bigint, d = 4) => {
  const n = Number(formatEther(v));
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
};
const tok = (v: bigint, d = 2) => {
  const n = Number(formatUnits(v, 18));
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
};
const mult = (v: bigint) => (Number(v) / 10_000).toFixed(2) + "x";

type Args = Record<string, unknown>;

/** One line per event, in the register of the rest of the site. */
function describe(name: string, a: Args): { type: string; amount: string } | undefined {
  switch (name) {
    case "Taxed": {
      const isBuy = a.isBuy as boolean;
      return { type: isBuy ? "Taxed buy" : "Taxed sell", amount: `${eth(a.ethAmount as bigint)} ETH ${isBuy ? "in" : "out"} · tax ${eth(a.tax as bigint)}` };
    }
    case "FoundingMinted":
      return { type: "FoundingMinted", amount: `#${a.tokenId} · ${eth(a.price as bigint, 3)} ETH` };
    case "AuctionBought":
      return { type: "AuctionBought", amount: `#${a.tokenId} · ${eth(a.price as bigint, 5)} ETH` };
    case "BranchOpened":
      return { type: "BranchOpened", amount: `#${a.tokenId} · ${a.branches} branches · ${tok(a.pricePaid as bigint)} THALER burned` };
    case "Withdrawn": {
      const fee = a.fee as bigint | undefined;
      return { type: "Withdrawn", amount: `#${a.tokenId} · ${tok(a.amount as bigint)} THALER${fee !== undefined ? ` · fee ${tok(fee)}` : ""}` };
    }
    case "CharterResolved":
      return { type: "CharterResolved", amount: `#${a.tokenId} · paid ${tok(a.paid as bigint)} · burned ${tok(a.burned as bigint)} · redistributed ${tok(a.redistributed as bigint)}` };
    case "EpochRolled": {
      const net = a.netFlow as bigint;
      const sign = net < 0n ? "-" : "+";
      return { type: "EpochRolled", amount: `epoch ${a.epoch} · net ${sign}${eth(net < 0n ? -net : net)} ETH · ${mult(a.multiplier as bigint)} · ${Number(a.regime) === 1 ? "Contraction" : "Expansion"}` };
    }
    case "Buyback":
      return { type: "Buyback", amount: `${eth(a.ethSpent as bigint)} ETH · ${tok(a.thalerBurned as bigint)} THALER burned` };
    case "PolCompounded":
      return { type: "PolCompounded", amount: `${eth(a.ethUsed as bigint)} ETH + ${tok(a.thalerUsed as bigint)} THALER` };
    case "Allocated":
      return { type: "Allocated", amount: `${eth(a.amount as bigint)} ETH · 70 / 15 / 15 · ${a.contraction ? "contraction" : "expansion"}` };
    default:
      return undefined;
  }
}

async function readWindow(client: PublicClient, from: number, to: number): Promise<ActivityRow[]> {
  const logs = await withRetry(() => client.getLogs({ address: ADDRESSES, events: EVENTS, fromBlock: BigInt(from), toBlock: BigInt(to) }));
  const rows: ActivityRow[] = [];
  for (const log of logs) {
    const name = (log as { eventName?: string }).eventName;
    const args = ((log as { args?: Args }).args ?? {}) as Args;
    if (!name || log.blockNumber === null || log.logIndex === null || !log.transactionHash) continue;
    const d = describe(name, args);
    if (!d) continue;
    const block = Number(log.blockNumber);
    rows.push({ id: `${block}:${log.logIndex}`, block, logIndex: log.logIndex, type: d.type, amount: d.amount, tx: log.transactionHash });
  }
  return rows;
}

const newestFirst = (a: ActivityRow, b: ActivityRow) => (b.block - a.block) || (b.logIndex - a.logIndex);

function merge(existing: ActivityRow[], incoming: ActivityRow[]): ActivityRow[] {
  const seen = new Map(existing.map((r) => [r.id, r]));
  for (const r of incoming) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()].sort(newestFirst).slice(0, MAX_ROWS);
}

async function fillTimestamps(client: PublicClient, rows: ActivityRow[]) {
  const missing = [...new Set(rows.filter((r) => r.ts === undefined).map((r) => r.block))].slice(0, 40);
  if (missing.length === 0) return;
  const blocks = await withRetry(() => Promise.all(missing.map((b) => client.getBlock({ blockNumber: BigInt(b) }))));
  const ts = new Map(blocks.map((b) => [Number(b.number), Number(b.timestamp)]));
  for (const r of rows) {
    const t = ts.get(r.block);
    if (t !== undefined) r.ts = t;
  }
}

/**
 * Protocol events, newest first, read straight from the chain in 5,000-block windows starting at
 * the latest block and walking back to the deployment block until the list is full. New blocks are
 * appended on every poll; progress and rows persist in localStorage so a reload costs one small window.
 * Transient RPC failures retry with backoff; a hard failure keeps the last rows and marks the feed paused.
 */
export function useActivity(limit = FEED_LIMIT) {
  const client = usePublicClient();
  const q = useQuery({
    queryKey: ["activity", deployments.centralBank, limit],
    enabled: deployed && (MOCK || !!client),
    retry: false,
    refetchInterval: (query) => (query.state.status === "error" ? 30_000 : POLL_MS),
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<Activity> => {
      if (MOCK) {
        const rows = mockEvents.map((e) => ({ id: `${e.block}:${e.logIndex}`, ...e }));
        return { rows, from: rows[rows.length - 1].block - 3_000, head: rows[0].block, backfilling: false };
      }
      if (!client) throw new Error("no client");
      const latest = Number(await withRetry(() => client.getBlockNumber()));
      const deployBlock = Math.max(0, deployments.block || 0);
      let st: Store = load() ?? { v: 1, head: latest, tail: latest + 1, rows: [] };

      // Forward: blocks mined since the last pass.
      if (st.head < latest) {
        for (let from = st.head + 1; from <= latest; from += WINDOW) {
          const to = Math.min(latest, from + WINDOW - 1);
          const rows = await readWindow(client, from, to);
          st = { ...st, head: to, rows: merge(st.rows, rows) };
          save(st);
        }
      }

      // Backward: older windows until the list is full or the deployment block is reached.
      let passes = 0;
      while (st.rows.length < limit && st.tail > deployBlock && passes < BACK_WINDOWS_PER_PASS) {
        const to = st.tail - 1;
        const from = Math.max(deployBlock, to - WINDOW + 1);
        const rows = await readWindow(client, from, to);
        st = { ...st, tail: from, rows: merge(st.rows, rows) };
        save(st);
        passes++;
      }

      const visible = st.rows.slice(0, limit);
      await fillTimestamps(client, visible);
      st = { ...st, rows: merge(st.rows, visible) };
      save(st);

      return { rows: visible, from: Math.min(st.tail, st.head), head: st.head, backfilling: st.rows.length < limit && st.tail > deployBlock };
    },
  });
  return { data: q.data, isLoading: q.isLoading, isError: q.isError, error: q.error, isFetching: q.isFetching, refetch: q.refetch };
}
