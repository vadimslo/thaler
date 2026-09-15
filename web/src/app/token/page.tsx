import type { Metadata } from "next";
import { NumSection, PageHeader } from "@/components/ui";
import { BurnRows, TokenSupply } from "@/components/TokenLive";
import { SwapCard } from "@/components/SwapCard";

export const metadata: Metadata = { title: "Token" };

export default function TokenPage() {
  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <PageHeader
          eyebrow="THALER · ERC-20 on Sepolia"
          title="The currency"
          lede="Hard cap of one billion. One hundred million minted at genesis and paired with ETH as protocol-owned liquidity; the remaining nine hundred million is an issuance budget that only the central bank can spend, and only through chartered banks."
        />
      </div>

      <aside className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-start lg:sticky lg:top-24 lg:pt-1">
        <SwapCard />
      </aside>

      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <NumSection n="01" label="Supply" title="Where it stands.">
          <TokenSupply />
        </NumSection>

        <NumSection n="02" label="What burns supply" title="Three ways out.">
          <BurnRows />
        </NumSection>

        <NumSection n="03" label="Where supply comes from" title="Two sources, one cap.">
          <ul className="space-y-4 text-sm leading-relaxed text-paper-2">
            <li className="flex gap-4"><span className="num shrink-0 text-paper">100,000,000</span><span>Genesis. Minted once, deposited with ETH into the full-range pool position that the treasury owns and can never withdraw.</span></li>
            <li className="flex gap-4"><span className="num shrink-0 text-paper">900,000,000</span><span>Issuance budget. Released to charter holders over time at a base rate of 700,000 per day, scaled by the multiplier the bank sets each epoch. When the budget is spent, issuance stops.</span></li>
          </ul>
        </NumSection>
      </div>
    </div>
  );
}
