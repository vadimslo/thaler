"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { shortAddr, errorMessage } from "@/lib/format";
import { etherscanAddress } from "@/lib/deployments";

export function ConnectButton() {
  const { address, isConnected, chainId, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <button className="btn btn-sm" disabled>Connect</button>;
  }

  if (isConnected && address) {
    const wrong = chainId !== sepolia.id;
    return (
      <div className="relative">
        {wrong ? (
          <button className="btn btn-sm" style={{ borderColor: "var(--color-bad)", color: "var(--color-bad)" }} onClick={() => switchChain({ chainId: sepolia.id })} disabled={switching}>
            {switching ? "Switching…" : "Switch to Sepolia"}
          </button>
        ) : (
          <button className="btn btn-sm num" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-good)" }} />
            {shortAddr(address)}
          </button>
        )}
        {menu && (
          <div className="card absolute right-0 z-30 mt-2 w-56 p-2 text-sm" onMouseLeave={() => setMenu(false)}>
            <div className="px-2 py-1.5 text-xs text-paper-3">{connector?.name ?? "Wallet"}</div>
            <a className="block px-2 py-1.5 hover:text-brass" href={etherscanAddress(address)} target="_blank" rel="noreferrer">
              View on Etherscan
            </a>
            <button className="block w-full px-2 py-1.5 text-left hover:text-brass" onClick={() => { disconnect(); setMenu(false); }}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)}>Connect</button>
      {open && <ConnectModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ConnectModal({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors();
  const { connectAsync, isPending, variables } = useConnect();
  const [err, setErr] = useState("");

  // EIP-6963 discovered wallets carry an icon and a unique id; the generic "injected"
  // connector is a fallback for wallets that only expose window.ethereum.
  const list = useMemo(() => {
    const discovered = connectors.filter((c) => c.id !== "injected");
    if (discovered.length > 0) return discovered;
    const hasEthereum = typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;
    return hasEthereum ? connectors.filter((c) => c.id === "injected") : [];
  }, [connectors]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={onClose} role="dialog" aria-modal="true">
      <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-xl">Connect a wallet</h2>
          <button className="text-sm text-paper-3 hover:text-paper" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {list.length === 0 ? (
          <div className="text-sm leading-relaxed text-paper-2">
            <p>No wallet detected in this browser.</p>
            <p className="mt-2">
              Install an injected wallet such as{" "}
              <a className="text-brass underline underline-offset-2" href="https://metamask.io" target="_blank" rel="noreferrer">MetaMask</a>{" "}
              or{" "}
              <a className="text-brass underline underline-offset-2" href="https://rabby.io" target="_blank" rel="noreferrer">Rabby</a>, then reload this page. Everything here runs on Sepolia testnet.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((c) => (
              <li key={c.uid}>
                <button
                  className="btn w-full justify-start"
                  disabled={isPending}
                  onClick={async () => {
                    setErr("");
                    try {
                      await connectAsync({ connector: c });
                      onClose();
                    } catch (e) {
                      setErr(errorMessage(e));
                    }
                  }}
                >
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" className="h-5 w-5" />
                  ) : (
                    <span className="inline-block h-5 w-5 border border-line-2" />
                  )}
                  <span>{c.name}</span>
                  {isPending && variables?.connector === c && <span className="ml-auto text-xs text-paper-3">Waiting…</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {err && <p className="mt-3 text-xs" style={{ color: "var(--color-bad)" }}>{err}</p>}
        <p className="mt-4 text-xs text-paper-3">Sepolia testnet only. Nothing here has value.</p>
      </div>
    </div>,
    document.body,
  );
}
