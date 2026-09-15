import type { Metadata } from "next";
import Link from "next/link";
import { TokenHero } from "@/components/protocol/Heroes";
import { Icon } from "@/components/shell/Icons";
import { NumSection } from "@/components/ui";
import { BurnRows, TokenSupply } from "@/components/TokenLive";

export const metadata: Metadata = { title: "The Token" };

export default function TokenPage() {
  return (
    <>
      <TokenHero />

      <NumSection n="01" label="Supply" title="Where it stands." aside={<Link href="/app/swap/" className="btn btn-sm btn-primary">Buy THALER <Icon name="arrow" size={12} /></Link>}>
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
    </>
  );
}
