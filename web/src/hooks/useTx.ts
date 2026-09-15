"use client";
import { useCallback, useEffect, useState } from "react";
import type { Abi, ContractFunctionArgs, ContractFunctionName } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract, usePublicClient } from "wagmi";
import type { WriteContractVariables } from "wagmi/query";
import type { wagmiConfig } from "@/lib/wagmi";
import { errorMessage } from "@/lib/format";

type Cfg = typeof wagmiConfig;
type ChainId = Cfg["chains"][number]["id"];

export type TxPhase = "idle" | "wallet" | "mining" | "success" | "error";

// Public Sepolia RPCs have returned estimates up to 60k below the real cost for these paths
// (nested PoolManager calls, accrual bookkeeping that depends on the block). Unused gas is refunded,
// so a generous floor costs nothing on success and prevents an out-of-gas revert that does cost.
const GAS_FLOOR: Record<string, bigint> = {
  swapExactIn: 300_000n,
  mintFounding: 350_000n,
  buyAtAuction: 350_000n,
  openBranch: 250_000n,
  withdraw: 250_000n,
  resolve: 300_000n,
  tick: 450_000n,
  rollEpochs: 250_000n,
  approve: 80_000n,
};

/**
 * One write action with a full lifecycle: wallet prompt -> mining -> success/error.
 * `onSuccess` runs once the receipt is confirmed (use it to refetch reads).
 */
export function useTx(onSuccess?: () => void) {
  const { writeContractAsync, data: hash, reset: resetWrite } = useWriteContract();
  const publicClient = usePublicClient();
  const { address: connected } = useAccount();
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [error, setError] = useState<string>("");
  const receipt = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } });

  useEffect(() => {
    if (!hash) return;
    if (receipt.isSuccess) {
      if (receipt.data?.status === "reverted") {
        setPhase("error");
        setError("Transaction reverted on-chain.");
      } else {
        setPhase("success");
        onSuccess?.();
      }
    } else if (receipt.isError) {
      setPhase("error");
      setError(errorMessage(receipt.error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, receipt.isSuccess, receipt.isError]);

  const send = useCallback(
    async <
      const abi extends Abi | readonly unknown[],
      functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
      args extends ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>,
    >(
      vars: WriteContractVariables<abi, functionName, args, Cfg, ChainId>,
    ) => {
      setError("");
      setPhase("wallet");
      try {
        // Gas: estimate ourselves and add 30%. Wallet estimates come back tight for the
        // router / bank paths (nested calls plus a reentrancy sentry at the very end), and a
        // tight limit fails on-chain even though eth_estimateGas passed.
        let gas: bigint | undefined;
        try {
          const v = vars as unknown as { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint; account?: `0x${string}` };
          if (publicClient) {
            const est = await publicClient.estimateContractGas({
              address: v.address, abi: v.abi, functionName: v.functionName, args: v.args as never,
              value: v.value, account: v.account ?? connected,
            } as never);
            const floor = GAS_FLOOR[v.functionName] ?? 150_000n;
            const padded = (est * 150n) / 100n;
            gas = padded > floor ? padded : floor;
          }
        } catch (estErr) {
          console.warn("[thaler] gas estimate failed, wallet will estimate", estErr);
          gas = GAS_FLOOR[(vars as unknown as { functionName: string }).functionName]; // still apply the floor
        }
        await writeContractAsync({ ...(vars as object), ...(gas ? { gas } : {}) } as never);
        setPhase("mining");
      } catch (e) {
        setPhase("error");
        setError(errorMessage(e));
      }
    },
    [writeContractAsync, publicClient, connected],
  );

  const reset = useCallback(() => {
    resetWrite();
    setPhase("idle");
    setError("");
  }, [resetWrite]);

  return { send, hash, phase, error, reset, busy: phase === "wallet" || phase === "mining" };
}
