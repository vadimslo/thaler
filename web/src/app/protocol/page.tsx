import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ProtocolLive } from "@/components/ProtocolLive";

export const metadata: Metadata = { title: "Protocol" };

export default function ProtocolPage() {
  return (
    <>
      <PageHeader
        eyebrow="Every parameter, every reading"
        title="The protocol, right now"
        lede="Nothing here is hidden behind an admin. Anyone can roll the epoch clock or tick the treasury. Readings refresh every twelve seconds."
      />
      <ProtocolLive />
    </>
  );
}
