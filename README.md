# Thaler

A currency with a central bank written in code. Ethereum Sepolia testnet, v0.1.

$THALER has a hard cap of 1,000,000,000. Issuance is not a fixed schedule: it listens to the market. ETH flowing into the canonical pool raises issuance and builds reserves; ETH flowing out cuts issuance and funds buybacks that burn. Bankers hold charters and operate up to ten branches; every active branch receives an equal share of daily issuance. Protocol-owned liquidity only grows.

- Whitepaper: `docs/whitepaper.md`
- Site: https://vadimslo.github.io/thaler/
- Contracts: `contracts/` (Foundry, Solidity 0.8.26, Uniswap v4 hook), verified on Sepolia Etherscan; addresses in `contracts/deployments/11155111.json`

## Layout

```
contracts/   Foundry project: src/, test/, script/Deploy.s.sol, deployments/
web/         Next.js static site, reads the chain directly (wagmi + viem)
docs/        whitepaper
```

## Build

```
cd contracts && forge build && forge test
cd web && npm ci && npm run sync:abi && npm run build
```

## Status

Testnet. No value. Unaudited. Every parameter is published in the whitepaper and on the `/protocol` page. Changes ship as dated updates on `/updates`.
