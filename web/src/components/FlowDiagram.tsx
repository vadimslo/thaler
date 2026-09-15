type Node = { id: string; x: number; y: number; w: number; h: number; title: string; sub?: string; accent?: boolean; align?: "center" | "left" };
type Edge = { d: string; label?: string; lx?: number; ly?: number; anchor?: "start" | "middle" | "end"; cold?: boolean; head?: boolean };

function Box({ n }: { n: Node }) {
  const cx = n.align === "left" ? n.x + 12 : n.x + n.w / 2;
  const anchor = n.align === "left" ? "start" : "middle";
  const hasSub = !!n.sub;
  return (
    <g>
      <rect x={n.x + 0.5} y={n.y + 0.5} width={n.w - 1} height={n.h - 1} className={`flow-node ${n.accent ? "flow-node-accent" : ""}`} />
      <text x={cx} y={n.y + (hasSub ? n.h / 2 - 5 : n.h / 2 + 4)} textAnchor={anchor} className="flow-title">{n.title}</text>
      {n.sub && <text x={cx} y={n.y + n.h / 2 + 11} textAnchor={anchor} className="flow-sub">{n.sub}</text>}
    </g>
  );
}

function Arrow({ e }: { e: Edge }) {
  return (
    <g>
      <path d={e.d} className="flow-base" markerEnd={e.head === false ? undefined : "url(#flow-arrow)"} />
      <path d={e.d} className={`flow-dash ${e.cold ? "flow-dash-cold" : ""}`} />
      {e.label && <text x={e.lx} y={e.ly} textAnchor={e.anchor ?? "start"} className="flow-label">{e.label}</text>}
    </g>
  );
}

function Svg({ w, h, nodes, edges, className, title }: { w: number; h: number; nodes: Node[]; edges: Edge[]; className?: string; title: string }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title} className={`h-auto w-full max-w-full ${className ?? ""}`}>
      <defs>
        <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0.5 L7.5,4 L0,7.5 Z" className="flow-head" />
        </marker>
      </defs>
      {edges.map((e, i) => <Arrow key={i} e={e} />)}
      {nodes.map((n) => <Box key={n.id} n={n} />)}
    </svg>
  );
}

const TITLE = "ETH buys and sells pass through the canonical pool; the hook taxes them and reports flow to the central bank, which sets the regime for the treasury and mints THALER to bankers.";

/* Desktop: 960 x 520 */
const D_NODES: Node[] = [
  { id: "buys", x: 200, y: 12, w: 170, h: 44, title: "ETH buys" },
  { id: "sells", x: 590, y: 12, w: 170, h: 44, title: "ETH sells" },
  { id: "pool", x: 120, y: 108, w: 720, h: 68, title: "Canonical pool · ETH / THALER · Uniswap v4", sub: "FlowHook: tax on ETH in and ETH out, flow recorded per epoch", accent: true },
  { id: "treasury", x: 120, y: 256, w: 300, h: 68, title: "Treasury", sub: "unallocated ETH, split 70 / 15 / 15 on every tick" },
  { id: "bank", x: 540, y: 256, w: 300, h: 68, title: "Central bank", sub: "epoch clock, multiplier, regime, branch accumulator", accent: true },
  { id: "exp", x: 16, y: 420, w: 152, h: 68, title: "Expansion vault", sub: "reserves" },
  { id: "con", x: 184, y: 420, w: 152, h: 68, title: "Contraction vault", sub: "buyback and burn" },
  { id: "pol", x: 352, y: 420, w: 152, h: 68, title: "POL vault", sub: "full range, only grows" },
  { id: "team", x: 520, y: 420, w: 120, h: 68, title: "Team", sub: "15%" },
  { id: "bankers", x: 680, y: 420, w: 264, h: 68, title: "Bankers", sub: "charters, 1 to 10 branches each" },
];
const D_EDGES: Edge[] = [
  { d: "M285,56 V107" },
  { d: "M675,56 V107", cold: true },
  { d: "M270,176 V255", label: "tax, in ETH", lx: 280, ly: 220 },
  { d: "M690,176 V255", label: "flow signal", lx: 700, ly: 220 },
  { d: "M539,290 H421", label: "regime", lx: 480, ly: 282, anchor: "middle" },
  { d: "M200,324 V372 H92 V419", label: "70% active", lx: 108, ly: 366 },
  { d: "M260,324 V419", cold: true },
  { d: "M330,324 V372 H428 V419", label: "15%", lx: 400, ly: 366 },
  { d: "M360,324 V352 H580 V419", label: "15%", lx: 560, ly: 346, anchor: "end" },
  { d: "M760,324 V419", label: "mints THALER", lx: 770, ly: 376 },
  { d: "M712,420 V325", label: "licenses, burned", lx: 702, ly: 376, anchor: "end", cold: true },
];

/* Mobile: 360 x 608 */
const M_NODES: Node[] = [
  { id: "buys", x: 16, y: 12, w: 156, h: 40, title: "ETH buys" },
  { id: "sells", x: 188, y: 12, w: 156, h: 40, title: "ETH sells" },
  { id: "pool", x: 16, y: 100, w: 328, h: 68, title: "Canonical pool · ETH / THALER", sub: "FlowHook: tax in and out, flow per epoch", accent: true },
  { id: "treasury", x: 16, y: 228, w: 144, h: 64, title: "Treasury", sub: "split 70 / 15 / 15" },
  { id: "bank", x: 200, y: 228, w: 144, h: 64, title: "Central bank", sub: "clock, multiplier", accent: true },
  { id: "bankers", x: 200, y: 352, w: 144, h: 64, title: "Bankers", sub: "1 to 10 branches" },
  { id: "exp", x: 40, y: 352, w: 120, h: 48, title: "Expansion", sub: "reserves" },
  { id: "con", x: 40, y: 416, w: 120, h: 48, title: "Contraction", sub: "buyback, burn" },
  { id: "pol", x: 40, y: 480, w: 120, h: 48, title: "POL", sub: "only grows" },
  { id: "team", x: 40, y: 544, w: 120, h: 48, title: "Team" },
];
const M_EDGES: Edge[] = [
  { d: "M94,52 V99" },
  { d: "M266,52 V99", cold: true },
  { d: "M88,168 V227", label: "tax, in ETH", lx: 96, ly: 202 },
  { d: "M272,168 V227", label: "flow signal", lx: 280, ly: 202, anchor: "start" },
  { d: "M199,266 H161", label: "regime", lx: 180, ly: 256, anchor: "middle" },
  { d: "M60,292 V320 H24 V568", head: false },
  { d: "M24,376 H39", label: "70% active", lx: 30, ly: 336 },
  { d: "M24,440 H39", cold: true },
  { d: "M24,504 H39", label: "15%", lx: 30, ly: 472 },
  { d: "M24,568 H39", label: "15%", lx: 30, ly: 536 },
  { d: "M316,292 V351", label: "mints THALER", lx: 310, ly: 316, anchor: "end" },
  { d: "M224,352 V293", label: "licenses, burned", lx: 218, ly: 340, anchor: "end", cold: true },
];

/** The mechanism as one picture. Desktop and mobile layouts share nodes, text and animation. */
export function FlowDiagram() {
  return (
    <div className="rise">
      <Svg w={960} h={508} nodes={D_NODES} edges={D_EDGES} className="hidden sm:block" title={TITLE} />
      <Svg w={360} h={608} nodes={M_NODES} edges={M_EDGES} className="sm:hidden" title={TITLE} />
    </div>
  );
}
