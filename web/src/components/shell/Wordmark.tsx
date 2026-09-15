import Link from "next/link";
import { Glyph } from "./Icons";

/** Glyph and name. `compact` keeps only the glyph under 640px, where the top bar also carries the page name. */
export function Wordmark({ onClick, compact = false }: { onClick?: () => void; compact?: boolean }) {
  return (
    <Link href="/app/" className="flex items-center gap-2.5 text-paper" onClick={onClick} aria-label="Thaler, home">
      <Glyph size={22} />
      <span className={`font-display text-base tracking-[0.22em] ${compact ? "hidden sm:inline" : ""}`}>THALER</span>
    </Link>
  );
}
