"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ConnectButton } from "./ConnectButton";
import { StatusStrip } from "./StatusStrip";

const NAV = [
  { href: "/token/", label: "Token" },
  { href: "/charters/", label: "Charters" },
  { href: "/protocol/", label: "Protocol" },
  { href: "/contracts/", label: "Contracts" },
  { href: "/whitepaper/", label: "Whitepaper" },
  { href: "/updates/", label: "Updates" },
];

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => path === href || path === href.replace(/\/$/, "");

  return (
    <header className="sticky top-0 z-20 bg-ink">
      <div className="hairline-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="font-display text-lg tracking-[0.22em] text-paper" onClick={() => setOpen(false)}>
          THALER
        </Link>
        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`text-sm transition-colors hover:text-paper ${isActive(n.href) ? "text-paper" : "text-paper-2"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ConnectButton />
          <button className="btn btn-sm md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu">
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      </div>
      <StatusStrip />
      {open && (
        <nav className="hairline-b md:hidden" aria-label="Primary mobile">
          <ul className="mx-auto max-w-6xl px-4 py-2">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} onClick={() => setOpen(false)} className={`block py-3 text-base ${isActive(n.href) ? "text-paper" : "text-paper-2"}`}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
