"use client";
import { useAccount } from "wagmi";
import { centralBankAbi, treasuryAbi } from "@/abi";
import { useTx } from "@/hooks/useTx";
import { epochClock, useCharterSale, useParams, usePolicy, useTreasury } from "@/hooks/useProtocol";
import { useNow } from "@/hooks/useNow";
import { deployed, deployments } from "@/lib/deployments";
import { fmtBps, fmtClock, fmtDuration, fmtEth, fmtInt, fmtMult, fmtNum, fmtNumEth, fmtNumInt, fmtPeriod, fmtTimestamp, fmtToken, n18, nRaw, NA } from "@/lib/format";
import { ActivityFeed } from "./ActivityFeed";
import { Count } from "./Count";
import { TreasurySplit } from "./Dashboard";
import { DeploymentPending, Muted, NumSection, Tile, TxStatus } from "./ui";

export function ProtocolLive() {
  if (!deployed) {
    return (
      <>
        <div className="hairline-t pt-8">
          <DeploymentPending />
        </div>
        <ParamTable />
      </>
    );
  }
  return <Inner />;
}

function Inner() {
  const { isConnected, chainId } = useAccount();
  const canAct = isConnected && chainId === deployments.chainId;
  const p = useParams();
  const s = usePolicy();
  const t = useTreasury();
  const sale = useCharterSale();
  const now = useNow();

  const rollTx = useTx(() => { s.refetch(); t.refetch(); });
  const tickTx = useTx(() => { t.refetch(); s.refetch(); });

  const { epoch, toNext } = epochClock(p, s.currentEpoch, now);
  const unrolled = s.currentEpoch !== undefined && s.lastRolledEpoch !== undefined ? s.currentEpoch - 1n - s.lastRolledEpoch : undefined;
  const tickIn = t.lastTick !== undefined && p.tickInterval !== undefined && now > 0 ? Number(t.lastTick + p.tickInterval) - now : undefined;
  const regime = s.regime === undefined ? NA : s.regime === 1 ? "Contraction" : "Expansion";
  const dayEnd = now > 0 ? 86_400 - (now % 86_400) : undefined;
  const issuedShare = p.issuanceBudget && s.totalIssued !== undefined ? Number(s.totalIssued) / Number(p.issuanceBudget) : undefined;
  const multShare = s.multiplier !== undefined && p.multMin !== undefined && p.multMax !== undefined && p.multMax > p.multMin ? Number(s.multiplier - p.multMin) / Number(p.multMax - p.multMin) : undefined;

  return (
    <>
      <NumSection n="01" label="Policy" title="What the bank is doing." className="pt-0 sm:pt-0 border-t-0">
        <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-3 lg:grid-cols-4">
          <Tile label="Multiplier" value={<Count value={nRaw(s.multiplier)} fmt={(n) => (n / 10_000).toFixed(2)} />} unit="x" sub={p.multMin !== undefined ? `${fmtMult(p.multMin)} to ${fmtMult(p.multMax)} · cut 0.15 · raise 0.10` : NA} bar={multShare} size="lg" />
          <Tile label="Regime" value={regime} tone={s.regime === undefined ? undefined : s.regime === 1 ? "bad" : "good"} sub={s.consecutivePositive !== undefined ? `${fmtInt(s.consecutivePositive)} consecutive positive epoch${s.consecutivePositive === 1n ? "" : "s"}` : NA} size="lg" />
          <Tile label="Epoch" value={fmtInt(epoch)} sub={toNext === undefined ? NA : `${fmtClock(toNext)} to next · ${fmtPeriod(p.epoch)} each`} bar={toNext !== undefined && p.epoch ? 1 - toNext / Number(p.epoch) : undefined} size="lg" />
          <Tile label="Issuance per branch" value={<Count value={n18(s.issuancePerBranchPerDay)} fmt={(n) => (n >= 10_000 ? fmtNumInt(n) : fmtNum(n, 2))} />} unit="THALER / day" sub={s.issuancePerSecond !== undefined ? `${fmtToken(s.issuancePerSecond * 86_400n, 0)} per day in total` : NA} size="lg" />
          <Tile label="Total branches" value={<Count value={nRaw(s.totalBranches)} fmt={fmtNumInt} />} sub={p.maxBranches !== undefined ? `max ${p.maxBranches} per charter` : NA} />
          <Tile label="Issued" value={<Count value={n18(s.totalIssued)} fmt={fmtNumInt} />} sub={issuedShare === undefined ? NA : `${(issuedShare * 100).toFixed(3)}% of 900,000,000`} bar={issuedShare} />
          <Tile label="Licence price" value={<Count value={n18(s.licensePrice)} fmt={(n) => fmtNum(n, 2)} />} unit="THALER" sub={s.licensesRemainingToday === undefined ? NA : `${fmtInt(s.licensesRemainingToday)} of ${fmtInt(p.licensesPerDay)} left today`} />
          <Tile label="Charter auction" value={<Count value={n18(sale.auctionPrice)} fmt={(n) => fmtNumEth(n, 5)} />} unit="ETH" sub={sale.auctionRemainingToday === undefined ? NA : `${fmtInt(sale.auctionRemainingToday)} of ${fmtInt(sale.auctionPerDay)} left today · resets in ${fmtClock(dayEnd)}`} />
        </div>
      </NumSection>

      <NumSection n="02" label="Treasury" title="Where the ETH sits.">
        <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-3 lg:grid-cols-4">
          <Tile label="Unallocated" value={<Count value={n18(t.unallocated)} fmt={(n) => fmtNumEth(n, 5)} />} unit="ETH" sub="split on the next tick" />
          <Tile label="Expansion vault" value={<Count value={n18(t.expansionVault)} fmt={(n) => fmtNumEth(n, 5)} />} unit="ETH" sub="reserves" />
          <Tile label="Contraction vault" value={<Count value={n18(t.contractionVault)} fmt={(n) => fmtNumEth(n, 5)} />} unit="ETH" sub="buys back and burns" />
          <Tile label="POL vault" value={<Count value={n18(t.polVault)} fmt={(n) => fmtNumEth(n, 5)} />} unit="ETH" sub={p.polMinCompound !== undefined ? `compounds at ${fmtEth(p.polMinCompound)} ETH` : NA} />
          <Tile label="Team vault" value={<Count value={n18(t.teamVault)} fmt={(n) => fmtNumEth(n, 5)} />} unit="ETH" sub="claimable by the team" />
          <Tile label="POL liquidity" value={t.polLiquidity === undefined ? NA : Number(t.polLiquidity).toExponential(2).replace("e+", "e")} unit="units" sub={t.poolEthReserve !== undefined ? `full range · ${fmtEth(t.poolEthReserve, 4)} ETH in the pool` : NA} />
          <Tile label="Next buyback" value={<Count value={n18(t.nextBuybackAmount)} fmt={(n) => fmtNumEth(n, 5)} />} unit="ETH" sub={p.buybackVaultBps !== undefined ? `min of ${fmtBps(p.buybackVaultBps, 0)} of vault, ${fmtBps(p.buybackReserveBps, 1)} of reserve` : NA} />
          <Tile label="Last tick" value={t.lastTick === undefined ? NA : t.lastTick === 0n ? "never" : fmtDuration(Math.max(0, now - Number(t.lastTick)), { short: true })} unit={t.lastTick && t.lastTick > 0n ? "ago" : undefined} sub={tickIn === undefined ? NA : tickIn <= 0 ? "buyback ready" : `next buyback in ${fmtClock(tickIn)}`} />
        </div>
        <div className="mt-4">
          <TreasurySplit />
        </div>
      </NumSection>

      <NumSection n="03" label="Permissionless actions" title="Anyone can turn the clock.">
        <div className="grid gap-px bg-line md:grid-cols-2">
          <div className="rise bg-ink-2 p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-4">
              <div className="font-display text-xl">Roll epochs</div>
              <div className="num text-xs text-paper-3">{unrolled === undefined ? NA : unrolled > 0n ? `${fmtInt(unrolled)} completed, not yet rolled` : "up to date"}</div>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-paper-2">Books every completed epoch: the hook reports ETH in and out, the bank adjusts the multiplier and regime. Every write to the bank rolls first, so this matters only when the system is quiet.</p>
            <button className={`btn mt-4 w-full ${unrolled && unrolled > 0n ? "btn-primary" : ""}`} disabled={!canAct || rollTx.busy} onClick={() => rollTx.send({ address: deployments.centralBank, abi: centralBankAbi, functionName: "rollEpochs" })}>
              {rollTx.busy ? "Rolling" : !isConnected ? "Connect to roll" : "Roll epochs"}
            </button>
            <TxStatus phase={rollTx.phase} hash={rollTx.hash} error={rollTx.error} onReset={rollTx.reset} successText="Rolled." />
          </div>
          <div className="rise bg-ink-2 p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-4">
              <div className="font-display text-xl">Tick treasury</div>
              <div className="num text-xs text-paper-3">{tickIn === undefined ? NA : tickIn <= 0 ? "buyback ready" : `buyback in ${fmtClock(tickIn)}`}</div>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-paper-2">Allocates whatever landed since the last split, runs a buyback if the interval has passed and the contraction vault has ETH, then compounds POL when its vault crosses the threshold. You pay the gas.</p>
            <button className={`btn mt-4 w-full ${tickIn !== undefined && tickIn <= 0 ? "btn-primary" : ""}`} disabled={!canAct || tickTx.busy} onClick={() => tickTx.send({ address: deployments.treasury, abi: treasuryAbi, functionName: "tick" })}>
              {tickTx.busy ? "Ticking" : !isConnected ? "Connect to tick" : "Tick treasury"}
            </button>
            <TxStatus phase={tickTx.phase} hash={tickTx.hash} error={tickTx.error} onReset={tickTx.reset} successText="Ticked." />
          </div>
        </div>
      </NumSection>

      <NumSection n="04" label="Activity" title="What just happened.">
        <ActivityFeed />
      </NumSection>

      <NumSection n="05" label="Flow" title="Through the pool.">
        <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
          <Tile label="Buy tax now" value={fmtBps(s.buyTaxBps, 2)} sub={p.launchTaxBps !== undefined ? `${fmtBps(p.launchTaxBps, 0)} at launch, floor ${fmtBps(p.buyFloorBps, 0)}` : NA} />
          <Tile label="Sell tax now" value={fmtBps(s.sellTaxBps, 2)} sub={p.sellFloorBps !== undefined ? `floor ${fmtBps(p.sellFloorBps, 0)} · half-life ${fmtPeriod(p.taxHalfLife)}` : NA} />
          <Tile label="ETH in, all time" value={<Count value={n18(s.totalEthIn)} fmt={(n) => fmtNumEth(n, 4)} />} unit="ETH" sub={s.totalEthOut !== undefined ? `${fmtEth(s.totalEthOut, 4)} ETH out` : NA} />
          <Tile label="Taxed, all time" value={<Count value={n18(s.totalTaxed)} fmt={(n) => fmtNumEth(n, 4)} />} unit="ETH" sub={s.poolBound === undefined ? NA : s.poolBound ? `pool bound · launched ${fmtTimestamp(p.launchedAt)}` : "pool not bound"} />
        </div>
      </NumSection>

      <ParamTable />
    </>
  );
}

