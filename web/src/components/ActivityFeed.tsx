"use client";
import { useActivity, FEED_LIMIT } from "@/hooks/useActivity";
import { etherscanTx } from "@/lib/deployments";
import { fmtInt, fmtUtcShort } from "@/lib/format";

const TONE: Record<string, string | undefined> = {
  "Taxed buy": "var(--color-good)",
  "Taxed sell": "var(--color-bad)",
  Buyback: "var(--color-bad)",
  CharterResolved: "var(--color-bad)",
  EpochRolled: "var(--color-brass)",
};

/** Newest protocol events straight from the chain. Same component on the home page (8 rows) and the protocol page (20). */
export function ActivityFeed({ limit = FEED_LIMIT, title = "Activity" }: { limit?: number; title?: string }) {
  const a = useActivity(FEED_LIMIT);
  const rows = (a.data?.rows ?? []).slice(0, limit);
  const paused = a.isError;
  const scanning = a.data?.backfilling;

  return (
    <div className="card rise">
      <div className="hairline-b flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
        <div className="eyebrow">{title}</div>
        <div className="eyebrow flex items-center gap-2">
          {paused ? (
            <><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-bad)" }} />feed paused, RPC rate limited, retrying</>
          ) : scanning ? (
            <><span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-brass" />reading back to block {fmtInt(a.data?.from)}</>
          ) : a.data ? (
            <><span className="pulse inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-good)" }} />to block {fmtInt(a.data.head)}</>
          ) : (
            <><span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-brass" />reading logs</>
          )}
        </div>
      </div>
      {/* Mobile: one block per event. */}
      <ul className="sm:hidden">
        {rows.length === 0 ? (
          <li className="px-4 py-3 text-xs text-paper-3">{a.isLoading ? "Reading the first window of logs." : paused ? "No rows cached yet. The feed resumes when the RPC answers." : "No events since deployment."}</li>
        ) : (
          rows.map((r) => (
            <li key={r.id} className="hairline-b num px-4 py-2.5 text-xs last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span style={{ color: TONE[r.type] ?? "var(--color-paper)" }}>{r.type}</span>
                <span className="text-paper-3">{fmtUtcShort(r.ts)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="text-paper-2">{r.amount}</span>
                <a href={etherscanTx(r.tx)} target="_blank" rel="noreferrer" className="shrink-0 text-paper-3 underline underline-offset-2 hover:text-brass">{r.tx.slice(0, 6)}…{r.tx.slice(-4)}</a>
              </div>
            </li>
          ))
        )}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="feed">
          <thead>
            <tr>
              <th style={{ width: 96 }}>Time UTC</th>
              <th style={{ width: 130 }}>Type</th>
              <th>Amount</th>
              <th className="text-right" style={{ width: 90 }}>Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-paper-3">{a.isLoading ? "Reading the first window of logs." : paused ? "No rows cached yet. The feed resumes when the RPC answers." : "No events since deployment."}</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-paper-3">{fmtUtcShort(r.ts)}</td>
                  <td className="whitespace-nowrap" style={{ color: TONE[r.type] ?? "var(--color-paper)" }}>{r.type}</td>
                  <td className="min-w-[220px]">{r.amount}</td>
                  <td className="whitespace-nowrap text-right">
                    <a href={etherscanTx(r.tx)} target="_blank" rel="noreferrer" className="text-paper-3 underline underline-offset-2 hover:text-brass">{r.tx.slice(0, 6)}…{r.tx.slice(-4)}</a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
