"use client";
import { useParams, usePolicy, useTreasury } from "@/hooks/useProtocol";
import { usePool } from "@/hooks/usePool";
import { fmtBps, fmtEth, fmtInt, fmtNum, fmtNumCompact, fmtNumInt, fmtToken, n18, NA } from "@/lib/format";
import { priceThalerPerEth } from "@/lib/pool";
import { Count } from "./Count";
import { SupplyBar } from "./Dashboard";
import { Live, Tile } from "./ui";
import { HAS_WITHDRAW_FEE } from "@/lib/abiFlags";

export function TokenSupply() {
  return (
    <Live>
      <div className="card rise p-4 sm:p-5">
        <SupplyBar />
      </div>
      <SupplyTiles />
    </Live>
  );
}

function SupplyTiles() {
  const p = useParams();
  const s = usePolicy();
  const pool = usePool();
  const price = pool.slot0 ? priceThalerPerEth(pool.slot0.sqrtPriceX96) : undefined;
  const budgetShare = p.issuanceBudget && s.totalIssued !== undefined ? Number(s.totalIssued) / Number(p.issuanceBudget) : undefined;
  return (
    <div className="mt-4 grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
      <Tile label="Total supply" value={<Count value={n18(s.totalSupply)} fmt={(n) => fmtNumCompact(n, 2)} />} sub={s.totalSupply === undefined ? NA : `${fmtToken(s.totalSupply, 0)} of ${fmtToken(p.cap, 0)}`} />
      <Tile label="Issued to banks" value={<Count value={n18(s.totalIssued)} fmt={(n) => fmtNumCompact(n, 2)} />} sub={budgetShare === undefined ? NA : `${(budgetShare * 100).toFixed(2)}% of the 900M budget`} bar={budgetShare} />
      <Tile label="Pool price" value={price === undefined ? NA : fmtNumCompact(price, 2)} unit="THALER / ETH" sub={price === undefined ? NA : `${fmtNumInt(price)} per ETH · ${fmtEth(pool.reserves?.eth, 4)} ETH in the pool`} />
      <Tile label="Taxed, all time" value={<Count value={n18(s.totalTaxed)} fmt={(n) => fmtNum(n, 4)} />} unit="ETH" sub={`buy ${fmtBps(s.buyTaxBps, 1)} · sell ${fmtBps(s.sellTaxBps, 1)} right now`} />
    </div>
  );
}

/** Three burn sources with whatever counter the chain exposes for each. */
export function BurnRows() {
  const p = useParams();
  const s = usePolicy();
  const t = useTreasury();
  const soldToday = p.licensesPerDay !== undefined && s.licensesRemainingToday !== undefined ? p.licensesPerDay - s.licensesRemainingToday : undefined;
  const rows = [
    {
      k: "Licences",
      body: "Every branch a banker opens is paid in THALER at auction, and every unit paid is burned in the same transaction.",
      v: <Count value={n18(s.licensePrice)} fmt={(n) => fmtNum(n, 2)} />,
      unit: "THALER per licence now",
      sub: soldToday === undefined ? NA : `${fmtInt(soldToday)} of ${fmtInt(p.licensesPerDay)} sold today`,
    },
    {
      k: "Buybacks",
      body: "In contraction, the treasury spends ETH on the pool every hour and burns everything it buys.",
      v: <Count value={n18(t.totalBoughtBack)} fmt={(n) => fmtNum(n, 2)} />,
      unit: "THALER burned, all time",
      sub: t.totalEthSpentOnBuybacks === undefined ? NA : `for ${fmtEth(t.totalEthSpentOnBuybacks, 4)} ETH · next ${fmtEth(t.nextBuybackAmount, 4)} ETH`,
    },
    {
      k: HAS_WITHDRAW_FEE ? "Withdrawal fees" : "Resolution",
      body: HAS_WITHDRAW_FEE
        ? "Every withdrawal, resolution included, pays a fee on the issuance it settles. Half is never minted; half goes to the other branches."
        : "A charter that exits pays a fee on its pending issuance. Half is never minted; half goes to the banks that remain.",
      v: p.resolveFeeMax === undefined ? NA : `${fmtBps(p.resolveFeeMax, 0)} to ${fmtBps(p.resolveFeeMin, 0)}`,
      unit: "fee, quadratic",
      sub: p.resolveFeePeriod === undefined ? NA : `over ${Number(p.resolveFeePeriod) / 86_400} days from mint`,
    },
  ];
  return (
    <Live compact>
      <div className="card rise divide-y divide-line">
        {rows.map((r) => (
          <div key={r.k} className="grid gap-3 p-4 sm:grid-cols-[110px_1fr_auto] sm:items-center sm:gap-6 sm:p-5">
            <div className="text-sm text-paper">{r.k}</div>
            <p className="text-sm leading-relaxed text-paper-2">{r.body}</p>
            <div className="min-w-0 sm:w-56 sm:text-right">
              <div className="num truncate text-xl text-paper">{r.v}</div>
              <div className="tile-sub">{r.unit}</div>
              <div className="tile-sub">{r.sub}</div>
            </div>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 p-4 sm:p-5">
          <div className="eyebrow">Burned, all sources</div>
          <div className="num text-base text-paper"><Count value={n18(s.totalBurned)} fmt={(n) => fmtNum(n, 2)} /> <span className="text-xs text-paper-3">THALER</span></div>
        </div>
      </div>
    </Live>
  );
}
