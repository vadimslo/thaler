import Link from "next/link";
import { HomeHero } from "@/components/HomeHero";
import { FlowDiagram } from "@/components/FlowDiagram";
import { ActivityFeed } from "@/components/ActivityFeed";
import { SupplyBar, TreasurySplit } from "@/components/Dashboard";
import { Live, NumSection } from "@/components/ui";
import { CONTRACTS, deployments, etherscanAddress, isZero } from "@/lib/deployments";

export default function Home() {
  return (
    <>
      <HomeHero />

      <NumSection n="01" label="The mechanism" title="ETH in raises issuance. ETH out buys it back.">
        <FlowDiagram />
        <div className="mt-8 grid gap-px bg-line sm:grid-cols-2">
          <div className="min-w-0 bg-ink-2 p-5 sm:p-6">
            <div className="eyebrow" style={{ color: "var(--color-good)" }}>Expansion</div>
            <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-paper-2">
              <li className="flex gap-3"><span className="num text-paper-3">01</span><span>ETH buys THALER on the pool. The hook takes a tax in ETH and records the inflow.</span></li>
              <li className="flex gap-3"><span className="num text-paper-3">02</span><span>Tax and charter sales land in the treasury: 70% active vault, 15% protocol-owned liquidity, 15% team.</span></li>
              <li className="flex gap-3"><span className="num text-paper-3">03</span><span>Two consecutive epochs of net inflow raise the multiplier by 0.10, up to 1.25x. Every branch earns more.</span></li>
            </ol>
          </div>
          <div className="min-w-0 bg-ink-2 p-5 sm:p-6">
            <div className="eyebrow" style={{ color: "var(--color-bad)" }}>Contraction</div>
            <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-paper-2">
              <li className="flex gap-3"><span className="num text-paper-3">01</span><span>THALER sells for ETH. The hook takes a tax on the ETH leaving and records the outflow.</span></li>
              <li className="flex gap-3"><span className="num text-paper-3">02</span><span>Net outflow over two epochs cuts the multiplier by 0.15, down to 0.20x. The regime flips to contraction.</span></li>
              <li className="flex gap-3"><span className="num text-paper-3">03</span><span>The contraction vault buys THALER on the pool every hour and burns all of it.</span></li>
            </ol>
          </div>
        </div>
      </NumSection>

      <NumSection n="02" label="Find your entry" title="Two doors.">
        <div className="grid gap-px bg-line sm:grid-cols-2">
          <Door href="/token/" title="Hold the currency" body="Buy and sell THALER on the canonical pool. Supply is capped; the tax on every trade feeds the reserves." cta="Buy THALER" />
          <Door href="/charters/" title="Operate a bank" body="A charter is a licence to issue. Open branches, collect issuance every second, exit when you choose." cta="Acquire a charter" primary />
        </div>
      </NumSection>

      <NumSection n="03" label="The system as it stands" title="Live readings." aside={<Link href="/protocol/" className="text-sm text-paper-3 hover:text-brass">Every parameter →</Link>}>
        <Live>
          <div className="card rise p-4 sm:p-5">
            <SupplyBar />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <TreasurySplit dense />
            <ActivityFeed limit={8} title="Last 8 events" />
          </div>
        </Live>
      </NumSection>

      <NumSection n="04" label="Open for inspection" title="See the system as it stands.">
        <div className="grid gap-px bg-line md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 bg-ink-2 p-5 sm:p-6">
            <div className="eyebrow mb-4">Contracts on Sepolia</div>
            <ul className="divide-y divide-line">
              {CONTRACTS.map((c) => {
                const addr = deployments[c.key] as string;
                return (
                  <li key={c.key} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                    <span className="text-sm text-paper">{c.name}</span>
                    {isZero(addr) ? (
                      <span className="num text-xs text-paper-3">not deployed</span>
                    ) : (
                      <a href={etherscanAddress(addr)} target="_blank" rel="noreferrer" className="num truncate text-xs text-brass underline underline-offset-4 hover:text-paper">{addr}</a>
                    )}
                  </li>
                );
              })}
            </ul>
            <Link href="/contracts/" className="mt-4 inline-block text-sm text-paper-3 hover:text-brass">Addresses, pool id, how to verify →</Link>
          </div>
          <div className="min-w-0 bg-ink-2 p-5 sm:p-6">
            <div className="eyebrow mb-4">Whitepaper</div>
            <p className="text-sm leading-relaxed text-paper-2">Every rule, every parameter, every risk, in one document. Everything on this site is in it.</p>
            <Link href="/whitepaper/" className="btn mt-5 w-full">Read the whitepaper</Link>
            <Link href="/updates/" className="mt-3 block text-sm text-paper-3 hover:text-brass">Changelog →</Link>
          </div>
        </div>
      </NumSection>
    </>
  );
}

function Door({ href, title, body, cta, primary }: { href: string; title: string; body: string; cta: string; primary?: boolean }) {
  return (
    <Link href={href} className="group block bg-ink-2 p-6 transition-colors hover:bg-ink-3 sm:p-8">
      <div className="font-display text-3xl transition-colors group-hover:text-brass">{title}</div>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-paper-2">{body}</p>
      <span className={`btn btn-sm mt-6 ${primary ? "btn-primary" : ""}`}>{cta} →</span>
    </Link>
  );
}
