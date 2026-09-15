"use client";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { deployed, deployments } from "@/lib/deployments";
import { POLL_MS } from "@/lib/wagmi";
import { MOCK } from "@/lib/mock";

const resolvedEvent = parseAbiItem("event CharterResolved(uint256 indexed tokenId, address indexed owner, uint256 paid, uint256 burned, uint256 redistributed)");

/** publicnode rejects eth_getLogs over more than ~50k blocks. */
const CHUNK = 50_000n;
const OVERLAP = 32n;

type Checkpoint = { scanned: string; ids: string[] };
const key = `thaler:resolved:${deployments.chainId}:${deployments.centralBank}`;

function load(): Checkpoint | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Checkpoint) : undefined;
  } catch {
    return undefined;
  }
}
function save(cp: Checkpoint) {
  try {
    localStorage.setItem(key, JSON.stringify(cp));
  } catch {
    // storage unavailable: the next pass rescans from the deployment block
  }
}

async function scan(client: PublicClient, from: bigint, to: bigint): Promise<bigint[]> {
  const out: bigint[] = [];
  for (let start = from; start <= to; start += CHUNK) {
    const end = start + CHUNK - 1n > to ? to : start + CHUNK - 1n;
    const logs = await client.getLogs({ address: deployments.centralBank, event: resolvedEvent, fromBlock: start, toBlock: end });
    for (const l of logs) if (l.args.tokenId !== undefined) out.push(l.args.tokenId);
  }
  return out;
}

/**
 * Number of charters resolved since deployment, counted from CharterResolved logs. A charter
 * resolves at most once, so the id set is exact across overlapping re-reads. Checkpointed in
 * localStorage; each poll reads only new blocks.
 */
export function useResolvedCount() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["resolved-count", deployments.centralBank],
    enabled: deployed && (MOCK || !!client),
    retry: 1,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<number> => {
      if (MOCK) return 1;
      if (!client) return 0;
      const latest = await client.getBlockNumber();
      const deployBlock = BigInt(deployments.block || 0);
      const cp = load();
      const ids = new Set<string>(cp?.ids ?? []);
      let from = cp ? BigInt(cp.scanned) - OVERLAP + 1n : deployBlock;
      if (from < deployBlock) from = deployBlock;
      if (from <= latest) {
        for (const id of await scan(client, from, latest)) ids.add(id.toString());
        save({ scanned: latest.toString(), ids: [...ids] });
      }
      return ids.size;
    },
  });
}
