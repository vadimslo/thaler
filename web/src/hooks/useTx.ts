"use client";
import { useCallback, useEffect, useState } from "react";
import type { Abi, ContractFunctionArgs, ContractFunctionName } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import type { WriteContractVariables } from "wagmi/query";
import type { wagmiConfig } from "@/lib/wagmi";
import { errorMessage } from "@/lib/format";

type Cfg = typeof wagmiConfig;
type ChainId = Cfg["chains"][number]["id"];

export type TxPhase = "idle" | "wallet" | "mining" | "success" | "error";

/**
 * One write action with a full lifecycle: wallet prompt -> mining -> success/error.
 * `onSuccess` runs once the receipt is confirmed (use it to refetch reads).
 */
export function useTx(onSuccess?: () => void) {
  const { writeContractAsync, data: hash, reset: resetWrite } = useWriteContract();
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
        await writeContractAsync(vars as never);
        setPhase("mining");
      } catch (e) {
        setPhase("error");
        setError(errorMessage(e));
      }
    },
    [writeContractAsync],
  );

  const reset = useCallback(() => {
    resetWrite();
    setPhase("idle");
    setError("");
  }, [resetWrite]);

  return { send, hash, phase, error, reset, busy: phase === "wallet" || phase === "mining" };
}
