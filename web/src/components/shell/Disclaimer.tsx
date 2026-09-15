"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Sidebar footer link that opens the disclaimer in a small dialog. */
export function Disclaimer() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="link-quiet mt-3 block px-1 text-xs" onClick={() => setOpen(true)}>Disclaimer</button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Disclaimer">
            <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-display text-xl">Disclaimer</h2>
                <button type="button" className="text-sm text-paper-3 hover:text-paper" onClick={() => setOpen(false)}>Close</button>
              </div>
              <div className="space-y-3 text-sm leading-relaxed text-paper-2">
                <p>Thaler v0.1 runs on Ethereum Sepolia, a test network. THALER, charters and every balance shown here have no monetary value.</p>
                <p>The contracts are unaudited software published for evaluation. They may contain errors and may be redeployed without notice; testnet balances do not carry over.</p>
                <p>Nothing on this site is an offer, a solicitation or financial advice. Every action costs Sepolia gas that you pay yourself.</p>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
