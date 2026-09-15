"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useAccount } from "wagmi";
import { HeroCard } from "@/components/HeroCard";
import { Count } from "@/components/Count";
import { ConnectButton } from "@/components/ConnectButton";
import { Icon } from "@/components/shell/Icons";
import { DeploymentPending, Tile } from "@/components/ui";
import { epochClock, useCharterDetails, useCharterSale, useParams, usePolicy, useWallet } from "@/hooks/useProtocol";
import { useMyCharters } from "@/hooks/useMyCharters";
import { useNow } from "@/hooks/useNow";
import { useResolvedCount } from "@/hooks/useResolvedCount";
import { deployed, deployments } from "@/lib/deployments";
import { fmtClock, fmtEth, fmtInt, fmtNum, fmtNumCompact, fmtNumEth, fmtNumInt, fmtToken, n18, nRaw, NA } from "@/lib/format";

const INIT_BRANCHES = 10n;

function asOf(now: number): string {
  if (!now) return NA;
  const d = new Date(now * 1000);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  return `${date}, ${d.toISOString().slice(11, 16)} UTC`;
}

/** State of the economy: initializing below ten branches, then expanding or contracting by regime. */
function useEconomyState() {
  const s = usePolicy();
  if (!deployed) return { word: "pending", title: "Deployment pending." };
  if (s.totalBranches === undefined || s.regime === undefined) return { word: undefined, title: "The system is syncing." };
  if (s.totalBranches < INIT_BRANCHES) return { word: "initializing", title: "The system is initializing." };
  return s.regime === 1 ? { word: "contracting", title: "The system is contracting." } : { word: "expanding", title: "The system is expanding." };
}

export function HomeHero() {
  const p = useParams();
  const s = usePolicy();
  const now = useNow();
  const { epoch } = epochClock(p, s.currentEpoch, now);
  const state = useEconomyState();
  const epochLabel = epoch === undefined ? "…" : String(epoch).padStart(4, "0");
  return (
    <HeroCard
      image="home"
      eyebrow={<>State of the economy · Epoch {epochLabel}</>}
      title={state.title}
      sub={
        <>
          As of {asOf(now)}
          {state.word === "initializing" && s.totalBranches !== undefined && <span className="text-paper-3"> · {fmtInt(s.totalBranches)} of {fmtInt(INIT_BRANCHES)} branches before the first reading</span>}
          {(state.word === "expanding" || state.word === "contracting") && s.multiplier !== undefined && <span className="text-paper-3"> · multiplier {(Number(s.multiplier) / 10_000).toFixed(2)}x</span>}
        </>
      }
    />
  );
}

/** Brass-tinted line with the one thing worth doing right now. */
export function Notice() {
  const p = useParams();
  const sale = useCharterSale();
  if (!deployed) {
    return (
      <div className="notice rise rise-2">
        <span>Contracts are not on Sepolia yet. Live readings and actions appear once addresses are published.</span>
        <Link href="/app/protocol/contracts/">Contracts <Icon name="arrow" size={12} className="ml-1 inline" /></Link>
      </div>
    );
  }
  const left = p.foundingSupply !== undefined && sale.foundingMinted !== undefined ? p.foundingSupply - sale.foundingMinted : undefined;
  if (left === undefined) {
    return (
      <div className="notice rise rise-2">
        <span>Reading the charter sale from Sepolia.</span>
        <Link href="/app/banks/">Banks <Icon name="arrow" size={12} className="ml-1 inline" /></Link>
      </div>
    );
  }
  if (left > 0n) {
    return (
      <div className="notice rise rise-2">
        <span>Founding charters are open: <b className="num text-paper">{fmtInt(left)}</b> of {fmtInt(p.foundingSupply)} remain at {fmtEth(p.foundingPrice)} ETH, up to {fmtInt(p.foundingPerWallet)} per wallet.</span>
        <Link href="/app/banks/">Mint a charter <Icon name="arrow" size={12} className="ml-1 inline" /></Link>
      </div>
    );
  }
  return (
    <div className="notice rise rise-2">
      <span>Founding charters are sold out. Charters now sell only at the daily Dutch auction: <b className="num text-paper">{fmtInt(sale.auctionRemainingToday)}</b> of {fmtInt(sale.auctionPerDay)} left today.</span>
      <Link href="/app/auction/">Auction House <Icon name="arrow" size={12} className="ml-1 inline" /></Link>
    </div>
  );
}

