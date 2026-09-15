import Link from "next/link";
import { ActivityFeed } from "@/components/ActivityFeed";
import { AuctionHouseCard, HomeHero, HomeTiles, Notice, PositionCard } from "@/components/home/HomeLive";
import { Icon } from "@/components/shell/Icons";
import { Live } from "@/components/ui";

export default function Home() {
  return (
    <>
      <HomeHero />
      <div className="mt-4"><Notice /></div>
      <div className="mt-4"><HomeTiles /></div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PositionCard />
        <AuctionHouseCard />
      </div>

      <div className="mt-4">
        <Live compact>
          <ActivityFeed limit={8} title="Ledger · last 8 events" footer={<Link href="/app/activity/" className="link-quiet">Full ledger with filters <Icon name="arrow" size={12} className="ml-1 inline" /></Link>} />
        </Live>
      </div>

      <section className="mt-10 sm:mt-14">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <div className="sec-num"><b>How it works</b> / in one minute</div>
            <h2 className="font-display mt-2 text-2xl sm:text-3xl">Three moving parts.</h2>
          </div>
          <Link href="/app/protocol/" className="link-quiet text-sm">Protocol Info <Icon name="arrow" size={12} className="ml-1 inline" /></Link>
        </div>
        <div className="grid gap-px bg-line md:grid-cols-3">
          <Step n="01" icon="pool" title="ETH flows through one pool" body="Every buy and sell of THALER passes the canonical pool. The hook takes a tax in ETH and records net flow per epoch." />
          <Step n="02" icon="scale" title="The bank sets the multiplier" body="Two epochs of net inflow raise issuance by 0.10x, up to 1.25x. Net outflow cuts it by 0.15x, down to 0.20x, and flips the regime." />
          <Step n="03" icon="flame" title="Banks issue, the treasury burns" body="Chartered banks mint THALER every second across their branches. In contraction the treasury buys THALER back every hour and burns it." />
        </div>
      </section>
    </>
  );
}

function Step({ n, icon, title, body }: { n: string; icon: "pool" | "scale" | "flame"; title: string; body: string }) {
  return (
    <div className="step">
      <span className="step-glyph"><Icon name={icon} size={18} /></span>
      <div className="min-w-0">
        <div className="sec-num"><b>{n}</b></div>
        <div className="font-display mt-1 text-xl">{title}</div>
        <p className="mt-2 text-sm leading-relaxed text-paper-2">{body}</p>
      </div>
    </div>
  );
}
