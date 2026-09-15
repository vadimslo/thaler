"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { useAccount } from "wagmi";
import { centralBankAbi, charterNFTAbi, thalerTokenAbi } from "@/abi";
import { useTx } from "@/hooks/useTx";
import { HAS_WITHDRAW_FEE, useCharterDetails, useCharterSale, useParams, usePolicy, useWallet, type CharterDetail } from "@/hooks/useProtocol";
import { useMyCharters } from "@/hooks/useMyCharters";
import { useNow } from "@/hooks/useNow";
import { deployed, deployments, etherscanTx } from "@/lib/deployments";
import { fmtBps, fmtClock, fmtDuration, fmtEth, fmtInt, fmtNum, fmtNumEth, fmtToken, n18, NA, share, shortHash } from "@/lib/format";
import { mockCharterDetails } from "@/lib/mock";
import { ActivityFeed } from "./ActivityFeed";
import { AuctionCurve } from "./AuctionCurve";
import { ConnectButton } from "./ConnectButton";
import { Count } from "./Count";
import { DeploymentPending, Muted, NumSection, Progress, TxStatus } from "./ui";

function useCanAct() {
  const { address, isConnected, chainId } = useAccount();
  const onSepolia = chainId === deployments.chainId;
  return { address, isConnected, onSepolia, canAct: isConnected && onSepolia };
}

/**
 * Banks page body: founding mint (until sold out) and a compact auction card on top, then the
 * wallet's charters with withdraw, open branch and resolve.
 */
export function BanksLive() {
  if (!deployed) {
    return (
      <div className="hairline-t pt-8">
        <DeploymentPending />
      </div>
    );
  }
  return <BanksInner />;
}

function BanksInner() {
  const p = useParams();
  const sale = useCharterSale();
  const soldOut = p.foundingSupply !== undefined && sale.foundingMinted !== undefined && sale.foundingMinted >= p.foundingSupply;
  return (
    <>
      <div className={`grid gap-px bg-line ${soldOut ? "" : "lg:grid-cols-2"}`}>
        {!soldOut && <FoundingCard />}
        <CharterAuctionCard compact />
      </div>
      <MyCharters />
    </>
  );
}

/** Event types that concern charters, for the feed shown before a wallet is connected. */
const CHARTER_EVENTS = ["FoundingMinted", "AuctionBought", "BranchOpened", "Withdrawn", "CharterResolved"];

type Resolved = { id: string; hash?: Hex };

