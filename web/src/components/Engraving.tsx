/**
 * Generative fallback for a hero illustration: an engraving of a monumental facade. Columns as
 * brass hairlines in one-point perspective, a vault circle, fine horizontal hatching and a slow
 * light sweep. Everything is derived from `seed`, so server and client render the same picture.
 */
export function Engraving({ seed = 1, className = "" }: { seed?: number; className?: string }) {
  const W = 1600;
  const H = 600;
  // Deterministic pseudo-random in [0, 1).
  const rnd = (i: number) => {
    const x = Math.sin(seed * 9301 + i * 49297) * 233280;
    return x - Math.floor(x);
  };
  const horizon = 300;
  const vpX = 1180 + Math.round(rnd(1) * 240); // vanishing point drifts right, keeps the left clear for copy
  const count = 9 + Math.round(rnd(2) * 4);
  const x0 = 520 + Math.round(rnd(3) * 120);
  const ratio = 0.78 + rnd(4) * 0.06;
  const colW = 34;

  const columns: { x: number; s: number; w: number; op: number }[] = [];
  let x = x0;
  let gap = 120;
  for (let i = 0; i < count; i++) {
    const s = Math.max(0.16, 1 - (x - x0) / (vpX - x0 + 40)); // scale toward the vanishing point
    columns.push({ x, s, w: colW * s, op: 0.16 + 0.62 * s });
    x += gap;
    gap *= ratio;
  }
  const topY = (s: number) => horizon - 235 * s;
  const botY = (s: number) => horizon + 235 * s;
  const first = columns[0];
  const last = columns[columns.length - 1];

  // The vault sits at the end of the hall, behind the last columns.
  const cx = vpX - 20 + Math.round(rnd(5) * 40);
  const cy = horizon - 30 + Math.round(rnd(6) * 40);
  const r = 150 + Math.round(rnd(7) * 40);
  const spokes = 12;
  const hid = `hatch-${seed}`;
  const gid = `sweep-${seed}`;
  const fid = `fade-${seed}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <defs>
        <pattern id={hid} width="6" height="6" patternUnits="userSpaceOnUse">
          <line x1="0" y1="3" x2="6" y2="3" stroke="var(--color-paper)" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--color-brass)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--color-brass)" stopOpacity="0.09" />
          <stop offset="1" stopColor="var(--color-brass)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={fid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-ink)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--color-ink)" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="var(--color-ink-2)" />
      <rect width={W} height={H} fill={`url(#${hid})`} />

      {/* floor and entablature receding to the vanishing point */}
      <g stroke="var(--color-brass)" strokeWidth="1" fill="none">
        <line x1={first.x - 80} y1={botY(1) + 24} x2={vpX} y2={horizon} strokeOpacity="0.28" />
        <line x1={first.x - 80} y1={topY(1) - 26} x2={vpX} y2={horizon} strokeOpacity="0.28" />
        <line x1={first.x - 80} y1={topY(1) - 44} x2={vpX} y2={horizon} strokeOpacity="0.16" />
        <line x1={0} y1={botY(1) + 24} x2={first.x - 80} y2={botY(1) + 24} strokeOpacity="0.2" />
        <line x1={0} y1={topY(1) - 26} x2={first.x - 80} y2={topY(1) - 26} strokeOpacity="0.2" />
        <line x1={0} y1={topY(1) - 44} x2={first.x - 80} y2={topY(1) - 44} strokeOpacity="0.12" />
      </g>

      {/* vault: concentric hairlines and spokes */}
      <g stroke="var(--color-brass)" fill="none" strokeWidth="1">
        <circle cx={cx} cy={cy} r={r} strokeOpacity="0.5" />
        <circle cx={cx} cy={cy} r={r * 0.82} strokeOpacity="0.32" />
        <circle cx={cx} cy={cy} r={r * 0.58} strokeOpacity="0.38" />
        <circle cx={cx} cy={cy} r={r * 0.3} strokeOpacity="0.55" />
        <circle cx={cx} cy={cy} r={4} fill="var(--color-brass)" fillOpacity="0.6" stroke="none" />
        {Array.from({ length: spokes }, (_, i) => {
          const a = (i / spokes) * Math.PI * 2;
          return <line key={i} x1={cx + Math.cos(a) * r * 0.3} y1={cy + Math.sin(a) * r * 0.3} x2={cx + Math.cos(a) * r * 0.82} y2={cy + Math.sin(a) * r * 0.82} strokeOpacity="0.22" />;
        })}
      </g>

      {/* colonnade */}
      <g stroke="var(--color-brass)" fill="none" strokeLinecap="square">
        {columns.map((c, i) => {
          const t = topY(c.s);
          const b = botY(c.s);
          const w = c.w;
          const cap = 10 * c.s;
          return (
            <g key={i} strokeOpacity={c.op} strokeWidth={Math.max(0.6, c.s)}>
              <line x1={c.x} y1={t} x2={c.x} y2={b} />
              <line x1={c.x + w} y1={t} x2={c.x + w} y2={b} />
              <line x1={c.x + w * 0.35} y1={t + cap} x2={c.x + w * 0.35} y2={b - cap} strokeOpacity={c.op * 0.5} />
              <line x1={c.x + w * 0.7} y1={t + cap} x2={c.x + w * 0.7} y2={b - cap} strokeOpacity={c.op * 0.35} />
              <line x1={c.x - cap} y1={t} x2={c.x + w + cap} y2={t} />
              <line x1={c.x - cap * 0.6} y1={t + cap} x2={c.x + w + cap * 0.6} y2={t + cap} />
              <line x1={c.x - cap} y1={b} x2={c.x + w + cap} y2={b} />
              <line x1={c.x - cap * 0.6} y1={b - cap} x2={c.x + w + cap * 0.6} y2={b - cap} />
            </g>
          );
        })}
        <line x1={last.x + last.w} y1={topY(last.s)} x2={vpX} y2={horizon} strokeOpacity="0.1" />
      </g>

      {/* slow light sweep, 20s */}
      <rect className="sweep" x="0" y="0" width={W * 0.4} height={H} fill={`url(#${gid})`} />
      <rect x="0" y={H * 0.55} width={W} height={H * 0.45} fill={`url(#${fid})`} />
    </svg>
  );
}
