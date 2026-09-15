"use client";
import { Engraving } from "./Engraving";
import { useIllustration, type IllustrationName } from "@/lib/illustrations";

const SEED: Record<IllustrationName, number> = { home: 3, overview: 7, token: 11, charters: 5, auction: 9 };

/**
 * 16:6 hero card (16:5 with `short`). Uses `public/illustrations/<image>.jpg` when it exists at build
 * time, otherwise the generative engraving. A dark gradient from the left keeps the copy readable;
 * `shade="light"` thins it for darker pictures. `position` is the image's object-position, for
 * sources whose subject does not sit at the centre of the crop; `stackAside` puts the readouts in a
 * column so they cover less of the picture.
 */
export function HeroCard({ image, eyebrow, title, sub, aside, className = "", position, shade = "default", short = false, stackAside = false }: { image: IllustrationName; eyebrow?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; aside?: React.ReactNode; className?: string; position?: string; shade?: "default" | "light"; short?: boolean; stackAside?: boolean }) {
  const src = useIllustration(image);
  return (
    <section className={`hero rise ${short ? "hero-short" : ""} ${className}`}>
      <div className="hero-art">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" style={position ? { objectPosition: position } : undefined} />
        ) : (
          <Engraving seed={SEED[image]} />
        )}
      </div>
      <div className={`hero-shade ${shade === "light" ? "hero-shade-light" : ""}`} />
      <div className="hero-body">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-3" style={{ color: "var(--color-brass)" }}>{eyebrow}</div>}
          <h1 className="hero-title">{title}</h1>
          {sub && <div className="hero-sub">{sub}</div>}
        </div>
        {aside && <div className={`hero-aside mt-5 flex shrink-0 gap-2 md:mt-0 md:gap-3 ${stackAside ? "md:flex-col" : ""}`}>{aside}</div>}
      </div>
    </section>
  );
}

/** Live readout inside a hero: label, big mono value, sub line. */
export function Readout({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="readout">
      <div className="eyebrow">{label}</div>
      <div className="readout-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}
