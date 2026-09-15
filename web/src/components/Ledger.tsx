"use client";
import { useState } from "react";
import { ActivityFeed } from "./ActivityFeed";
import { Live } from "./ui";

const FILTERS: { key: string; label: string; types?: string[] }[] = [
  { key: "all", label: "All" },
  { key: "trades", label: "Trades", types: ["Taxed buy", "Taxed sell"] },
  { key: "charters", label: "Charters", types: ["FoundingMinted", "AuctionBought", "CharterResolved"] },
  { key: "branches", label: "Branches", types: ["BranchOpened", "Withdrawn"] },
  { key: "epochs", label: "Epochs", types: ["EpochRolled"] },
  { key: "treasury", label: "Treasury", types: ["Allocated", "Buyback", "PolCompounded"] },
];

/** The full ledger with a type filter. Reads 60 rows back from the head. */
export function Ledger() {
  const [key, setKey] = useState("all");
  const f = FILTERS.find((x) => x.key === key) ?? FILTERS[0];
  return (
    <Live>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by type">
        {FILTERS.map((x) => (
          <button key={x.key} type="button" className="chip" aria-pressed={x.key === key} onClick={() => setKey(x.key)}>{x.label}</button>
        ))}
      </div>
      <ActivityFeed limit={60} fetchLimit={60} types={f.types} title={f.key === "all" ? "All events" : f.label} />
    </Live>
  );
}
