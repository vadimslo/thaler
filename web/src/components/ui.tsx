import Link from "next/link";
import { deployed, etherscanTx } from "@/lib/deployments";
import { shortHash } from "@/lib/format";
import type { TxPhase } from "@/hooks/useTx";

export function PageHeader({ eyebrow, title, lede, aside }: { eyebrow?: string; title: string; lede?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-6 sm:mb-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
          <h1 className="font-display text-4xl leading-[1.05] sm:text-5xl">{title}</h1>
          {lede && <p className="mt-4 max-w-2xl text-base leading-relaxed text-paper-2 sm:text-lg">{lede}</p>}
        </div>
        {aside}
      </div>
    </div>
  );
}

/** Numbered section: "01 / THE MECHANISM" with an optional serif title and right-hand aside. */
export function NumSection({ n, label, title, aside, children, className = "" }: { n: string; label: string; title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`hairline-t py-10 sm:py-14 ${className}`}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:mb-8">
        <div>
          <div className="sec-num"><b>{n}</b> / {label}</div>
          {title && <h2 className="font-display mt-2 text-2xl sm:text-3xl">{title}</h2>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="hairline-t py-8 sm:py-10">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-2xl">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Stat tile: uppercase label, big mono value, small mono sub line, optional bar under it. */
export function Tile({ label, value, unit, sub, bar, size = "md", className = "", tone }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; bar?: number; size?: "md" | "lg"; className?: string; tone?: "good" | "bad" }) {
  return (
    <div className={`tile rise ${className}`}>
      <div className="eyebrow">{label}</div>
      <div className={`tile-value ${size === "lg" ? "tile-value-lg" : ""}`} style={tone ? { color: `var(--color-${tone})` } : undefined}>
        <span>{value}</span>
        {unit && <span className="tile-unit">{unit}</span>}
      </div>
      {sub !== undefined && <div className="tile-sub">{sub}</div>}
      {bar !== undefined && <div className="track mt-3"><i style={{ width: `${Math.max(0, Math.min(100, bar * 100))}%` }} /></div>}
    </div>
  );
}

export function Progress({ value, className = "" }: { value: number; className?: string }) {
  return <div className={`track ${className}`}><i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div>;
}

export type Segment = { label: string; share: number; color: string; value: string };

/** Segmented bar with a legend of swatch, label and value. */
export function SegBar({ segments, className = "" }: { segments: Segment[]; className?: string }) {
  return (
    <div className={className}>
      <div className="segbar">
        {segments.map((s) => (
          <i key={s.label} style={{ width: `${Math.max(0, s.share * 100)}%`, background: s.color }} title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {segments.map((s) => (
          <li key={s.label} className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 shrink-0" style={{ background: s.color }} />
              <span className="eyebrow truncate">{s.label}</span>
            </div>
            <div className="num mt-1 truncate text-sm text-paper">{s.value}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Label above, tabular number below. */
export function Stat({ label, value, sub, size = "md" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; size?: "md" | "lg" }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className={`num mt-1.5 truncate text-paper ${size === "lg" ? "text-2xl sm:text-3xl" : "text-lg"}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-paper-3">{sub}</div>}
    </div>
  );
}

/** Key/value rows in a hairline table. */
export function Rows({ rows }: { rows: { k: string; v: React.ReactNode; note?: React.ReactNode }[] }) {
  return (
    <dl className="hairline divide-y divide-line">
      {rows.map((r) => (
        <div key={r.k} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
          <dt className="text-sm text-paper-2">
            {r.k}
            {r.note && <span className="ml-2 text-xs text-paper-3">{r.note}</span>}
          </dt>
          <dd className="num text-right text-sm text-paper sm:text-base">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DeploymentPending({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`card flex items-center gap-3 ${compact ? "px-4 py-3" : "px-5 py-6"}`}>
      <span className="pulse inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brass" />
      <div>
        <div className="text-sm text-paper">Deployment pending</div>
        {!compact && (
          <div className="mt-0.5 text-xs text-paper-3">
            Contracts are not on Sepolia yet. Live readings and actions appear here once addresses are published. See <Link href="/contracts/" className="underline underline-offset-2 hover:text-paper">Contracts</Link>.
          </div>
        )}
      </div>
    </div>
  );
}

/** Wraps live content: shows the pending state until addresses exist. */
export function Live({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  if (!deployed) return <DeploymentPending compact={compact} />;
  return <>{children}</>;
}

export function TxStatus({ phase, hash, error, onReset, successText = "Confirmed." }: { phase: TxPhase; hash?: `0x${string}`; error?: string; onReset?: () => void; successText?: string }) {
  if (phase === "idle") return null;
  const link = hash && (
    <a href={etherscanTx(hash)} target="_blank" rel="noreferrer" className="num underline underline-offset-2 hover:text-paper">
      {shortHash(hash)}
    </a>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-live="polite">
      {phase === "wallet" && <span className="text-paper-2"><span className="pulse mr-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brass" />Confirm in your wallet</span>}
      {phase === "mining" && <span className="text-paper-2"><span className="pulse mr-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brass" />Pending {link}</span>}
      {phase === "success" && <span style={{ color: "var(--color-good)" }}>{successText} {link}</span>}
      {phase === "error" && <span style={{ color: "var(--color-bad)" }}>{error || "Failed."} {link}</span>}
      {(phase === "success" || phase === "error") && onReset && (
        <button className="text-paper-3 underline underline-offset-2 hover:text-paper" onClick={onReset}>Dismiss</button>
      )}
    </div>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-paper-3">{children}</p>;
}
