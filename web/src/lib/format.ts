import { formatUnits, formatEther } from "viem";

/** Placeholder for a reading that has not arrived. */
export const NA = "…";

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });

/** 1e18-scaled bigint -> float. */
export function n18(v: bigint | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(formatUnits(v, 18));
  return Number.isFinite(n) ? n : undefined;
}

/** Plain bigint -> float. */
export function nRaw(v: bigint | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/* Number-based formatters (used by the count-up component). */

export function fmtNum(n: number, decimals = 2): string {
  if (n !== 0 && Math.abs(n) < 10 ** -decimals) return `<${(10 ** -decimals).toFixed(decimals)}`;
  return nf(decimals, decimals).format(n);
}

export function fmtNumCompact(n: number, decimals = 2): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return nf(decimals, decimals).format(n / 1e9) + "B";
  if (abs >= 1e6) return nf(decimals, decimals).format(n / 1e6) + "M";
  if (abs >= 1e3) return nf(decimals, decimals).format(n / 1e3) + "K";
  return nf(0, decimals).format(n);
}

export function fmtNumEth(n: number, max = 4): string {
  if (n === 0) return "0";
  if (Math.abs(n) < 10 ** -max) return `<${(10 ** -max).toFixed(max)}`;
  return nf(0, max).format(n);
}

export function fmtNumInt(n: number): string {
  return nf(0, 0).format(Math.round(n));
}

/** bps as a float -> "2.50%". */
export function fmtNumBps(n: number, decimals = 2): string {
  return nf(decimals, decimals).format(n / 100) + "%";
}

/** multiplier 1e4 as a float -> "1.00x". */
export function fmtNumMult(n: number): string {
  return nf(2, 2).format(n / 10_000) + "x";
}

/* Bigint wrappers. */

/** 1e18-scaled bigint -> "12,345.67" (default 2 decimals). */
export function fmtToken(v: bigint | undefined, decimals = 2): string {
  const n = n18(v);
  return n === undefined ? NA : fmtNum(n, decimals);
}

/** Compact for headline numbers: 123.4M, 1.2B. */
export function fmtCompact(v: bigint | undefined, decimals = 2): string {
  const n = n18(v);
  return n === undefined ? NA : fmtNumCompact(n, decimals);
}

/** wei -> ETH, trims trailing zeros, max `max` decimals. */
export function fmtEth(v: bigint | undefined, max = 4): string {
  if (v === undefined) return NA;
  const n = Number(formatEther(v));
  return Number.isFinite(n) ? fmtNumEth(n, max) : NA;
}

/** bps bigint -> "2.50%". */
export function fmtBps(v: bigint | undefined, decimals = 2): string {
  if (v === undefined) return NA;
  return fmtNumBps(Number(v), decimals);
}

/** multiplier 1e4 -> "1.00x". */
export function fmtMult(v: bigint | undefined): string {
  if (v === undefined) return NA;
  return fmtNumMult(Number(v));
}

export function fmtInt(v: bigint | number | undefined): string {
  if (v === undefined) return NA;
  return fmtNumInt(Number(v));
}

/** seconds -> "2d 03h 14m 05s" or "03:14:05". */
export function fmtDuration(sec: number | bigint | undefined, opts: { short?: boolean } = {}): string {
  if (sec === undefined) return NA;
  let s = Math.max(0, Math.floor(Number(sec)));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (opts.short) {
    if (d > 0) return `${d}d ${pad(h)}h`;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

/** seconds -> "03:12:44" always (days folded into hours). */
export function fmtClock(sec: number | undefined): string {
  if (sec === undefined) return "…:…:…";
  let s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** seconds -> "03:12" (hours and minutes). */
export function fmtHm(sec: number | undefined): string {
  if (sec === undefined) return "…";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}`;
}

/** seconds as a human period: "6 hours", "3 days", "30 days". */
export function fmtPeriod(sec: bigint | number | undefined): string {
  if (sec === undefined) return NA;
  const s = Number(sec);
  if (s % 86400 === 0) return `${s / 86400} day${s / 86400 === 1 ? "" : "s"}`;
  if (s % 3600 === 0) return `${s / 3600} hour${s / 3600 === 1 ? "" : "s"}`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

export function fmtTimestamp(ts: bigint | number | undefined): string {
  if (ts === undefined) return NA;
  if (Number(ts) === 0) return "never";
  const d = new Date(Number(ts) * 1000);
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** Unix seconds -> "14:32:07" UTC. */
export function fmtUtcTime(ts: number | undefined): string {
  if (ts === undefined) return "…";
  return new Date(ts * 1000).toISOString().slice(11, 19);
}

/** Unix seconds -> "09-15 14:32" UTC, for feed rows. */
export function fmtUtcShort(ts: number | undefined): string {
  if (ts === undefined) return NA;
  const iso = new Date(ts * 1000).toISOString();
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

export function shortAddr(a?: string, n = 4): string {
  if (!a) return NA;
  return `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
}

export function shortHash(h?: string): string {
  if (!h) return NA;
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

/** Percentage of a over b, "12.3%". */
export function fmtShare(a: bigint | undefined, b: bigint | undefined, decimals = 1): string {
  if (a === undefined || b === undefined || b === 0n) return NA;
  return nf(decimals, decimals).format((Number(a) / Number(b)) * 100) + "%";
}

/** Share as a 0..1 float, clamped. */
export function share(a: bigint | undefined, b: bigint | undefined): number {
  if (a === undefined || b === undefined || b === 0n) return 0;
  const r = Number(a) / Number(b);
  return Math.max(0, Math.min(1, r));
}

export function errorMessage(e: unknown): string {
  if (!e) return "";
  const any = e as { shortMessage?: string; message?: string; details?: string };
  const msg = any.shortMessage || any.message || String(e);
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}
