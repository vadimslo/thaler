import type { Metadata } from "next";
import { AuctionHero, LicenseAuctionCard } from "@/components/Auction";
import { CharterAuctionCard } from "@/components/Charters";
import { UtilityCards } from "@/components/ProtocolLive";
import { Live, NumSection } from "@/components/ui";

export const metadata: Metadata = { title: "Auction House" };

export default function AuctionPage() {
  return (
    <>
      <AuctionHero />
      <NumSection n="01" label="Today's auctions · charters in ETH, licences in THALER" className="pt-4 sm:pt-6">
        <Live>
          <div className="grid gap-px bg-line lg:grid-cols-2">
            <CharterAuctionCard />
            <LicenseAuctionCard />
          </div>
        </Live>
      </NumSection>
      <NumSection n="02" label="Permissionless actions" title="Anyone can turn the clock.">
        <UtilityCards />
      </NumSection>
    </>
  );
}
