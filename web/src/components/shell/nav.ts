export type IconName = "home" | "bank" | "gavel" | "swap" | "activity" | "info" | "updates" | "doc" | "external" | "copy" | "check" | "menu" | "close" | "arrow" | "pool" | "scale" | "flame" | "wallet" | "glyph";

export type NavItem = { href: string; label: string; icon?: IconName; external?: boolean; children?: NavItem[] };

export const GITHUB_URL = "https://github.com/vadimslo/thaler";

export const PROTOCOL_NAV: NavItem[] = [
  { href: "/app/protocol/", label: "Overview" },
  { href: "/app/protocol/token/", label: "The Token" },
  { href: "/app/protocol/charters/", label: "Charters and Auctions" },
  { href: "/app/protocol/params/", label: "Protocol Params" },
  { href: "/app/protocol/contracts/", label: "Contracts" },
  { href: "/app/whitepaper/", label: "Whitepaper", icon: "doc" },
];

export const APP_NAV: NavItem[] = [
  { href: "/app/", label: "Home", icon: "home" },
  { href: "/app/banks/", label: "Banks", icon: "bank" },
  { href: "/app/auction/", label: "Auction House", icon: "gavel" },
  { href: "/app/swap/", label: "Swap", icon: "swap" },
  { href: "/app/activity/", label: "Activity", icon: "activity" },
];

export const INFO_NAV: NavItem[] = [
  { href: "/app/protocol/", label: "Protocol Info", icon: "info", children: PROTOCOL_NAV },
  { href: "/app/updates/", label: "Updates", icon: "updates" },
  { href: "/app/whitepaper/", label: "Whitepaper", icon: "doc" },
  { href: GITHUB_URL, label: "GitHub", icon: "external", external: true },
];

/** "/app/banks" and "/app/banks/" compare equal. */
export const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export function isActive(path: string, href: string): boolean {
  return norm(path) === norm(href);
}

export function isProtocol(path: string): boolean {
  return norm(path).startsWith("/app/protocol");
}

/** Breadcrumb trail for a pathname: ["Home"], ["Protocol Info", "The Token"], ... */
export function crumbs(path: string): string[] {
  const p = norm(path);
  for (const it of APP_NAV) if (norm(it.href) === p) return [it.label];
  if (p.startsWith("/app/protocol")) {
    const sub = PROTOCOL_NAV.find((s) => norm(s.href) === p);
    return ["Protocol Info", sub?.label ?? "Overview"];
  }
  for (const it of INFO_NAV) if (!it.external && norm(it.href) === p) return [it.label];
  return ["Home"];
}
