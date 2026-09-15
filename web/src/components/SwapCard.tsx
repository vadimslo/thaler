"use client";
import { useMemo, useState } from "react";
import { parseEther, parseUnits } from "viem";
import { useAccount, useBalance } from "wagmi";
import { thalerRouterAbi, thalerTokenAbi } from "@/abi";
import { useTx } from "@/hooks/useTx";
import { useParams, usePolicy, useWallet } from "@/hooks/useProtocol";
import { usePool } from "@/hooks/usePool";
import { deployed, deployments } from "@/lib/deployments";
import { fmtBps, fmtEth, fmtNumEth, fmtNumInt, fmtToken, n18, NA } from "@/lib/format";
import { priceThalerPerEth, quoteBuy, quoteSell } from "@/lib/pool";
import { POLL_MS } from "@/lib/wagmi";
import { Count } from "./Count";
import { DeploymentPending, Muted, TxStatus } from "./ui";

type Mode = "buy" | "sell";

export function SwapCard() {
  const [mode, setMode] = useState<Mode>("buy");
  const [amount, setAmount] = useState("");
  const { address, isConnected, chainId } = useAccount();
  const onSepolia = chainId === deployments.chainId;

  const p = useParams();
  const policy = usePolicy();
  const pool = usePool();
  const wallet = useWallet(address);
  const eth = useBalance({ address, query: { enabled: !!address, refetchInterval: POLL_MS } });

  const refetchAll = () => {
    policy.refetch();
    wallet.refetch();
    eth.refetch();
  };
  const approveTx = useTx(refetchAll);
  const swapTx = useTx(refetchAll);

  const amountIn = useMemo(() => {
    try {
      if (!amount || Number(amount) <= 0) return 0n;
      return mode === "buy" ? parseEther(amount) : parseUnits(amount, 18);
    } catch {
      return 0n;
    }
  }, [amount, mode]);

  const quote = useMemo(() => {
    if (!pool.reserves || !pool.slot0 || amountIn === 0n) return undefined;
    const lpFee = pool.slot0.lpFee;
    if (mode === "buy") return quoteBuy(amountIn, pool.reserves, policy.buyTaxBps ?? 0n, lpFee);
    return quoteSell(amountIn, pool.reserves, policy.sellTaxBps ?? 0n, lpFee);
  }, [pool.reserves, pool.slot0, amountIn, mode, policy.buyTaxBps, policy.sellTaxBps]);

  const balance = mode === "buy" ? eth.data?.value : wallet.thalerBalance;
  const insufficient = balance !== undefined && amountIn > balance;
  const needsApproval = mode === "sell" && amountIn > 0n && (wallet.routerAllowance ?? 0n) < amountIn;
  const tax = mode === "buy" ? policy.buyTaxBps : policy.sellTaxBps;
  const floor = mode === "buy" ? p.buyFloorBps : p.sellFloorBps;
  const price = pool.slot0 ? priceThalerPerEth(pool.slot0.sqrtPriceX96) : undefined;

  if (!deployed) {
    return (
      <div className="card p-5">
        <div className="font-display text-2xl">Swap</div>
        <div className="mt-4"><DeploymentPending compact /></div>
      </div>
    );
  }

  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);

  const approve = () =>
    approveTx.send({
      address: deployments.token,
      abi: thalerTokenAbi,
      functionName: "approve",
      args: [deployments.router, amountIn],
    });

  const swap = () =>
    swapTx.send({
      address: deployments.router,
      abi: thalerRouterAbi,
      functionName: "swapExactIn",
      args: [mode === "buy", amountIn, 0n, address!, deadline()],
      value: mode === "buy" ? amountIn : 0n,
    });

  const disabled = !isConnected || !onSepolia || amountIn === 0n || insufficient || approveTx.busy || swapTx.busy;
  const setMax = () => balance !== undefined && setAmount(mode === "buy" ? trimEth(balance) : trimToken(balance));

  return (
    <div className="card rise">
      <div className="grid grid-cols-2" role="tablist" aria-label="Swap direction">
        {(["buy", "sell"] as Mode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setAmount(""); swapTx.reset(); approveTx.reset(); }}
            className={`eyebrow py-3 text-center transition-colors ${mode === m ? "border-b border-brass text-brass" : "hairline-b text-paper-3 hover:text-paper"}`}
            style={{ letterSpacing: "0.18em" }}
          >
            {m === "buy" ? "Buy THALER" : "Sell THALER"}
          </button>
        ))}
      </div>

      <div className="p-5">
        <label className="block">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="eyebrow">{mode === "buy" ? "You pay" : "You sell"}</span>
            <span className="num text-xs text-paper-3">
              {balance === undefined ? (isConnected ? NA : "no wallet") : `balance ${mode === "buy" ? fmtEth(balance) : fmtToken(balance, 0)}`}
            </span>
          </div>
          <div className="relative">
            <input className="field pr-24 text-lg" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label={mode === "buy" ? "ETH amount" : "THALER amount"} />
            <div className="absolute inset-y-0 right-0 flex items-center gap-2 pr-2">
              <button className="eyebrow px-1.5 py-1 text-brass hover:text-paper disabled:opacity-40" onClick={setMax} disabled={balance === undefined} type="button">Max</button>
              <span className="eyebrow text-paper-2">{mode === "buy" ? "ETH" : "THALER"}</span>
            </div>
          </div>
        </label>

        <div className="mt-4 hairline bg-ink-3 px-3 py-2.5">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">You receive</span>
            <span className="num text-lg text-paper">
              {quote === undefined ? <span className="text-paper-3">{NA}</span> : <Count value={n18(quote)} fmt={(n) => (mode === "buy" ? fmtNumInt(n) : fmtNumEth(n, 6))} duration={300} />}
              <span className="ml-1.5 text-xs text-paper-3">{mode === "buy" ? "THALER" : "ETH"}</span>
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-1.5 text-xs text-paper-3">
          <div className="flex justify-between">
            <span>Tax right now</span>
            <span className="num text-paper">{fmtBps(tax, 1)} <span className="text-paper-3">(falls to {fmtBps(floor, 1)})</span></span>
          </div>
          <div className="flex justify-between"><span>Pool price</span><span className="num">{price === undefined ? NA : `${fmtNumInt(price)} THALER / ETH`}</span></div>
          <div className="flex justify-between"><span>Pool fee</span><span className="num">1.00%</span></div>
          <div className="flex justify-between"><span>Minimum received</span><span className="num">0 (v1)</span></div>
        </div>

        <div className="mt-5">
          {!isConnected ? (
            <button className="btn btn-primary btn-lg w-full" disabled>Connect a wallet to swap</button>
          ) : !onSepolia ? (
            <button className="btn btn-lg w-full" disabled>Switch to Sepolia</button>
          ) : needsApproval ? (
            <button className="btn btn-primary btn-lg w-full" disabled={disabled} onClick={approve}>
              {approveTx.busy ? "Approving" : `Approve ${fmtToken(amountIn, 0)} THALER`}
            </button>
          ) : (
            <button className="btn btn-primary btn-lg w-full" disabled={disabled} onClick={swap}>
              {swapTx.busy ? "Swapping" : insufficient ? "Insufficient balance" : mode === "buy" ? "Buy THALER" : "Sell THALER"}
            </button>
          )}
          {mode === "sell" && isConnected && onSepolia && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-paper-3">
              <span className={`inline-block h-1.5 w-1.5 ${needsApproval ? "bg-brass" : ""}`} style={needsApproval ? undefined : { background: "var(--color-good)" }} />
              {needsApproval ? "Step 1 of 2: approve the router, then sell." : amountIn > 0n ? "Approved. Step 2 of 2: sell." : "Approve, then sell."}
            </div>
          )}
          <TxStatus phase={approveTx.phase} hash={approveTx.hash} error={approveTx.error} onReset={approveTx.reset} successText="Approved." />
          <TxStatus phase={swapTx.phase} hash={swapTx.hash} error={swapTx.error} onReset={swapTx.reset} successText="Swapped." />
        </div>

        <div className="mt-4">
          <Muted>Exact input through ThalerRouter. The quote is a constant-product estimate on the full-range position and ignores slippage from other trades. There is no minimum-output protection in v1; deadline is 10 minutes.</Muted>
        </div>
      </div>
    </div>
  );
}

function trimEth(v: bigint): string {
  // leave a little for gas
  const keep = v > parseEther("0.002") ? v - parseEther("0.002") : 0n;
  return (Number(keep) / 1e18).toFixed(6).replace(/\.?0+$/, "");
}
function trimToken(v: bigint): string {
  return (Number(v) / 1e18).toFixed(4).replace(/\.?0+$/, "");
}