/** Active banks, open branches, multiplier, burned forever. */
export function HomeTiles() {
  const s = usePolicy();
  const sale = useCharterSale();
  const resolved = useResolvedCount();
  if (!deployed) return <DeploymentPending />;
  const active = sale.totalMinted !== undefined && resolved.data !== undefined ? Number(sale.totalMinted) - resolved.data : sale.totalMinted !== undefined && resolved.isError ? Number(sale.totalMinted) : undefined;
  return (
    <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
      <Tile label="Active banks" value={<Count value={active} fmt={fmtNumInt} />} sub={sale.totalMinted === undefined ? NA : resolved.data === undefined ? (resolved.isError ? "resolutions unread" : "counting resolutions") : `${fmtInt(sale.totalMinted)} chartered · ${fmtNumInt(resolved.data)} resolved`} size="lg" className="rise-2" />
      <Tile label="Open branches" value={<Count value={nRaw(s.totalBranches)} fmt={fmtNumInt} />} sub={s.issuancePerBranchPerDay === undefined ? NA : `${fmtToken(s.issuancePerBranchPerDay, 0)} THALER per branch per day`} size="lg" className="rise-2" />
      <Tile label="Issuance multiplier" value={<Count value={nRaw(s.multiplier)} fmt={(n) => (n / 10_000).toFixed(2)} />} unit="x" tone={s.regime === undefined ? undefined : s.regime === 1 ? "bad" : "good"} sub={s.regime === undefined ? NA : s.regime === 1 ? "contraction · cut 0.15 per epoch of outflow" : "expansion · raise 0.10 per two epochs of inflow"} size="lg" className="rise-3" />
      <Tile label="Burned forever" value={<Count value={n18(s.totalBurned)} fmt={(n) => (n >= 10_000 ? fmtNumCompact(n, 2) : fmtNum(n, 2))} />} unit="THALER" sub={s.totalSupply === undefined ? NA : `${fmtNumCompact(n18(s.totalSupply) ?? 0, 2)} circulating`} size="lg" className="rise-3" />
    </div>
  );
}