type ParamRow = { k: string; chain?: string; config: string; mainnet: string };

/**
 * Every parameter from the whitepaper. The testnet column reads the chain constant where the
 * interface exposes one and falls back to the documented value otherwise; the mainnet column is the document.
 */
function ParamTable() {
  const p = useParams();
  const sale = useCharterSale();
  const bpsOrNA = (v?: bigint, d = 0) => (v === undefined ? undefined : fmtBps(v, d));
  const rows: ParamRow[] = [
    { k: "Epoch length", chain: p.epoch === undefined ? undefined : fmtPeriod(p.epoch), config: "6 hours", mainnet: "3 days" },
    { k: "Base issuance per day at 1.00x", chain: p.baseIssuancePerDay === undefined ? undefined : `${fmtToken(p.baseIssuancePerDay, 0)} THALER`, config: "700,000 THALER", mainnet: "700,000 THALER" },
    { k: "Issuance budget", chain: p.issuanceBudget === undefined ? undefined : `${fmtToken(p.issuanceBudget, 0)} THALER`, config: "900,000,000 THALER", mainnet: "900,000,000 THALER" },
    { k: "Genesis allocation to POL", chain: p.cap !== undefined && p.issuanceBudget !== undefined ? `${fmtToken(p.cap - p.issuanceBudget, 0)} THALER` : undefined, config: "100,000,000 THALER", mainnet: "100,000,000 THALER" },
    { k: "Hard cap", chain: p.cap === undefined ? undefined : `${fmtToken(p.cap, 0)} THALER`, config: "1,000,000,000 THALER", mainnet: "1,000,000,000 THALER" },
    { k: "Multiplier at start", config: "1.00x", mainnet: "1.00x" },
    { k: "Multiplier minimum", chain: p.multMin === undefined ? undefined : fmtMult(p.multMin), config: "0.20x", mainnet: "0.20x" },
    { k: "Multiplier maximum", chain: p.multMax === undefined ? undefined : fmtMult(p.multMax), config: "1.25x", mainnet: "1.25x" },
    { k: "Multiplier cut", chain: p.multCut === undefined ? undefined : (Number(p.multCut) / 10_000).toFixed(2), config: "0.15", mainnet: "0.15" },
    { k: "Multiplier raise", chain: p.multRaise === undefined ? undefined : (Number(p.multRaise) / 10_000).toFixed(2), config: "0.10", mainnet: "0.10" },
    { k: "Branches per charter, maximum", chain: p.maxBranches === undefined ? undefined : String(p.maxBranches), config: "10", mainnet: "10" },
    { k: "Licenses per day", chain: p.licensesPerDay === undefined ? undefined : fmtInt(p.licensesPerDay), config: "100", mainnet: "100" },
    { k: "License opening price", config: "2x last close", mainnet: "2x last close" },
    { k: "License half-life", config: "4 hours", mainnet: "4 hours" },
    { k: "License floor", config: "2 days of one branch, min 1 THALER", mainnet: "2 days of one branch, min 1 THALER" },
    { k: "Resolution fee minimum", chain: bpsOrNA(p.resolveFeeMin), config: "2%", mainnet: "2%" },
    { k: "Resolution fee maximum", chain: bpsOrNA(p.resolveFeeMax), config: "60%", mainnet: "60%" },
    { k: "Resolution fee period", chain: p.resolveFeePeriod === undefined ? undefined : fmtPeriod(p.resolveFeePeriod), config: "30 days", mainnet: "365 days" },
    { k: "Founding charter supply", chain: p.foundingSupply === undefined ? undefined : fmtInt(p.foundingSupply), config: "1,000", mainnet: "1,000" },
    { k: "Founding charter price", chain: p.foundingPrice === undefined ? undefined : `${fmtEth(p.foundingPrice)} ETH`, config: "0.001 ETH", mainnet: "0.15 ETH" },
    { k: "Founding charters per wallet", chain: p.foundingPerWallet === undefined ? undefined : fmtInt(p.foundingPerWallet), config: "3", mainnet: "3" },
    { k: "Charter auction per day", chain: sale.auctionPerDay === undefined ? undefined : fmtInt(sale.auctionPerDay), config: "10", mainnet: "owner policy" },
    { k: "Charter auction floor", chain: sale.auctionFloor === undefined ? undefined : `${fmtEth(sale.auctionFloor, 5)} ETH`, config: "0.001 ETH", mainnet: "owner policy, set before launch" },
    { k: "Charter auction opening price", config: "3x last close", mainnet: "3x last close" },
    { k: "Charter auction half-life", config: "4 hours", mainnet: "4 hours" },
    { k: "Pool fee", config: "1% (tier 10,000)", mainnet: "1% (tier 10,000)" },
    { k: "Pool tick spacing", config: "200", mainnet: "200" },
    { k: "Tax at launch, buy and sell", chain: bpsOrNA(p.launchTaxBps), config: "90%", mainnet: "90%" },
    { k: "Buy tax floor", chain: bpsOrNA(p.buyFloorBps), config: "2%", mainnet: "2%" },
    { k: "Sell tax floor", chain: bpsOrNA(p.sellFloorBps), config: "3%", mainnet: "3%" },
    { k: "Tax half-life", chain: p.taxHalfLife === undefined ? undefined : fmtPeriod(p.taxHalfLife), config: "6 hours", mainnet: "3 days" },
    { k: "Treasury split, active / POL / team", chain: p.activeBps !== undefined ? `${fmtBps(p.activeBps, 0)} / ${fmtBps(p.polBps, 0)} / ${fmtBps(p.teamBps, 0)}` : undefined, config: "70% / 15% / 15%", mainnet: "70% / 15% / 15%" },
    { k: "Buyback cap per tick, share of contraction vault", chain: bpsOrNA(p.buybackVaultBps), config: "10%", mainnet: "10%" },
    { k: "Buyback cap per tick, share of pool ETH reserve", chain: bpsOrNA(p.buybackReserveBps, 1), config: "0.2%", mainnet: "0.2%" },
    { k: "Buyback tick interval", chain: p.tickInterval === undefined ? undefined : fmtPeriod(p.tickInterval), config: "1 hour", mainnet: "1 hour" },
    { k: "POL minimum compound", chain: p.polMinCompound === undefined ? undefined : `${fmtEth(p.polMinCompound)} ETH`, config: "0.0005 ETH", mainnet: "0.1 ETH" },
  ];
  const fromChain = rows.filter((r) => r.chain !== undefined).length;
  return (
    <NumSection n={deployed ? "06" : "01"} label="Parameters" title="Every constant." aside={<span className="num text-xs text-paper-3">{deployed ? `${fromChain} of ${rows.length} read from the chain` : "documented values"}</span>}>
      <div className="card overflow-x-auto">
        <table className="feed" style={{ fontFamily: "var(--font-sans)", fontSize: "0.8125rem" }}>
          <thead>
            <tr>
              <th>Parameter</th>
              <th className="text-right">Testnet (Sepolia)</th>
              <th className="text-right">Mainnet</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <td className="text-paper-2">{r.k}</td>
                <td className="num whitespace-nowrap text-right text-paper">
                  {r.chain ?? r.config}
                  {deployed && r.chain === undefined && <span className="ml-1.5 text-[10px] text-paper-3">doc</span>}
                </td>
                <td className="num whitespace-nowrap text-right text-paper-2">{r.mainnet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3"><Muted>Values marked doc are not exposed by the interface and come from the whitepaper. All others are read from the deployed contracts.</Muted></div>
    </NumSection>
  );
}