/** "My charters": cards per charter, or the empty state with an inline connect button. */
export function MyCharters() {
  const { address, isConnected, onSepolia, canAct } = useCanAct();
  const p = useParams();
  const policy = usePolicy();
  const wallet = useWallet(address);
  const mine = useMyCharters(address);
  const ids = useMemo(() => mine.data ?? [], [mine.data]);
  const details = useCharterDetails(ids);
  const refetchMine = () => { details.refetch(); policy.refetch(); wallet.refetch(); mine.refetch(); };

  // A resolved charter leaves the wallet's list on the next scan; its card stays until dismissed.
  const [resolved, setResolved] = useState<Resolved[]>([]);
  const onResolved = useCallback((id: bigint, hash?: Hex) => setResolved((r) => (r.some((x) => x.id === id.toString()) ? r : [...r, { id: id.toString(), hash }])), []);
  const ghosts = resolved.filter((r) => !ids.some((id) => id.toString() === r.id));
  const dismiss = (id: string) => setResolved((r) => r.filter((x) => x.id !== id));

  return (
    <NumSection
      n="02"
      label="My charters"
      title={address ? "Your banks." : undefined}
      aside={address && <span className="num text-xs text-paper-3">{mine.isLoading ? "scanning logs" : `${ids.length} charter${ids.length === 1 ? "" : "s"}`}</span>}
    >
      {!isConnected && ids.length === 0 ? (
        <>
          <div className="card flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <div className="font-display text-2xl">Connect a wallet to see the banks it holds.</div>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-paper-2">Charters are soulbound to the wallet that minted them. Once connected, every charter appears here with its branches, pending issuance and the fee it would pay right now.</p>
            </div>
            <ConnectButton label="Connect wallet" className="btn-primary" size="md" />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <ActivityFeed limit={8} fetchLimit={60} types={CHARTER_EVENTS} title="Charter events · last 8" compact footer={<Link href="/app/activity/" className="link-quiet">Full ledger</Link>} />
            <SampleCharter p={p} policy={policy} wallet={wallet} />
          </div>
        </>
      ) : isConnected && !onSepolia ? (
        <Muted>Switch to Sepolia to see your charters.</Muted>
      ) : mine.isLoading ? (
        <Muted>Reading charter transfers since block {fmtInt(deployments.block)}.</Muted>
      ) : mine.isError ? (
        <Muted>Could not read charter logs from the RPC. Try again in a moment.</Muted>
      ) : ids.length === 0 && ghosts.length === 0 ? (
        <Muted>No charters in this wallet. Mint one above or buy one in the <Link href="/app/auction/" className="underline underline-offset-2 hover:text-paper">Auction House</Link>.</Muted>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {details.rows.map((row) => (
            <CharterCard key={row.id.toString()} row={row} policy={policy} p={p} wallet={wallet} canAct={canAct} polledAt={details.dataUpdatedAt} onDone={refetchMine} onResolved={onResolved} />
          ))}
          {ghosts.map((g) => (
            <ResolvedCard key={`resolved-${g.id}`} id={g.id} hash={g.hash} onDismiss={() => dismiss(g.id)} />
          ))}
        </div>
      )}
    </NumSection>
  );
}

