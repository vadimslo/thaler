import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { BanksLive } from "@/components/Charters";

export const metadata: Metadata = { title: "Banks" };

export default function BanksPage() {
  return (
    <>
      <PageHeader
        eyebrow="Banks · charters you hold"
        title="My charters"
        lede="Mint a founding charter or buy one at auction, open branches with licences, withdraw issuance as it accrues, resolve when you are done."
      />
      <div className="sec-num mb-4"><b>01</b> / Acquire a charter</div>
      <BanksLive />
    </>
  );
}
