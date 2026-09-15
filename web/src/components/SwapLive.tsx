"use client";
import { useParams, usePolicy } from "@/hooks/useProtocol";
import { usePool } from "@/hooks/usePool";
import { deployed } from "@/lib/deployments";
import { fmtBps, fmtEth, fmtNumCompact, NA } from "@/lib/format";
import { priceThalerPerEth } from "@/lib/pool";
import { Tile } from "./ui";

/** Pool price and both taxes, above the swap card. */
export function SwapTiles() {
  const p = useParams();
  const s = usePolicy();
  const pool = usePool();
  const price = pool.slot0 ? priceThalerPerEth(pool.slot0.sqrtPriceX96) : undefined;
  if (!deployed) return null;
  return (
    <div className="grid grid-cols-3 gap-px bg-line">
      <Tile label="Pool price" value={price === undefined ? NA : fmtNumCompact(price, 2)} unit="per ETH" sub={pool.reserves ? `${fmtEth(pool.reserves.eth, 4)} ETH in the pool` : NA} />
      <Tile label="Buy tax" value={fmtBps(s.buyTaxBps, 1)} tone="good" sub={p.buyFloorBps === undefined ? NA : `floor ${fmtBps(p.buyFloorBps, 0)}`} />
      <Tile label="Sell tax" value={fmtBps(s.sellTaxBps, 1)} tone="bad" sub={p.sellFloorBps === undefined ? NA : `floor ${fmtBps(p.sellFloorBps, 0)}`} />
    </div>
  );
}
