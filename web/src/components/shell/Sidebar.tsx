"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { APP_NAV, INFO_NAV, isActive, isProtocol, type NavItem } from "./nav";
import { TokenWidget } from "./TokenWidget";
import { Disclaimer } from "./Disclaimer";
import { Wordmark } from "./Wordmark";

/**
 * Two groups (App, Information), a Protocol Info sub-navigation while on /app/protocol/*,
 * the token widget and the disclaimer at the bottom. One pill slides behind the active item.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ y: number; h: number; ready: boolean } | null>(null);
  const showSub = isProtocol(path);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const a = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!a) {
        setPill(null);
        return;
      }
      const y = a.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
      setPill((prev) => ({ y, h: a.offsetHeight, ready: prev !== null }));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [path, showSub]);

  return (
    <>
      <div className="flex items-center justify-between px-5 pb-3 pt-5">
        <Wordmark />
      </div>
      <nav ref={navRef} className="relative flex-1 px-3 pb-2" aria-label="Primary">
        {pill && <span className={`nav-pill ${pill.ready ? "is-ready" : ""}`} style={{ transform: `translateY(${pill.y}px)`, height: pill.h }} aria-hidden="true" />}
        <Group label="App" items={APP_NAV} path={path} onNavigate={onNavigate} />
        <Group label="Information" items={INFO_NAV} path={path} onNavigate={onNavigate} showSub={showSub} />
      </nav>
      <div className="px-3 pb-4">
        <TokenWidget />
        <Disclaimer />
      </div>
    </>
  );
}

function Group({ label, items, path, onNavigate, showSub }: { label: string; items: NavItem[]; path: string; onNavigate?: () => void; showSub?: boolean }) {
  return (
    <div className="nav-group">
      <div className="nav-group-label">{label}</div>
      <ul>
        {items.map((it) => {
          // A parent with an open sub-navigation hands the active state to its child.
          const active = !it.external && !(it.children && showSub) && isActive(path, it.href);
          const parent = !!it.children && isProtocol(path);
          return (
            <li key={it.href}>
              {it.external ? (
                <a href={it.href} target="_blank" rel="noreferrer" className="nav-item">
                  {it.icon && <Icon name={it.icon} />}
                  <span>{it.label}</span>
                  <Icon name="external" size={12} className="ml-auto opacity-60" />
                </a>
              ) : (
                <Link href={it.href} className="nav-item" aria-current={active ? "page" : undefined} data-parent={parent ? "true" : undefined} onClick={onNavigate}>
                  {it.icon && <Icon name={it.icon} />}
                  <span>{it.label}</span>
                </Link>
              )}
              {it.children && showSub && (
                <ul className="nav-sub">
                  {it.children.map((c) => {
                    const a = isActive(path, c.href);
                    return (
                      <li key={c.href}>
                        <Link href={c.href} className="nav-item" aria-current={a ? "page" : undefined} onClick={onNavigate}>
                          <span>{c.label}</span>
                          {c.icon && <Icon name={c.icon} size={12} className="ml-auto opacity-60" />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
