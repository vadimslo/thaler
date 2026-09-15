"use client";
import { usePathname } from "next/navigation";

/** Remounts on every route so the CSS enter animation (fade, rise 8px, 240ms) replays. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <div key={path} className="page-enter">{children}</div>;
}