/** Stays in the grid after a resolution until dismissed, so the receipt link does not vanish with the charter. */
function ResolvedCard({ id, hash, onDismiss }: { id: string; hash?: Hex; onDismiss: () => void }) {
  return (
    <div className="card rise p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-display text-xl">Charter <span className="num">#{id}</span></div>
        <div className="num text-xs text-paper-3">resolved</div>
      </div>
      <div className="mt-4 text-sm text-paper-2">Resolved. The charter and its branches are burned; the final withdrawal is in your wallet.</div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {hash && (
          <a href={etherscanTx(hash)} target="_blank" rel="noreferrer" className="num underline underline-offset-2 hover:text-paper" style={{ color: "var(--color-good)" }}>
            {shortHash(hash)}
          </a>
        )}
        <button className="text-paper-3 underline underline-offset-2 hover:text-paper" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

/** One charter card rendered from the mock readings, labelled as an example, for visitors without a wallet. */
function SampleCharter({ p, policy, wallet }: { p: ParamsT; policy: PolicyT; wallet: WalletT }) {
  const [loadedAt] = useState(() => Date.now());
  const row = mockCharterDetails[0];
  return (
    <div className="card rise">
      <div className="hairline-b flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
        <div className="eyebrow">Example · what a charter card shows</div>
        <div className="eyebrow">not on chain</div>
      </div>
      <div style={{ pointerEvents: "none" }}>
        <CharterCard row={row} policy={policy} p={p} wallet={wallet} canAct={false} polledAt={loadedAt} onDone={() => undefined} sample />
      </div>
    </div>
  );
}

type ParamsT = ReturnType<typeof useParams>;
type PolicyT = ReturnType<typeof usePolicy>;
type WalletT = ReturnType<typeof useWallet>;

/** Founding mint at a fixed price, up to three per wallet. */
export function FoundingCard() {
  const { address, isConnected, canAct } = useCanAct();
  const p = useParams();
  const sale = useCharterSale(address);
  const policy = usePolicy();
  const mine = useMyCharters(address);
  const onDone = () => { sale.refetch(); policy.refetch(); mine.refetch(); };
  const [qty, setQty] = useState(1);
  const tx = useTx(onDone);
  const remaining = p.foundingSupply !== undefined && sale.foundingMinted !== undefined ? p.foundingSupply - sale.foundingMinted : undefined;
  const walletLeft = p.foundingPerWallet !== undefined && sale.foundingMintedBy !== undefined ? Number(p.foundingPerWallet - sale.foundingMintedBy) : undefined;
  const known = remaining !== undefined && walletLeft !== undefined && p.foundingPrice !== undefined;
  const maxQty = known ? Math.max(0, Math.min(walletLeft, Number(remaining))) : 1;
  const soldOut = remaining !== undefined && remaining === 0n;
  const capped = known && !soldOut && walletLeft <= 0;
  const q = Math.min(qty, Math.max(1, maxQty));
  const total = p.foundingPrice !== undefined ? p.foundingPrice * BigInt(q) : undefined;

  const mint = () =>
    tx.send({
      address: deployments.charter,
      abi: charterNFTAbi,
      functionName: "mintFounding",
      args: [BigInt(q)],
      value: total!,
    });

  return (
    <div className="rise bg-ink-2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="eyebrow">Founding mint · fixed price</div>
          <div className="font-display mt-1 text-2xl">Founding charter</div>
        </div>
        <div className="eyebrow shrink-0 text-right">{p.foundingPerWallet === undefined ? NA : `${fmtInt(p.foundingPerWallet)} per wallet`}</div>
      </div>

      <div className="num mt-6 text-4xl leading-none text-paper sm:text-5xl">
        {fmtEth(p.foundingPrice)} <span className="text-base text-paper-3">ETH</span>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <span className="num text-paper">{fmtInt(sale.foundingMinted)} <span className="text-paper-3">/ {fmtInt(p.foundingSupply)} minted</span></span>
          <span className="num text-paper-3">{remaining === undefined ? NA : `${fmtInt(remaining)} left`}{walletLeft !== undefined ? ` · ${walletLeft} for you` : ""}</span>
        </div>
        <Progress value={share(sale.foundingMinted, p.foundingSupply)} />
      </div>

      <div className="mt-6 flex items-stretch gap-2">
        <div className="flex hairline">
          <button className="w-11 text-lg text-paper-2 hover:text-paper disabled:opacity-40" disabled={q <= 1} onClick={() => setQty(q - 1)} aria-label="Fewer">−</button>
          <div className="num flex w-12 items-center justify-center border-x border-line text-base">{q}</div>
          <button className="w-11 text-lg text-paper-2 hover:text-paper disabled:opacity-40" disabled={q >= maxQty} onClick={() => setQty(q + 1)} aria-label="More">+</button>
        </div>
        {!isConnected && !soldOut ? (
          <ConnectButton label="Connect to mint" className="btn-primary flex-1" size="md" />
        ) : (
          <button className="btn btn-primary flex-1" disabled={!canAct || !known || soldOut || capped || total === undefined || tx.busy} onClick={mint}>
            {tx.busy ? "Minting" : soldOut ? "Sold out" : !known ? "Mint" : capped ? "Wallet cap reached" : `Mint ${q} for ${fmtEth(total)} ETH`}
          </button>
        )}
      </div>
      <TxStatus phase={tx.phase} hash={tx.hash} error={tx.error} onReset={tx.reset} successText="Minted." />
      <div className="mt-4"><Muted>Sequential ids. Each charter registers with the central bank on mint and starts accruing immediately. ETH goes to the treasury.</Muted></div>
    </div>
  );
}

/** Daily Dutch auction for charters. `compact` drops the curve and links to the Auction House. */
export function CharterAuctionCard({ compact = false }: { compact?: boolean }) {
  const { address, isConnected, canAct } = useCanAct();
  const sale = useCharterSale(address);
  const policy = usePolicy();
  const mine = useMyCharters(address);
  const onDone = () => { sale.refetch(); policy.refetch(); mine.refetch(); };
  const tx = useTx(onDone);
  const now = useNow();
  const intoDay = now > 0 ? now % 86_400 : undefined;
  const dayEnd = intoDay === undefined ? undefined : 86_400 - intoDay;
  const none = sale.auctionRemainingToday !== undefined && sale.auctionRemainingToday === 0n;
  const floor = n18(sale.auctionFloor);
  const lastClose = n18(sale.lastAuctionClose);
  const open = floor === undefined ? undefined : 3 * (lastClose && lastClose > 0 ? lastClose : floor);

  const buy = async () => {
    // Re-read the ask right before sending; the contract refunds anything above the clearing price.
    const fresh = await sale.refetch();
    const price = (fresh.data?.[1]?.status === "success" ? (fresh.data[1].result as bigint) : undefined) ?? sale.auctionPrice;
    if (price === undefined) return;
    tx.send({ address: deployments.charter, abi: charterNFTAbi, functionName: "buyAtAuction", value: price });
  };

  return (
    <div className="rise bg-ink-2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="eyebrow">Dutch auction · resets daily</div>
          <div className="font-display mt-1 text-2xl">Auction charter</div>
        </div>
        <div className="eyebrow shrink-0 text-right">{sale.auctionRemainingToday === undefined ? NA : `${fmtInt(sale.auctionRemainingToday)} of ${fmtInt(sale.auctionPerDay)} left today`}</div>
      </div>

      <div className="num mt-5 text-4xl leading-none text-paper sm:text-5xl">
        <Count value={n18(sale.auctionPrice)} fmt={(n) => fmtNumEth(n, 5)} /> <span className="text-base text-paper-3">ETH</span>
      </div>
      <div className="num mt-2 text-xs text-paper-3">
        floor {fmtEth(sale.auctionFloor, 5)} · last close {sale.lastAuctionClose === undefined ? NA : sale.lastAuctionClose === 0n ? "none yet" : fmtEth(sale.lastAuctionClose, 5)} · day resets in {fmtClock(dayEnd)}
      </div>

      {!compact && (
        <div className="mt-4">
          {open !== undefined && floor !== undefined ? (
            <AuctionCurve open={open} floor={floor} halfLife={4 * 3600} secondsIntoDay={intoDay} price={n18(sale.auctionPrice)} />
          ) : (
            <div className="h-24" />
          )}
        </div>
      )}

      <div className="mt-4">
        {!isConnected && !none ? (
          <ConnectButton label="Connect to buy" className="btn-primary w-full" size="md" />
        ) : (
          <button className="btn btn-primary w-full" disabled={!canAct || none || sale.auctionPrice === undefined || tx.busy} onClick={buy}>
            {tx.busy ? "Buying" : none ? "None left today" : sale.auctionPrice === undefined ? "Buy one" : `Buy one at ${fmtEth(sale.auctionPrice, 5)} ETH`}
          </button>
        )}
      </div>
      <TxStatus phase={tx.phase} hash={tx.hash} error={tx.error} onReset={tx.reset} successText="Bought." />
      <div className="mt-4">
        {compact ? (
          <Muted>Opens each day at three times the last close and halves every four hours toward the floor. <Link href="/app/auction/" className="underline underline-offset-2 hover:text-paper">Today&apos;s curve in the Auction House</Link>.</Muted>
        ) : (
          <Muted>Opens each day at three times the last close and halves every four hours toward the floor. Excess ETH is refunded. Price refreshes every 10 seconds.</Muted>
        )}
      </div>
    </div>
  );
}

function Pips({ open, max = 10 }: { open: number | undefined; max?: number }) {
  return (
    <div className="flex items-center gap-1" aria-label={open === undefined ? "branches unknown" : `${open} of ${max} branches open`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className="inline-block h-2.5 w-2.5" style={{ background: open !== undefined && i < open ? "var(--color-brass)" : "transparent", border: "1px solid var(--color-line-2)" }} />
      ))}
    </div>
  );
}

