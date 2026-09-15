import type { Metadata } from "next";
import { Ledger } from "@/components/Ledger";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <>
      <PageHeader eyebrow="Ledger · every protocol event" title="Activity" lede="Read straight from the chain, newest first: trades and their tax, charters minted and resolved, branches opened, withdrawals, epoch rolls, treasury splits and buybacks." />
      <Ledger />
    </>
  );
}
