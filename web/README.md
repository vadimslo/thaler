# Thaler web

Static site for Thaler on Ethereum Sepolia. Next.js 15 (App Router, static export), Tailwind v4, wagmi v2 + viem. Deployed to GitHub Pages at `https://vadimslo.github.io/thaler/`.

## Routes

`/` home · `/token` supply and swap · `/charters` mint, auction, my charters · `/protocol` every parameter and live reading, Tick and Roll epochs · `/contracts` addresses · `/whitepaper` rendered from `../docs/whitepaper.md` · `/updates` changelog from `src/content/updates.json`.

## Sync ABIs and addresses

The site is built against the six interface ABIs in `../contracts/out/I*.sol/I*.json` and the deployment file `../contracts/deployments/11155111.json`.

```bash
npm run sync:abi
```

This copies the ABIs into `src/abi/*.json`, regenerates `src/abi/index.ts` (typed `as const` copies used by wagmi), and copies the deployment file into `src/config/deployments.json`. If the deployment file does not exist yet, a zero-address placeholder is written once and left alone afterwards; the UI shows "Deployment pending" until real addresses are present.

Run `forge build` in `../contracts` first if the ABIs are stale. Re-run `sync:abi` after every deployment.

`src/config/deployments.json` keys: `token, charter, centralBank, treasury, hook, router, poolManager, poolId, chainId, block, deployer, genesis`. `block` is the deployment block: the charters page scans `Transfer` logs from there to list a wallet's charters (the interface has no enumeration).

## Build

```bash
npm ci
npm run build        # -> out/
```

Base path defaults to `/thaler` (GitHub Pages project site). Override with `NEXT_PUBLIC_BASE_PATH=/` for a root deployment. To preview the export locally, serve `out/` under the same base path, for example:

```bash
mkdir -p /tmp/serve && ln -sfn "$PWD/out" /tmp/serve/thaler && python3 -m http.server 4173 --directory /tmp/serve
# open http://localhost:4173/thaler/
```

`npm run dev` works for development but the wallet flows are best verified on the exported build.

### Mock readings for layout work

```bash
NEXT_PUBLIC_MOCK=1 npm run build   # or npm run dev
```

Renders every live block (status strip, tiles, supply bar, treasury split, activity feed, two sample charters) against fixed plausible numbers from `src/lib/mock.ts`, without an RPC. The flag is inlined at build time and is off by default; a default build never carries mock values. Wallet actions stay disabled under the mock.

## Deploy

`.github/workflows/pages.yml` at the repository root builds `web/` on every push to `main` that touches `web/` or `docs/`, and publishes `web/out` with `actions/deploy-pages`. In the repository settings set Pages source to "GitHub Actions".

## Notes

- RPC: `https://ethereum-sepolia-rpc.publicnode.com`. It caps `eth_getLogs` at about 50k blocks per call; the charter scanner chunks and checkpoints progress in `localStorage`.
- Activity feed (`src/hooks/useActivity.ts`): reads `Taxed`, `FoundingMinted`, `AuctionBought`, `BranchOpened`, `Withdrawn`, `CharterResolved`, `EpochRolled`, `Buyback`, `PolCompounded` and `Allocated` with one `getLogs` per 5,000-block window, newest first from the latest block back to `deployments.block` until 20 rows are in hand, then only new blocks on each poll. Rows and the scanned range persist in `localStorage` (`thaler:activity:<chainId>:<centralBank>`). RPC failures retry with backoff; a hard failure keeps the last rows and shows "feed paused" with a 30s retry.
- Status strip (`src/components/StatusStrip.tsx`) reads block number, epoch, multiplier, regime and taxes from the same hooks; the clock and the epoch countdown tick client-side.
- The charter fee label reads `withdrawFeeBps` when the synced CentralBank interface exposes it and falls back to `resolveFeeBps` (`src/lib/abiFlags.ts`). The feed shows the `fee` field of `Withdrawn` when the event carries one.
- `screenshots/` holds the last verification pass at 1440 and 375 wide.
- Reads poll every 12s (auction price every 10s). Writes go through wagmi `writeContract` with pending / success / error states and Etherscan links.
- Swap quotes are a constant-product estimate from the pool's `slot0` and `liquidity`, read from PoolManager storage via `extsload`. `minAmountOut` is 0 in v1.
- Wallets: EIP-6963 discovered injected wallets plus a generic injected fallback. No WalletConnect.
