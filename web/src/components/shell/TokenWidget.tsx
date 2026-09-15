"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { deployed, deployments, etherscanAddress } from "@/lib/deployments";
import { shortAddr } from "@/lib/format";
import { Icon } from "./Icons";

/** "$THALER TOKEN 0xf13c…F34c" with copy and Etherscan, and a link to the token page. */
export function TokenWidget() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(deployments.token);
      setCopied(true);
    } catch {
      // clipboard unavailable: the address is selectable on the token page
    }
  };

  return (
    <div className="card p-3">
      <div className="eyebrow">$THALER token</div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {deployed ? (
          <span className="num text-sm text-paper" title={deployments.token}>{shortAddr(deployments.token)}</span>
        ) : (
          <span className="text-sm text-paper-3">Deployment pending</span>
        )}
        {deployed && (
          <div className="flex items-center">
            <button type="button" className="icon-btn" onClick={copy} aria-label="Copy token address" title="Copy address">
              <Icon name={copied ? "check" : "copy"} size={14} />
            </button>
            <a className="icon-btn" href={etherscanAddress(deployments.token)} target="_blank" rel="noreferrer" aria-label="Token on Etherscan" title="Etherscan">
              <Icon name="external" size={14} />
            </a>
          </div>
        )}
      </div>
      <Link href="/app/protocol/token/" className="link-quiet mt-2 block text-xs">Token info and parameters</Link>
    </div>
  );
}
