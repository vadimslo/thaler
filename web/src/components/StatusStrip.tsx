"use client";
import { epochClock, useBlock, useParams, usePolicy } from "@/hooks/useProtocol";
import { useNow } from "@/hooks/useNow";
import { deployed } from "@/lib/deployments";
import { fmtBps, fmtClock, fmtInt, fmtUtcTime, NA } from "@/lib/format";

function Item({ k, v, tone }: { k?: string; v: React.ReactNode; tone?: string }) {
  return (
    <span className="strip-item">
      {k && <span>{k}</span>}
      <b style={tone ? { color: tone } : undefined}>{v}</b>
    </span>
  );
}

/** 32px terminal line under the header: chain, block, clock, epoch, policy, taxes, liveness. */
export function StatusStrip() {
  const now = useNow();
  const { block, isError: blockError } = useBlock();
  const p = useParams();
  const s = usePolicy();
  const { epoch, toNext } = epochClock(p, s.currentEpoch, now);
  const mult = s.multiplier === undefined ? NA : (Number(s.multiplier) / 10_000).toFixed(2) + "×";
  const regime = s.regime === undefined ? NA : s.regime === 1 ? "Contraction" : "Expansion";
  const regimeTone = s.regime === 1 ? "var(--color-bad)" : "var(--color-good)";
  const stale = deployed && s.isError;
  const live = deployed && !s.isError && s.multiplier !== undefined;

  return (
    <div className="strip" aria-label="Network status">
      <div className="strip-inner px-1 sm:px-2">
        <Item v="Sepolia" />
        <Item k="Block" v={blockError ? "unreachable" : block === undefined ? NA : fmtInt(block)} />
        <Item v={`${fmtUtcTime(now || undefined)} UTC`} />
        {deployed ? (
          <>
            <Item k="Epoch" v={fmtInt(epoch)} />
            <Item v={`${fmtClock(toNext)} to next`} />
            <Item k="Mult" v={mult} />
            <Item v={regime} tone={s.regime === undefined ? undefined : regimeTone} />
            <Item k="Buy tax" v={fmtBps(s.buyTaxBps, 1)} />
            <Item k="Sell tax" v={fmtBps(s.sellTaxBps, 1)} />
            <span className="strip-item">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "pulse" : ""}`}
                style={{ background: stale ? "var(--color-bad)" : live ? "var(--color-good)" : "var(--color-paper-3)" }}
              />
              <b style={{ color: stale ? "var(--color-bad)" : live ? "var(--color-good)" : undefined }}>{stale ? "RPC stale" : live ? "Live" : "Syncing"}</b>
            </span>
          </>
        ) : (
          <>
            <Item v="Deployment pending" />
            <span className="strip-item">
              <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-brass" />
              <b>Waiting</b>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
