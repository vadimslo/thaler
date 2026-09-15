import type { Metadata } from "next";
import updates from "@/content/updates.json";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Updates" };

type Update = { version: string; date: string; title?: string; body: string };

export default function UpdatesPage() {
  const list = (updates as Update[]).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <>
      <PageHeader eyebrow="Changelog" title="Updates" lede="What changed, when." />
      <ol className="hairline-t">
        {list.map((u) => (
          <li key={u.version + u.date} className="hairline-b grid gap-2 py-6 sm:grid-cols-[160px_1fr] sm:gap-8">
            <div>
              <div className="num text-sm text-paper">{u.version}</div>
              <div className="num mt-1 text-xs text-paper-3">{u.date}</div>
            </div>
            <div>
              {u.title && <div className="font-display text-xl">{u.title}</div>}
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-paper-2">{u.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
