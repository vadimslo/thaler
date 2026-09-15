"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ConnectButton } from "@/components/ConnectButton";
import { StatusStrip } from "@/components/StatusStrip";
import { IllustrationsContext, type Illustrations } from "@/lib/illustrations";
import { Breadcrumb } from "./Breadcrumb";
import { Icon } from "./Icons";
import { crumbs } from "./nav";
import { LedgerButton } from "./LedgerButton";
import { PageTransition } from "./PageTransition";
import { Sidebar } from "./Sidebar";
import { Wordmark } from "./Wordmark";

/**
 * The application shell: status strip on top, a 280px sidebar on the left (a drawer under 1024px),
 * breadcrumb and wallet button above the content, the floating ledger button bottom-right.
 */
export function AppShell({ children, illustrations }: { children: React.ReactNode; illustrations: Illustrations }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const onActivity = path.replace(/\/+$/, "") === "/app/activity";
  // Under 1024px the top bar carries the page name instead of a breadcrumb row.
  const trail = crumbs(path);
  const pageName = (trail.length > 1 && trail[trail.length - 1] === "Overview" ? trail[0] : trail[trail.length - 1]) ?? "Home";

  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [menu]);

  return (
    <IllustrationsContext.Provider value={illustrations}>
      <div className="sticky top-0 z-30"><StatusStrip /></div>
      <aside className="sidebar hidden lg:flex">
        <Sidebar />
      </aside>
      <div className="min-w-0 lg:pl-[280px]">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="icon-btn lg:hidden" onClick={() => setMenu(true)} aria-label="Menu" aria-expanded={menu}>
              <Icon name="menu" />
            </button>
            <span className="flex min-w-0 items-center gap-2.5 lg:hidden">
              <Wordmark compact />
              <span className="crumb"><i>/</i><span className="truncate text-paper-2">{pageName}</span></span>
            </span>
            <Breadcrumb className="hidden lg:flex" />
          </div>
          <ConnectButton label="Connect wallet" />
        </header>
        <main className="content">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      {!onActivity && <LedgerButton />}
      {menu &&
        createPortal(
          <>
            <div className="drawer-backdrop" onClick={() => setMenu(false)} />
            <aside className="drawer drawer-left" role="dialog" aria-modal="true" aria-label="Navigation">
              <div className="flex justify-end px-3 pt-3">
                <button type="button" className="icon-btn" onClick={() => setMenu(false)} aria-label="Close"><Icon name="close" /></button>
              </div>
              <Sidebar onNavigate={() => setMenu(false)} />
            </aside>
          </>,
          document.body,
        )}
    </IllustrationsContext.Provider>
  );
}
