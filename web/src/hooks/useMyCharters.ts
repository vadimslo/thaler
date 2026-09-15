"use client";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { deployed, deployments } from "@/lib/deployments";
import { POLL_MS } from "@/lib/wagmi";
import { MOCK, mockCharterIds } from "@/lib/mock";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

/** publicnode rejects eth_getLogs over more than ~50k blocks. */
const CHUNK = 50_000n;
/** Blocks re-read on every pass to absorb small reorgs. Replaying is idempotent. */
const OVERLAP = 32n;

type Checkpoint = { scanned: string; owned: string[] };

const cacheKey = (account: Address) => `thaler:charters:${deployments.chainId}:${deployments.charter}:${account.toLowerCase()}`;

function loadCheckpoint(account: Address): Checkpoint | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(account));
    return raw ? (JSON.parse(raw) as Checkpoint) : undefined;
  } catch {
    return undefined;
  }
}

function saveCheckpoint(account: Address, cp: Checkpoint) {
  try {
    localStorage.setItem(cacheKey(account), JSON.stringify(cp));
  } catch {
    // storage unavailable: scanning simply starts from the deployment block next time
  }
}

async function scan(client: PublicClient, account: Address, fromBlock: bigint, toBlock: bigint) {
  const base = { address: deployments.charter, event: transferEvent } as const;
  const out = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = start + CHUNK - 1n > toBlock ? toBlock : start + CHUNK - 1n;
    const [received, sent] = await Promise.all([
      client.getLogs({ ...base, args: { to: account }, fromBlock: start, toBlock: end }),
      client.getLogs({ ...base, args: { from: account }, fromBlock: start, toBlock: end }),
    ]);
    out.push(...received, ...sent);
  }
  // Chain order matters: a token that went out and came back must end up owned.
  return out.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });
}

/**
 * Charter ids currently owned by `account`: every Transfer to the account minus every Transfer
 * from it (a burn is a transfer to zero), read from the deployment block. The interface has no
 * enumeration. Progress is checkpointed in localStorage so each poll only reads new blocks.
 */
export function useMyCharters(account?: Address) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["my-charters", account, deployments.charter],
    enabled: deployed && !!account && !!client,
    placeholderData: MOCK ? mockCharterIds : undefined,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<bigint[]> => {
      if (MOCK) return mockCharterIds;
      if (!client || !account) return [];
      const latest = await client.getBlockNumber();
      const deployBlock = BigInt(deployments.block || 0);
      const cp = loadCheckpoint(account);
      const owned = new Set<bigint>((cp?.owned ?? []).map((s) => BigInt(s)));
      let from = cp ? BigInt(cp.scanned) - OVERLAP + 1n : deployBlock;
      if (from < deployBlock) from = deployBlock;
      if (from <= latest) {
        const logs = await scan(client, account, from, latest);
        for (const log of logs) {
          const id = log.args.tokenId!;
          if (log.args.to?.toLowerCase() === account.toLowerCase()) owned.add(id);
          if (log.args.from?.toLowerCase() === account.toLowerCase()) owned.delete(id);
        }
        saveCheckpoint(account, { scanned: latest.toString(), owned: [...owned].map((i) => i.toString()) });
      }
      return [...owned].sort((a, b) => (a < b ? -1 : 1));
    },
  });
}
