import type { Metadata } from "next";
import Link from "next/link";
import { CharterCurve, ChartersHero } from "@/components/protocol/Heroes";
import { Icon } from "@/components/shell/Icons";
import { Live, NumSection } from "@/components/ui";
import { HAS_WITHDRAW_FEE } from "@/lib/abiFlags";

export const metadata: Metadata = { title: "Charters and Auctions" };

export default function ChartersInfoPage() {
  return (
    <>
      <ChartersHero withdrawFee={HAS_WITHDRAW_FEE} />

      <NumSection n="01" label="Acquiring a charter" title="Two ways in." aside={<Link href="/app/banks/" className="btn btn-sm btn-primary">Acquire a charter <Icon name="arrow" size={12} /></Link>}>
        <div className="grid gap-px bg-line lg:grid-cols-2">
          <div className="min-w-0 bg-ink-2 p-5 sm:p-6">
            <div className="eyebrow">Founding mint · fixed price</div>
            <div className="font-display mt-1 text-2xl">One thousand founding charters</div>
            <p className="mt-3 text-sm leading-relaxed text-paper-2">Sold at a fixed price, up to three per wallet, with sequential ids. Each charter registers with the central bank on mint and starts accruing immediately. The ETH goes to the treasury and is split like every other inflow.</p>
          </div>
          <div className="min-w-0 bg-ink-2 p-5 sm:p-6">
            <div className="eyebrow">Dutch auction · resets daily</div>
            <div className="font-display mt-1 text-2xl">Ten more each day</div>
            <p className="mt-3 text-sm leading-relaxed text-paper-2">After the founding supply, charters sell only at auction. Each UTC day opens at three times the last close and halves every four hours toward the floor. You pay the current ask; anything above the clearing price is refunded in the same transaction.</p>
          </div>
        </div>
        <div className="mt-4">
          <Live compact>
            <CharterCurve />
          </Live>
        </div>
      </NumSection>

      <NumSection n="02" label="Branches and licences" title="Growing a bank.">
        <div className="grid gap-px bg-line lg:grid-cols-3">
          <Fact k="Issuance" body="The bank issues a base of 700,000 THALER per day, scaled by the multiplier. The total is split evenly across every open branch in the system, so each branch earns the same, every second." />
          <Fact k="Licences" body="A charter starts with one branch and can hold ten. Each additional branch needs a licence, sold at a daily Dutch auction of one hundred: the price opens at twice the last close and halves every four hours toward two days of one branch's issuance. Licences are paid in THALER and burned." />
          <Fact k={HAS_WITHDRAW_FEE ? "Withdrawal and resolution" : "Resolution"} body={HAS_WITHDRAW_FEE ? "Withdraw pending issuance whenever you like. A fee on the amount settled decays quadratically from 60% at mint to 2% after thirty days; half of it is never minted, half goes to the other branches. Resolving is a final withdrawal, after which the charter and its branches are burned." : "Exit whenever you like. A fee on pending issuance decays quadratically from 60% at mint to 2% after thirty days; half of it is never minted, half goes to the banks that remain. The charter and its branches are burned."} />
        </div>
      </NumSection>

      <NumSection n="03" label="Where to act" title="The App side of the shell.">
        <div className="grid gap-px bg-line sm:grid-cols-2">
          <Link href="/app/banks/" className="group block bg-ink-2 p-6 transition-colors hover:bg-ink-3">
            <div className="font-display text-2xl transition-colors group-hover:text-brass">Banks</div>
            <p className="mt-2 text-sm leading-relaxed text-paper-2">Mint, open branches, withdraw, resolve. Your charters with their pending issuance and the fee they would pay right now.</p>
          </Link>
          <Link href="/app/auction/" className="group block bg-ink-2 p-6 transition-colors hover:bg-ink-3">
            <div className="font-display text-2xl transition-colors group-hover:text-brass">Auction House</div>
            <p className="mt-2 text-sm leading-relaxed text-paper-2">Both auctions live: today&apos;s curve, the current ask, what is left, and the two clock actions anyone can call.</p>
          </Link>
        </div>
      </NumSection>
    </>
  );
}

function Fact({ k, body }: { k: string; body: string }) {
  return (
    <div className="min-w-0 bg-ink-2 p-5 sm:p-6">
      <div className="font-display text-xl">{k}</div>
      <p className="mt-2 text-sm leading-relaxed text-paper-2">{body}</p>
    </div>
  );
}
