import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Whitepaper" };

const PLACEHOLDER = `The whitepaper is being written. It will cover the currency, the charter system, the central bank's policy rule, the flow hook, the treasury, and the full parameter table for testnet and mainnet. Until then, the mechanism is summarised in Protocol Info and every live parameter is under Protocol Params.`;

function loadWhitepaper(): { md: string; found: boolean } {
  const candidates = [
    path.join(process.cwd(), "..", "docs", "whitepaper.md"),
    path.join(process.cwd(), "docs", "whitepaper.md"),
  ];
  for (const p of candidates) {
    try {
      const md = fs.readFileSync(p, "utf8");
      if (md.trim().length > 0) return { md, found: true };
    } catch {
      // try next
    }
  }
  return { md: PLACEHOLDER, found: false };
}

export default function WhitepaperPage() {
  const { md, found } = loadWhitepaper();
  // If the document starts with its own H1, let it be the page title.
  const startsWithH1 = /^\s*#\s+/.test(md);
  return (
    <>
      {!startsWithH1 && <PageHeader eyebrow="Whitepaper" title="Thaler" lede={found ? undefined : "Draft pending."} />}
      <article className="prose-thaler max-w-3xl">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
            a: ({ href, children }) => {
              const external = href && /^https?:\/\//.test(href);
              return <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{children}</a>;
            },
          }}
        >
          {md}
        </ReactMarkdown>
      </article>
    </>
  );
}
