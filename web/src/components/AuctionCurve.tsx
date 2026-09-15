"use client";

/**
 * Today's Dutch-auction decay: opens at `open`, halves every `halfLife` seconds toward `floor` over a
 * 24-hour UTC day. The chart is a fixed 120px tall at any width: the geometry is an SVG stretched to
 * the box (x in tenths of a percent, y in pixels) and the labels and the live marker are HTML placed
 * over it, so they stay 10px and legible on a phone.
 */
export function AuctionCurve({ open, floor, halfLife, secondsIntoDay, price, className = "" }: { open: number; floor: number; halfLife: number; secondsIntoDay: number | undefined; price: number | undefined; className?: string }) {
  const W = 1000;
  const H = 120;
  const pad = { l: 8, r: 8, t: 14, b: 18 };
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
  const pct = (v: number) => `${(v / W) * 100}%`;
  const nowRight = mx !== undefined && mx > W * 0.7;

  return (
    <div className={`curve ${className}`} role="img" aria-label="Auction price over today, opening high and decaying toward the floor">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1={pad.l} x2={W - pad.r} y1={y(floor)} y2={y(floor)} stroke="var(--color-line-2)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        <line x1={pad.l} x2={W - pad.r} y1={y(open)} y2={y(open)} stroke="var(--color-line)" vectorEffect="non-scaling-stroke" />
        <path d={pts.join(" ")} fill="none" stroke="var(--color-brass)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
        {mx !== undefined && <line x1={mx} x2={mx} y1={pad.t} y2={H - pad.b} stroke="var(--color-line-2)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {mx !== undefined && my !== undefined && (
        <>
          <span className="curve-marker" style={{ left: pct(mx), top: my }} />
          <span
            className="curve-label"
            style={{ color: "var(--color-paper)", top: Math.max(pad.t - 4, my - 16), ...(nowRight ? { right: `calc(${pct(W - mx)} + 8px)` } : { left: `calc(${pct(mx)} + 8px)` }) }}
          >
            now
          </span>
        </>
      )}
      <span className="curve-label" style={{ left: pct(pad.l), bottom: 4 }}>00:00 UTC</span>
      <span className="curve-label" style={{ right: pct(pad.r), bottom: 4 }}>24:00</span>
      <span className="curve-label" style={{ right: pct(pad.r), top: y(floor) - 13 }}>floor</span>
      <span className="curve-label" style={{ left: pct(pad.l), top: y(open) - 13 }}>open</span>
    </div>
  );
}
