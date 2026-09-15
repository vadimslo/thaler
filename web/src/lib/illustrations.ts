"use client";
import { createContext, useContext } from "react";

export type IllustrationName = "home" | "overview" | "token" | "charters" | "auction";

/** File names (with extension) present in public/illustrations at build time, keyed by hero name. */
export type Illustrations = Partial<Record<IllustrationName, string>>;

export const IllustrationsContext = createContext<Illustrations>({});

export function useIllustration(name: IllustrationName): string | undefined {
  const map = useContext(IllustrationsContext);
  const file = map[name];
  if (!file) return undefined;
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/illustrations/${file}`;
}
