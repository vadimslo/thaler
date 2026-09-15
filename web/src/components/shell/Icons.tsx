import type { IconName } from "./nav";

const PATHS: Record<IconName, string> = {
  home: "M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5zM6.5 13.5v-4h3v4",
  bank: "M2 6.5h12M3.75 6.5v5.5M6.5 6.5v5.5M9.5 6.5v5.5M12.25 6.5v5.5M2 13.5h12M2.5 6.5 8 2.5l5.5 4",
  gavel: "M9 2.5l4.5 4.5-2 2L7 4.5zM2.5 13.5l5.5-5.5M9.25 4.75 6 8M11.5 7.5 8.25 10.75",
  swap: "M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13",
  activity: "M1.5 8.5h3l2-5 3 9 2-4h3",
  info: "M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 7.25v3.5M8 5v.5",
  updates: "M2.5 4h11M2.5 8h11M2.5 12h7",
  doc: "M4 2.5h5.5l3 3v8H4zM9.5 2.5v3h3M6 8.5h4M6 11h4",
  external: "M6 3H3.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V10M9.5 2.5H13.5v4M13.5 2.5 7.5 8.5",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5v-7h7",
  check: "M3 8.5l3 3 7-7",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  close: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  arrow: "M2.5 8h11M9.5 4l4 4-4 4",
  pool: "M2 6.5c2-2.5 4-2.5 6 0s4 2.5 6 0M2 10.5c2-2.5 4-2.5 6 0s4 2.5 6 0",
  scale: "M8 2.5v11M5 13.5h6M3 5h10M3 5l-1.5 4a1.75 1.75 0 0 0 3.5 0zM13 5l-1.5 4a1.75 1.75 0 0 0 3.5 0z",
  flame: "M8 2.5c1 2.5 3.5 3.5 3.5 6.5a3.5 3.5 0 0 1-7 0c0-1.5.5-2.5 1.5-3.5.5 1 1 1.5 2 1.5-.5-1.5-.5-3 0-4.5z",
  wallet: "M2.5 5.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM2.5 7.5h11M10.5 10.25h1",
  glyph: "",
};

/** 16px line glyph, 1.25 stroke, currentColor. */
export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  if (name === "glyph") return <Glyph size={size} className={className} />;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The wordmark glyph: a brass square with a T. */
export function Glyph({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect x="4.5" y="4.5" width="55" height="55" fill="none" stroke="var(--color-brass)" strokeWidth="3" />
      <path d="M18 20h28v6H36v20h-8V26H18z" fill="currentColor" />
    </svg>
  );
}