/** "Get started" until a wallet is connected, then "Your position". */
export function PositionCard() {
  const { address, isConnected, chainId } = useAccount();
  const onSepolia = chainId === deployments.chainId;
  const policy = usePolicy();
  const p = useParams();
  const sale = useCharterSale();
  const wallet = useWallet(address);
  const mine = useMyCharters(address);
  const ids = useMemo(() => mine.data ?? [], [mine.data]);
  const details = useCharterDetails(ids);
  const now = useNow();

  const branches = details.rows.every((r) => r.branches !== undefined) && ids.length > 0 ? details.rows.reduce((a, r) => a + (r.branches ?? 0), 0) : ids.length === 0 ? 0 : undefined;
  const pendingNow = useMemo(() => {
    if (ids.length === 0) return 0;
    if (!details.rows.every((r) => r.pending !== undefined)) return undefined;
    const base = details.rows.reduce((a, r) => a + (n18(r.pending) ?? 0), 0);
    const rate = n18(policy.issuancePerSecond);
    const N = policy.totalBranches;
    if (rate === undefined || N === undefined || N === 0n || branches === undefined || now === 0) return base;
    const dt = Math.max(0, now - details.dataUpdatedAt / 1000);
    return base + (rate * branches * dt) / Number(N);
  }, [ids.length, details.rows, details.dataUpdatedAt, policy.issuancePerSecond, policy.totalBranches, branches, now]);

  if (!isConnected || !address) {
    const left = p.foundingSupply !== undefined && sale.foundingMinted !== undefined ? p.foundingSupply - sale.foundingMinted : undefined;
    return (
      <div className="card rise rise-3 flex flex-col p-5 sm:p-6">
        <div className="eyebrow">Get started</div>
        <div className="font-display mt-1 text-2xl">Connect your wallet.</div>
        <p className="mt-3 max-w-md flex-1 text-sm leading-relaxed text-paper-2">Mint a founding charter, open branches, withdraw issuance as it accrues, or buy THALER on the pool. Sepolia testnet only; nothing here has value.</p>
        {deployed && (
          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 hairline-t pt-4">
            <span className="eyebrow">Founding charter</span>
            <span className="num text-sm text-paper">
              {fmtEth(p.foundingPrice)} ETH
              <span className="text-paper-3"> · {left === undefined ? NA : `${fmtInt(left)} of ${fmtInt(p.foundingSupply)} left`} · {p.foundingPerWallet === undefined ? NA : `${fmtInt(p.foundingPerWallet)} per wallet`}</span>
            </span>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ConnectButton label="Connect wallet" className="btn-primary" size="md" />
          <Link href="/app/protocol/" className="link-quiet text-sm">How it works <Icon name="arrow" size={12} className="ml-1 inline" /></Link>
        </div>
      </div>
    );
  }
  return (
    <div className="card rise rise-3 flex flex-col p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="eyebrow">Your position</div>
          <div className="font-display mt-1 text-2xl">{!onSepolia ? "Switch to Sepolia." : mine.isLoading ? "Reading your charters." : ids.length === 0 ? "No banks yet." : `${ids.length} bank${ids.length === 1 ? "" : "s"}.`}</div>
        </div>
        <Link href="/app/banks/" className="link-quiet shrink-0 text-sm">Banks <Icon name="arrow" size={12} className="ml-1 inline" /></Link>
      </div>
      <div className="mt-5 grid flex-1 grid-cols-2 gap-x-4 gap-y-4">
        <Mini label="Charters" value={mine.isLoading ? NA : fmtNumInt(ids.length)} />
        <Mini label="Branches" value={branches === undefined ? NA : fmtNumInt(branches)} />
        <Mini label="Pending" value={<Count value={pendingNow} fmt={(n) => fmtNum(n, 4)} duration={900} />} unit="THALER" />
        <Mini label="Balance" value={<Count value={n18(wallet.thalerBalance)} fmt={(n) => (n >= 10_000 ? fmtNumCompact(n, 2) : fmtNum(n, 2))} />} unit="THALER" />
      </div>
    </div>
  );
}

function Mini({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className="num mt-1 truncate text-xl text-paper">{value}{unit && <span className="ml-1.5 text-xs text-paper-3">{unit}</span>}</div>
    </div>
  );
}

/** Today's auctions at a glance: charter price and count, licence price and count, day countdown. */
export function AuctionHouseCard() {
  const p = useParams();
  const s = usePolicy();
  const sale = useCharterSale();
  const now = useNow();
  const dayEnd = now > 0 ? 86_400 - (now % 86_400) : undefined;
  return (
    <Link href="/app/auction/" className="card rise rise-4 group flex flex-col p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="eyebrow">Auction House</div>
          <div className="font-display mt-1 text-2xl transition-colors group-hover:text-brass">Check today&apos;s auctions.</div>
        </div>
        <span className="num shrink-0 text-xs text-paper-3">resets in {fmtClock(dayEnd)}</span>
      </div>
      <div className="mt-5 grid flex-1 grid-cols-2 gap-x-4 gap-y-4">
        <Mini label="Charter now" value={<Count value={n18(sale.auctionPrice)} fmt={(n) => fmtNumEth(n, 5)} />} unit="ETH" />
        <Mini label="Charters left" value={sale.auctionRemainingToday === undefined ? NA : `${fmtInt(sale.auctionRemainingToday)} / ${fmtInt(sale.auctionPerDay)}`} />
        <Mini label="Licence now" value={<Count value={n18(s.licensePrice)} fmt={(n) => (n >= 100_000 ? fmtNumCompact(n, 2) : fmtNum(n, 2))} />} unit="THALER" />
        <Mini label="Licences left" value={s.licensesRemainingToday === undefined ? NA : `${fmtInt(s.licensesRemainingToday)} / ${fmtInt(p.licensesPerDay)}`} />
      </div>
      <div className="mt-5 text-xs text-paper-3">Both open high each day and halve every four hours toward the floor. Charters are paid in ETH, licences in THALER and burned.</div>
    </Link>
  );
}
