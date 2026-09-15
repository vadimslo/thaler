"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ActivityFeed } from "@/components/ActivityFeed";
import { deployed } from "@/lib/deployments";
import { Icon } from "./Icons";

/** Floating "Live ledger" button; opens a right-hand drawer with the newest events. */
export function LedgerButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button type="button" className="fab" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label="Live ledger">
        <span className={`fab-dot inline-block h-1.5 w-1.5 rounded-full ${deployed ? "pulse" : ""}`} style={{ background: deployed ? "var(--color-good)" : "var(--color-paper-3)" }} />
        <Icon name="activity" size={16} className="fab-icon" />
        <span className="fab-label">Live ledger</span>
      </button>
      {open &&
        createPortal(
          <>
            <div className="drawer-backdrop" onClick={() => setOpen(false)} />
            <aside className="drawer drawer-right" role="dialog" aria-modal="true" aria-label="Live ledger">
              <div className="hairline-b flex items-center justify-between px-5 py-4">
                <div>
                  <div className="eyebrow">Live ledger</div>
                  <div className="font-display mt-0.5 text-xl">Newest events</div>
                </div>
                <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><Icon name="close" /></button>
              </div>
              <div className="p-4">
                <ActivityFeed limit={12} title="Last 12 events" compact />
                <Link href="/app/activity/" className="btn mt-4 w-full" onClick={() => setOpen(false)}>
                  Full ledger <Icon name="arrow" size={12} />
                </Link>
              </div>
            </aside>
          </>,
          document.body,
        )}
    </>
  );
}
