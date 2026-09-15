import fs from "node:fs";
import path from "node:path";
import { AppShell } from "@/components/shell/AppShell";
import type { IllustrationName, Illustrations } from "@/lib/illustrations";

const NAMES: IllustrationName[] = ["home", "overview", "token", "charters", "auction"];

/** Hero illustrations present in public/illustrations at build time; missing ones fall back to the engraving. */
function illustrations(): Illustrations {
  const dir = path.join(process.cwd(), "public", "illustrations");
  const out: Illustrations = {};
  for (const n of NAMES) {
    for (const ext of ["jpg", "jpeg", "png", "webp"]) {
      const f = `${n}.${ext}`;
      try {
        if (fs.statSync(path.join(dir, f)).size > 0) {
          out[n] = f;
          break;
        }
      } catch {
        // not present
      }
    }
  }
  return out;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell illustrations={illustrations()}>{children}</AppShell>;
}
