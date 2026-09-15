"use client";
import { useParams, usePolicy, useTreasury } from "@/hooks/useProtocol";
import { fmtCompact, fmtEth, fmtNumEth, fmtToken, n18, NA, share } from "@/lib/format";
import { Count } from "./Count";
import { SegBar, type Segment } from "./ui";

const C = {
  genesis: "var(--color-brass-2)",
  issued: "var(--color-brass)",
  burned: "var(--color-bad)",
  remaining: "var(--color-line-2)",
};

/**
 * Supply as one bar of the hard cap: genesis POL, issued and still circulating, burned, remaining budget.
 * The four parts sum to the cap; burned is carved out of what was minted.
 */
export function SupplyBar({ compact = false }: { compact?: boolean }) {
  const p = useParams();
  const s = usePolicy();
  const cap = p.cap;
  const genesis = cap !== undefined && p.issuanceBudget !== undefined ? cap - p.issuanceBudget : undefined;
  const issued = s.totalIssued;
  const burned = s.totalBurned;
  const remaining = p.issuanceBudget !== undefined && issued !== undefined ? p.issuanceBudget - issued : undefined;
  const minted = genesis !== undefined && issued !== undefined ? genesis + issued : undefined;
  const circulatingIssued = issued !== undefined && burned !== undefined ? (issued > burned ? issued - burned : 0n) : undefined;
  const genesisLeft = minted !== undefined && burned !== undefined && circulatingIssued !== undefined ? minted - burned - circulatingIssued : genesis;

  const segs: Segment[] = [
    { label: "Genesis POL", share: share(genesisLeft, cap), color: C.genesis, value: genesis === undefined ? NA : fmtCompact(genesis) },
    { label: "Issued", share: share(circulatingIssued, cap), color: C.issued, value: issued === undefined ? NA : `${fmtToken(issued, 0)}` },
    { label: "Burned", share: share(burned, cap), color: C.burned, value: burned === undefined ? NA : `${fmtToken(burned, 0)}` },
    { label: "Budget left", share: share(remaining, cap), color: C.remaining, value: remaining === undefined ? NA : fmtCompact(remaining) },
  ];
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div className="eyebrow">Supply · of {cap === undefined ? NA : fmtCompact(cap)} cap</div>
        {!compact && (
          <div className="num text-sm text-paper">
            <Count value={n18(s.totalSupply)} fmt={(n) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)} /> <span className="text-xs text-paper-3">circulating</span>
          </div>
        )}
      </div>
      <SegBar segments={segs} />
    </div>
  );
}

type SplitRow = { label: string; sub: string; value: bigint | undefined; tone?: string };

/** Treasury vaults as horizontal bars against the total held, with the ETH amount per line. */
export function TreasurySplit({ dense = false }: { dense?: boolean }) {
  const t = useTreasury();
  const s = usePolicy();
  const rows: SplitRow[] = [
    { label: "Expansion vault", sub: s.regime === 0 ? "active vault now · reserves" : "reserves", value: t.expansionVault },
    { label: "Contraction vault", sub: s.regime === 1 ? "active vault now · buys back and burns" : "buys back and burns", value: t.contractionVault, tone: "var(--color-bad)" },
    { label: "POL vault", sub: "compounds into the pool position", value: t.polVault },
    { label: "Team vault", sub: "claimable by the team", value: t.teamVault },
    { label: "Unallocated", sub: "split 70 / 15 / 15 on the next tick", value: t.unallocated },
  ];
  const known = rows.every((r) => r.value !== undefined);
  const total = known ? rows.reduce((a, r) => a + (r.value as bigint), 0n) : undefined;
  const max = known ? rows.reduce((a, r) => ((r.value as bigint) > a ? (r.value as bigint) : a), 0n) : undefined;

  return (
    <div className="card rise">
      <div className="hairline-b flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5">
        <div className="eyebrow">Treasury · every inbound ETH splits live</div>
        <div className="eyebrow hidden sm:block">share of held</div>
      </div>
      <ul>
        {rows.map((r) => {
          const pct = share(r.value, total);
          const w = share(r.value, max);
          return (
            <li key={r.label} className={`hairline-b grid items-center gap-x-4 gap-y-1 px-4 sm:px-5 ${dense ? "py-2.5" : "py-3"} grid-cols-[1fr_auto] sm:grid-cols-[200px_1fr_52px_120px]`}>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-paper">{r.label}</div>
                <div className="truncate text-[11px] text-paper-3">{r.sub}</div>
              </div>
              <div className="num text-right text-sm text-paper sm:order-4">
                <Count value={n18(r.value)} fmt={(n) => fmtNumEth(n, 4)} /> <span className="text-xs text-paper-3">ETH</span>
              </div>
              <div className="col-span-2 sm:col-span-1 sm:order-2">
                <div className="track"><i style={{ width: `${w * 100}%`, background: r.tone ?? "var(--color-brass)" }} /></div>
              </div>
              <div className="num hidden text-right text-xs text-paper-3 sm:order-3 sm:block">{known ? `${(pct * 100).toFixed(0)}%` : NA}</div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5">
        <div className="eyebrow">Total held</div>
        <div className="num text-base text-paper">{fmtEth(total, 4)} <span className="text-xs text-paper-3">ETH</span></div>
      </div>
    </div>
  );
}
