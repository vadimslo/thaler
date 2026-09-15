import { centralBankAbi } from "@/abi";

/** True when the synced CentralBank interface exposes `withdrawFeeBps` (fee charged on every withdrawal). */
export const HAS_WITHDRAW_FEE = (centralBankAbi as readonly { type: string; name?: string }[]).some((e) => e.type === "function" && e.name === "withdrawFeeBps");
