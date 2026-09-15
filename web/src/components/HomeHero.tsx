"use client";
import Link from "next/link";
import { epochClock, useParams, usePolicy, useTreasuryEth } from "@/hooks/useProtocol";
import { useNow } from "@/hooks/useNow";
import { deployed } from "@/lib/deployments";
import { fmtHm, fmtInt, fmtNumCompact, fmtNumEth, n18, NA } from "@/lib/format";
import { Count } from "./Count";
import { DeploymentPending, Tile } from "./ui";

export function HomeHero() {
  return (
    <section className="grid gap-10 pb-12 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16 sm:pb-16">
      <div>
        <div className="eyebrow mb-4">Ethereum Sepolia · testnet · no value</div>
        <h1 className="font-display max-w-3xl text-[2.6rem] leading-[1.02] sm:text-6xl">
          One currency.
          <br />
          A central bank behind it.
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-paper-2 sm:text-lg">
          Thaler is a monetary system written as contracts. The currency has a fixed cap. The bank behind it watches
          ETH flow through one pool and tightens or loosens issuance in response. No committee, no discretion.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/charters/" className="btn btn-primary btn-lg px-6">Acquire a charter</Link>
          <Link href="/token/" className="btn btn-lg px-6">Buy THALER</Link>
        </div>
      </div>
      <HeroStats />
    </section>
  );
}

function HeroStats() {
  const p = useParams();
  const s = usePolicy();
  const treasuryEth = useTreasuryEth();
  const now = useNow();
  const { epoch, toNext } = epochClock(p, s.currentEpoch, now);

  if (!deployed) {
    return (
      <div className="lg:w-full lg:max-w-lg lg:justify-self-end">
        <DeploymentPending />
      </div>
    );
  }
  return (
    <div className="lg:w-full lg:max-w-lg lg:justify-self-end">
      <div className="grid grid-cols-3 gap-px bg-line">
        <Tile label="Circulating" value={<Count value={n18(s.totalSupply)} fmt={(n) => fmtNumCompact(n, 1)} />} sub="THALER, cap 1.0B" className="rise-2" />
        <Tile label="Burned" value={<Count value={n18(s.totalBurned)} fmt={(n) => fmtNumCompact(n, 1)} />} sub="THALER, all time" className="rise-3" />
        <Tile label="Treasury" value={<Count value={n18(treasuryEth)} fmt={(n) => fmtNumEth(n, 3)} />} sub="ETH held" className="rise-4" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-4 text-xs">
        <div className="num text-paper-2">
          Epoch {fmtInt(epoch)} <span className="text-paper-3">·</span> {toNext === undefined ? NA : fmtHm(toNext)} to next
        </div>
        <div className="num text-paper-3">
          {s.regime === undefined ? NA : <span style={{ color: s.regime === 1 ? "var(--color-bad)" : "var(--color-good)" }}>{s.regime === 1 ? "Contraction" : "Expansion"}</span>} · {s.multiplier === undefined ? NA : (Number(s.multiplier) / 10_000).toFixed(2) + "x"}
        </div>
      </div>
    </div>
  );
}