/**
 * One charter: pips, pending issuance counting up, the fee right now, and withdraw / open branch /
 * resolve. `sample` renders the same card as an inert example (buttons shown, nothing wired).
 */
function CharterCard({ row, policy, p, wallet, canAct, polledAt, onDone, onResolved, sample = false }: { row: CharterDetail; policy: PolicyT; p: ParamsT; wallet: WalletT; canAct: boolean; polledAt: number; onDone: () => void; onResolved?: (id: bigint, hash?: Hex) => void; sample?: boolean }) {
  const [confirmResolve, setConfirmResolve] = useState(false);
  const withdrawTx = useTx(onDone);
  const approveTx = useTx(onDone);
  const openTx = useTx(onDone);
  const resolveTx = useTx(onDone);
  const now = useNow();

  useEffect(() => {
    if (resolveTx.phase === "success") onResolved?.(row.id, resolveTx.hash);
  }, [resolveTx.phase, resolveTx.hash, row.id, onResolved]);

  const price = policy.licensePrice;
  const maxed = p.maxBranches !== undefined && row.branches !== undefined && row.branches >= p.maxBranches;
  const noLicenses = policy.licensesRemainingToday !== undefined && policy.licensesRemainingToday === 0n;
  const needsApproval = !sample && price !== undefined && (wallet.bankAllowance ?? 0n) < price;
  const cantAfford = !sample && price !== undefined && wallet.thalerBalance !== undefined && wallet.thalerBalance < price;
  // Example buttons look live but are inert; real buttons disable until a wallet on Sepolia can act.
  const off = (cond: boolean) => (sample ? false : !canAct || cond);
  const inert = sample ? { tabIndex: -1, "aria-disabled": true as const } : {};
  const age = row.mintedAt !== undefined && now > 0 ? now - Number(row.mintedAt) : undefined;
  const busy = withdrawTx.busy || approveTx.busy || openTx.busy || resolveTx.busy;
  const gone = resolveTx.phase === "success";

  // Pending issuance ticks between polls: k branches earn k/N of issuancePerSecond.
  const pendingNow = useMemo(() => {
    const base = n18(row.pending);
    if (base === undefined) return undefined;
    const rate = n18(policy.issuancePerSecond);
    const N = policy.totalBranches;
    if (rate === undefined || N === undefined || N === 0n || row.branches === undefined || now === 0) return base;
    const dt = Math.max(0, now - polledAt / 1000);
    return base + (rate * row.branches * dt) / Number(N);
  }, [row.pending, row.branches, policy.issuancePerSecond, policy.totalBranches, now, polledAt]);
  const perDay = policy.issuancePerBranchPerDay !== undefined && row.branches !== undefined ? policy.issuancePerBranchPerDay * BigInt(row.branches) : undefined;

  const bank = { address: deployments.centralBank, abi: centralBankAbi } as const;
  const withdraw = () => withdrawTx.send({ ...bank, functionName: "withdraw", args: [row.id] });
  const approve = () => approveTx.send({ address: deployments.token, abi: thalerTokenAbi, functionName: "approve", args: [deployments.centralBank, price!] });
  const open = () => openTx.send({ ...bank, functionName: "openBranch", args: [row.id] });
  const resolve = () => { setConfirmResolve(false); resolveTx.send({ ...bank, functionName: "resolve", args: [row.id] }); };

  return (
    <div className={`${sample ? "" : "card rise"} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-display text-xl">Charter <span className="num">#{row.id.toString()}</span></div>
        <div className="num text-xs text-paper-3">{age === undefined ? "" : `held ${fmtDuration(age, { short: true })}`}</div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <Pips open={row.branches} max={p.maxBranches ?? 10} />
        <div className="num text-xs text-paper-3">{row.branches === undefined ? NA : `${row.branches} of ${p.maxBranches ?? 10} branches`}</div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <div className="eyebrow">Pending</div>
          <div className="num mt-1.5 truncate text-2xl text-paper">
            <Count value={pendingNow} fmt={(n) => fmtNum(n, 4)} duration={900} />
          </div>
          <div className="tile-sub">THALER{perDay !== undefined ? ` · ${fmtToken(perDay, 2)} per day` : ""}</div>
        </div>
        <div className="min-w-0">
          <div className="eyebrow">Withdrawal fee now</div>
          <div className="num mt-1.5 truncate text-2xl text-paper">{fmtBps(row.feeBps)}</div>
          <div className="tile-sub">{HAS_WITHDRAW_FEE ? "on every withdrawal, resolution included" : "on resolution"}{p.resolveFeeMin !== undefined ? ` · floor ${fmtBps(p.resolveFeeMin, 0)}` : ""}</div>
        </div>
      </div>

      {gone ? (
        <div className="mt-5 text-sm text-paper-3">Resolved. This charter no longer exists.</div>
      ) : (
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <div>
            <button className="btn btn-primary w-full" disabled={off(busy || !row.pending || row.pending === 0n)} onClick={withdraw} {...inert}>
              {withdrawTx.busy ? "Withdrawing" : "Withdraw"}
            </button>
            <TxStatus phase={withdrawTx.phase} hash={withdrawTx.hash} error={withdrawTx.error} onReset={withdrawTx.reset} successText="Withdrawn." />
          </div>
          <div>
            {needsApproval && !maxed && !noLicenses ? (
              <button className="btn w-full" disabled={off(busy || cantAfford || price === undefined)} onClick={approve} title={`Approve ${fmtToken(price)} THALER to the central bank`} {...inert}>
                {approveTx.busy ? "Approving" : cantAfford ? "Not enough THALER" : `Approve ${fmtToken(price, 0)}`}
              </button>
            ) : (
              <button className="btn w-full" disabled={off(busy || maxed || noLicenses || cantAfford || price === undefined)} onClick={open} {...inert}>
                {openTx.busy ? "Opening" : maxed ? "Max branches" : noLicenses ? "No licences today" : cantAfford ? "Not enough THALER" : `Open branch · ${fmtToken(price, 0)}`}
              </button>
            )}
            <TxStatus phase={approveTx.phase} hash={approveTx.hash} error={approveTx.error} onReset={approveTx.reset} successText="Approved." />
            <TxStatus phase={openTx.phase} hash={openTx.hash} error={openTx.error} onReset={openTx.reset} successText="Branch opened." />
          </div>
          <div>
            {confirmResolve ? (
              <div className="flex gap-2">
                <button className="btn btn-danger flex-1" disabled={busy} onClick={resolve}>
                  Confirm, pay {fmtBps(row.feeBps)}
                </button>
                <button className="btn" disabled={busy} onClick={() => setConfirmResolve(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn btn-danger w-full" disabled={off(busy)} onClick={() => setConfirmResolve(true)} {...inert}>
                {resolveTx.busy ? "Resolving" : "Resolve"}
              </button>
            )}
            <TxStatus phase={resolveTx.phase} hash={resolveTx.hash} error={resolveTx.error} onReset={resolveTx.reset} successText="Resolved." />
          </div>
        </div>
      )}
      {!gone && (
        <div className="mt-3 text-xs leading-relaxed text-paper-3">
          {confirmResolve
            ? <>Resolution is a final withdrawal at the {fmtBps(row.feeBps)} fee, then the charter and its branches are burned. Licences are not refunded. This cannot be undone.</>
            : needsApproval && !maxed && !noLicenses
              ? <>Opening a branch costs {fmtToken(price, 2)} THALER at the current licence price, burned in full. Approve first, then open.</>
              : HAS_WITHDRAW_FEE
                ? <>Withdrawing mints pending issuance minus the fee; half of the fee is never minted, half goes to the other branches. The fee decays quadratically from {fmtBps(p.resolveFeeMax, 0)} at mint to {fmtBps(p.resolveFeeMin, 0)} after {p.resolveFeePeriod === undefined ? NA : `${Number(p.resolveFeePeriod) / 86_400} days`}.</>
                : <>The fee decays quadratically from {fmtBps(p.resolveFeeMax, 0)} at mint to {fmtBps(p.resolveFeeMin, 0)} after {p.resolveFeePeriod === undefined ? NA : `${Number(p.resolveFeePeriod) / 86_400} days`}.</>}
        </div>
      )}
    </div>
  );
}
