"use client";
import { useEffect, useRef, useState } from "react";
import { NA } from "@/lib/format";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * A number that counts from its previous value to the new one when it changes. First render is
 * immediate; `undefined` renders the placeholder. Formatting is left to the caller.
 */
export function Count({ value, fmt, className, duration = 600 }: { value: number | undefined; fmt: (n: number) => string; className?: string; duration?: number }) {
  const [shown, setShown] = useState<number | undefined>(value);
  const target = useRef<number | undefined>(value);
  const current = useRef<number | undefined>(value);

  useEffect(() => {
    const from = current.current;
    target.current = value;
    if (value === undefined || from === undefined || from === value || reduced()) {
      current.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      // The first frame's timestamp can precede t0 by a frame; clamp so the value never overshoots.
      const k = Math.max(0, Math.min(1, (t - t0) / duration));
      const e = 1 - Math.pow(1 - k, 3);
      const v = from + (value - from) * e;
      current.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={className}>{shown === undefined ? NA : fmt(shown)}</span>;
}
