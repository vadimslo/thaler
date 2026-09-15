import type { Metadata } from "next";
import { SwapCard } from "@/components/SwapCard";
import { SupplyBar } from "@/components/Dashboard";
import { SwapTiles } from "@/components/SwapLive";
import { Live, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Swap" };

export default function SwapPage() {
  return (
    <>
      <PageHeader eyebrow="Canonical pool · ETH / THALER · Uniswap v4" title="Swap" lede="Exact input through the router. Every trade pays the flow tax in ETH; the tax falls by half every six hours from launch toward its floor." />
      <SwapTiles />
      <div className="mx-auto mt-6 w-full max-w-[520px] sm:mt-8">
        <SwapCard />
      </div>
      <Live compact>
        <div className="card mt-6 p-4 sm:mt-8 sm:p-5"><SupplyBar /></div>
      </Live>
    </>
  );
}
