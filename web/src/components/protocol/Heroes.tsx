"use client";
import { AuctionCurve } from "@/components/AuctionCurve";
import { HeroCard, Readout } from "@/components/HeroCard";
import { Count } from "@/components/Count";
import { epochClock, useCharterSale, useParams, usePolicy } from "@/hooks/useProtocol";
import { useNow } from "@/hooks/useNow";
import { deployed } from "@/lib/deployments";
import { fmtHm, fmtInt, fmtNum, fmtNumCompact, fmtNumEth, fmtNumInt, n18, nRaw, NA } from "@/lib/format";

/** Protocol Info overview: the story hero with SUPPLY and EPOCH readouts. */
export function OverviewHero() {
  const p = useParams();
  const s = usePolicy();
  const now = useNow();
  const { epoch, toNext } = epochClock(p, s.currentEpoch, now);
  return (
    <HeroCard
      image="overview"
      position="50% 62%"
      stackAside
      eyebrow="Protocol Info · Ethereum Sepolia · testnet · no value"
      title={<>One currency.<br />A central bank behind it.</>}
      sub="Thaler is a monetary system written as contracts. The currency has a fixed cap. The bank behind it watches ETH flow through one pool and tightens or loosens issuance in response. No committee, no discretion."
      aside={
        deployed ? (
          <>
            <Readout label="Supply" value={<Count value={n18(s.totalSupply)} fmt={(n) => fmtNumCompact(n, 1)} />} sub="THALER circulating · cap 1.0B" />
            <Readout label="Epoch" value={fmtInt(epoch)} sub={toNext === undefined ? NA : `${fmtHm(toNext)} to next · ${s.regime === undefined ? NA : s.regime === 1 ? "contraction" : "expansion"}`} />
          </>
        ) : undefined
      }
    />
  );
}

export function TokenHero() {
  const s = usePolicy();
  return (
    <HeroCard
      image="token"
      eyebrow="Protocol Info · The Token · ERC-20 on Sepolia"
      title="The currency."
      sub="Hard cap of one billion. One hundred million minted at genesis and paired with ETH as protocol-owned liquidity; the remaining nine hundred million is an issuance budget that only the central bank can spend, and only through chartered banks."
      aside={
        deployed ? (
          <>
            <Readout label="Supply" value={<Count value={n18(s.totalSupply)} fmt={(n) => fmtNumCompact(n, 2)} />} sub="THALER circulating" />
            <Readout label="Burned" value={<Count value={n18(s.totalBurned)} fmt={(n) => (n >= 10_000 ? fmtNumCompact(n, 2) : fmtNum(n, 2))} />} sub="THALER, all time" />
          </>
        ) : undefined
      }
    />
  );
}

export function ChartersHero({ withdrawFee }: { withdrawFee: boolean }) {
  const s = usePolicy();
  const sale = useCharterSale();
  return (
    <HeroCard
      image="charters"
      eyebrow="Protocol Info · Charters and Auctions · ERC-721 · soulbound"
      title="A charter is a licence to issue."
      sub={`Each charter starts with one branch and accrues a share of the daily issuance, split evenly across every branch in the system. Open more branches by buying licences at auction, paid in THALER and burned. ${withdrawFee ? "Withdraw whenever you like: a fee on the issuance you settle decays from 60% at mint to 2% after thirty days." : "Exit whenever you like: a fee on pending issuance decays from 60% to 2% over thirty days."}`}
      aside={
        deployed ? (
          <>
            <Readout label="Chartered" value={<Count value={nRaw(sale.totalMinted)} fmt={fmtNumInt} />} sub={sale.foundingMinted === undefined ? NA : `${fmtInt(sale.foundingMinted)} founding`} />
            <Readout label="Branches" value={<Count value={nRaw(s.totalBranches)} fmt={fmtNumInt} />} sub={s.issuancePerBranchPerDay === undefined ? NA : `${fmtNumInt(n18(s.issuancePerBranchPerDay) ?? 0)} THALER per branch per day`} />
          </>
        ) : undefined
      }
    />
  );
}

/** Charter auction curve without the buy button, for the explanatory page. */
export function CharterCurve() {
  const sale = useCharterSale();
  const now = useNow();
  const intoDay = now > 0 ? now % 86_400 : undefined;
  const floor = n18(sale.auctionFloor);
  const lastClose = n18(sale.lastAuctionClose);
  const open = floor === undefined ? undefined : 3 * (lastClose && lastClose > 0 ? lastClose : floor);
  return (
    <div className="card rise p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="eyebrow">Charter auction · today</div>
        <div className="num text-sm text-paper">
          <Count value={n18(sale.auctionPrice)} fmt={(n) => fmtNumEth(n, 5)} /> <span className="text-xs text-paper-3">ETH now · {sale.auctionRemainingToday === undefined ? NA : `${fmtInt(sale.auctionRemainingToday)} of ${fmtInt(sale.auctionPerDay)} left`}</span>
        </div>
      </div>
      <div className="mt-3">
        {open !== undefined && floor !== undefined ? (
          <AuctionCurve open={open} floor={floor} halfLife={4 * 3600} secondsIntoDay={intoDay} price={n18(sale.auctionPrice)} />
        ) : (
          <div className="h-24" />
        )}
      </div>
    </div>
  );
}

