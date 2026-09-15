"use client";
import Link from "next/link";
import { HeroCard, Readout } from "./HeroCard";
import { AuctionCurve } from "./AuctionCurve";
import { Count } from "./Count";
import { Icon } from "./shell/Icons";
import { DeploymentPending, Muted } from "./ui";
import { useCharterSale, useParams, usePolicy } from "@/hooks/useProtocol";
import { useNow } from "@/hooks/useNow";
import { deployed } from "@/lib/deployments";
import { fmtClock, fmtInt, fmtNum, fmtNumCompact, fmtNumEth, fmtToken, n18, NA } from "@/lib/format";

/** Auction House hero with the two live prices. */
export function AuctionHero() {
  const s = usePolicy();
  const sale = useCharterSale();
  const now = useNow();
  const dayEnd = now > 0 ? 86_400 - (now % 86_400) : undefined;
  return (
    <HeroCard
      image="auction"
      shade="light"
      short
      eyebrow={<>Auction House · day resets in {fmtClock(dayEnd)}</>}
      title="Two auctions, every day."
      aside={
        deployed ? (
          <>
            <Readout label="Charter" value={<><Count value={n18(sale.auctionPrice)} fmt={(n) => fmtNumEth(n, 5)} /> <span className="text-sm text-paper-3">ETH</span></>} sub={sale.auctionRemainingToday === undefined ? NA : `${fmtInt(sale.auctionRemainingToday)} of ${fmtInt(sale.auctionPerDay)} left today`} />
            <Readout label="Licence" value={<><Count value={n18(s.licensePrice)} fmt={(n) => (n >= 100_000 ? fmtNumCompact(n, 2) : fmtNum(n, 2))} /> <span className="text-sm text-paper-3">THALER</span></>} sub={s.licensesRemainingToday === undefined ? NA : `${fmtInt(s.licensesRemainingToday)} left today`} />
          </>
        ) : undefined
      }
    />
  );
}

/**
 * Expansion licence auction: the price of opening one more branch, paid in THALER and burned.
 * Opens at twice the last close and halves every four hours toward a floor of two days of one
 * branch's issuance (at least 1 THALER). Buying happens from a charter on the Banks page.
 */
export function LicenseAuctionCard() {
  const p = useParams();
  const s = usePolicy();
  const now = useNow();
  const intoDay = now > 0 ? now % 86_400 : undefined;
  const dayEnd = intoDay === undefined ? undefined : 86_400 - intoDay;
  const perBranchDay = n18(s.issuancePerBranchPerDay);
  const floor = perBranchDay === undefined ? undefined : Math.max(1, 2 * perBranchDay);
  const lastClose = n18(s.lastLicenseClose);
  const open = floor === undefined ? undefined : 2 * (lastClose && lastClose > 0 ? lastClose : floor);
  const none = s.licensesRemainingToday !== undefined && s.licensesRemainingToday === 0n;

  if (!deployed) return <DeploymentPending />;
  return (
    <div className="rise bg-ink-2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="eyebrow">Dutch auction · paid in THALER</div>
          <div className="font-display mt-1 text-2xl">Expansion licence</div>
        </div>
        <div className="eyebrow shrink-0 text-right">{s.licensesRemainingToday === undefined ? NA : `${fmtInt(s.licensesRemainingToday)} of ${fmtInt(p.licensesPerDay)} left today`}</div>
      </div>

      <div className="num mt-5 text-4xl leading-none text-paper sm:text-5xl">
        <Count value={n18(s.licensePrice)} fmt={(n) => fmtNum(n, 2)} /> <span className="text-base text-paper-3">THALER</span>
      </div>
      <div className="num mt-2 text-xs text-paper-3">
        floor {floor === undefined ? NA : fmtNum(floor, 2)} · last close {s.lastLicenseClose === undefined ? NA : s.lastLicenseClose === 0n ? "none yet" : fmtToken(s.lastLicenseClose, 2)} · day resets in {fmtClock(dayEnd)}
      </div>

      <div className="mt-4">
        {open !== undefined && floor !== undefined ? (
          <AuctionCurve open={open} floor={floor} halfLife={4 * 3600} secondsIntoDay={intoDay} price={n18(s.licensePrice)} />
        ) : (
          <div className="h-24" />
        )}
      </div>

      <div className="mt-4">
        <Link href="/app/banks/" className={`btn w-full ${none ? "" : "btn-primary"}`} aria-disabled={none}>
          {none ? "None left today" : "Open a branch"} <Icon name="arrow" size={12} />
        </Link>
      </div>
      <div className="mt-4"><Muted>A licence adds one branch to a charter you hold, up to {p.maxBranches ?? 10}. The THALER you pay is burned in full. Branches are opened from the charter card on the Banks page.</Muted></div>
    </div>
  );
}
