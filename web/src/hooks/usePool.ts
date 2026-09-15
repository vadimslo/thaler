"use client";
import { useReadContracts } from "wagmi";
import { deployed, deployments, isZero } from "@/lib/deployments";
import { POLL_MS } from "@/lib/wagmi";
import { MOCK, mockPool } from "@/lib/mock";
import { decodeLiquidity, decodeSlot0, extsloadAbi, poolLiquiditySlot, poolStateSlot, reserves } from "@/lib/pool";

const poolReady = deployed && !MOCK && !isZero(deployments.poolManager) && !/^0x0{64}$/i.test(deployments.poolId);

/** Pool price + liquidity straight from PoolManager storage. Undefined until the pool is bound. */
export function usePool() {
  const q = useReadContracts({
    contracts: [
      { address: deployments.poolManager, abi: extsloadAbi, functionName: "extsload", args: [poolStateSlot(deployments.poolId)] },
      { address: deployments.poolManager, abi: extsloadAbi, functionName: "extsload", args: [poolLiquiditySlot(deployments.poolId)] },
    ],
    query: { enabled: poolReady, refetchInterval: POLL_MS, staleTime: POLL_MS / 2 },
  });
  if (MOCK) return mockPool;
  const raw0 = q.data?.[0]?.status === "success" ? decodeSlot0(q.data[0].result as `0x${string}`) : undefined;
  // sqrtPriceX96 == 0 means the pool is not initialized (or the id is wrong): treat as no reading.
  const s0 = raw0 && raw0.sqrtPriceX96 > 0n ? raw0 : undefined;
  const liq = q.data?.[1]?.status === "success" ? decodeLiquidity(q.data[1].result as `0x${string}`) : undefined;
  const r = s0 && liq !== undefined ? reserves(liq, s0.sqrtPriceX96) : undefined;
  return { ready: poolReady, slot0: s0, liquidity: liq, reserves: r, isLoading: q.isLoading };
}
