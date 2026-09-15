import type { Metadata } from "next";
import Link from "next/link";
import { ProtocolLive } from "@/components/ProtocolLive";
import { Icon } from "@/components/shell/Icons";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Protocol Params" };

export default function ParamsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Protocol Info · every parameter, every reading"
        title="The protocol, right now"
        lede="Nothing here is hidden behind an admin. Readings refresh every twelve seconds. The clock actions anyone can call live in the Auction House."
        aside={<Link href="/app/auction/" className="link-quiet text-sm">Roll epochs, tick treasury <Icon name="arrow" size={12} className="ml-1 inline" /></Link>}
      />
      <ProtocolLive />
    </>
  );
}
