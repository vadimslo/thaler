"use client";

/**
 * Today's Dutch-auction decay as a small SVG: opens at `open`, halves every `halfLife` seconds toward
 * `floor` over a 24-hour UTC day. `now` (seconds into the day) and `price` place the marker on the live reading.
 */
export function AuctionCurve({ open, floor, halfLife, secondsIntoDay, price, className = "" }: { open: number; floor: number; halfLife: number; secondsIntoDay: number | undefined; price: number | undefined; className?: string }) {
  const W = 480;
  const H = 120;
  const pad = { l: 6, r: 6, t: 14, b: 18 };
  const day = 86_400;
  const top = Math.max(open, floor * 1.0001);
  const x = (t: number) => pad.l + (t / day) * (W - pad.l - pad.r);
  const y = (v: number) => {
    const k = top === floor ? 0 : (v - floor) / (top - floor);
    return H - pad.b - Math.max(0, Math.min(1, k)) * (H - pad.t - pad.b);
  };
  const pts: string[] = [];
  const N = 72;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * day;
    const v = floor + (open - floor) * Math.pow(0.5, t / halfLife);
    pts.push(`${i === 0 ? "M" : "L"}${x(t).toFixed(1)},${y(v).toFixed(1)}`);
  }
  const mx = secondsIntoDay === undefined ? undefined : x(secondsIntoDay);
  const my = price === undefined ? undefined : y(price);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className={className} role="img" aria-label="Auction price over today, opening high and decaying toward the floor" style={{ display: "block", height: "auto" }}>
      <line x1={pad.l} x2={W - pad.r} y1={y(floor)} y2={y(floor)} stroke="var(--color-line-2)" strokeDasharray="2 3" />
      <line x1={pad.l} x2={W - pad.r} y1={y(open)} y2={y(open)} stroke="var(--color-line)" />
      <path d={pts.join(" ")} fill="none" stroke="var(--color-brass)" strokeWidth="1.25" />
      {mx !== undefined && (
        <line x1={mx} x2={mx} y1={pad.t} y2={H - pad.b} stroke="var(--color-line-2)" />
      )}
      {mx !== undefined && my !== undefined && (
        <g>
          <circle cx={mx} cy={my} r="3.5" fill="var(--color-ink)" stroke="var(--color-paper)" strokeWidth="1.25" />
          <text x={mx + (mx > W * 0.7 ? -8 : 8)} y={Math.max(pad.t + 8, my - 6)} textAnchor={mx > W * 0.7 ? "end" : "start"} className="flow-label" style={{ fill: "var(--color-paper)" }}>now</text>
        </g>
      )}
      <text x={pad.l} y={H - 5} className="flow-label">00:00 UTC</text>
      <text x={W - pad.r} y={H - 5} textAnchor="end" className="flow-label">24:00</text>
      <text x={W - pad.r} y={y(floor) - 4} textAnchor="end" className="flow-label">floor</text>
      <text x={pad.l} y={y(open) - 4} className="flow-label">open</text>
    </svg>
  );
}
