import { createConfig, http, injected } from "wagmi";
import { sepolia } from "wagmi/chains";

export const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  ssr: true,
  transports: {
    [sepolia.id]: http(RPC_URL, { batch: true }),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export const POLL_MS = 12_000;
