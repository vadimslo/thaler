import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ChartersLive } from "@/components/ChartersLive";
import { HAS_WITHDRAW_FEE } from "@/lib/abiFlags";

export const metadata: Metadata = { title: "Charters" };

export default function ChartersPage() {
  return (
    <>
      <PageHeader
        eyebrow="Charter · ERC-721 on Sepolia · soulbound"
        title="Operate a bank"
        lede={`A charter is a licence to issue. Each charter starts with one branch and accrues a share of the daily issuance, split evenly across every branch in the system. Open more branches by buying licences at auction, paid in THALER and burned. ${HAS_WITHDRAW_FEE ? "Withdraw whenever you like: a fee on the issuance you settle decays from 60% at mint to 2% after thirty days, and resolving is a final withdrawal." : "Exit whenever you like: a fee on pending issuance decays from 60% to 2% over thirty days."}`}
      />
      <div className="sec-num mb-4"><b>01</b> / Acquire a charter</div>
      <ChartersLive />
    </>
  );
}
