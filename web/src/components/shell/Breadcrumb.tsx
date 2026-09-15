"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { crumbs } from "./nav";

/** "Thaler / Home", "Thaler / Protocol Info / The Token". */
export function Breadcrumb({ className = "" }: { className?: string }) {
  const path = usePathname();
  const trail = crumbs(path);
  return (
    <div className={`crumb ${className}`} aria-label="Breadcrumb">
      <Link href="/app/" className="hover:text-paper">Thaler</Link>
      {trail.map((t, i) => (
        <span key={t} className="flex items-center gap-2">
          <i>/</i>
          {i === trail.length - 1 ? <b>{t}</b> : <span>{t}</span>}
        </span>
      ))}
    </div>
  );
}
