# Thaler: A Monetary System on Ethereum

Whitepaper v0.1. Testnet release (Sepolia). September 2026.

## 1. Abstract

Thaler is a currency whose central bank is written in code. $THALER is an ERC20 token with a hard cap of one billion units. Issuance follows the flow of ETH through the canonical ETH/THALER pool rather than a fixed schedule: net inflows raise the issuance multiplier and build ETH reserves; net outflows cut the multiplier and fund buybacks that are burned. Issuance is paid to bankers who hold charters (soulbound NFTs) and operate up to ten branches each, every active branch receiving an equal share. Expansion licenses are bought with $THALER and burned. Protocol-owned liquidity only grows. All parameters are published in this document, and all contracts are verified on Etherscan from the first deployment.

## 2. The problem: fixed schedules ignore the market

Most token supplies follow a schedule fixed before launch: a halving calendar, a linear unlock, a constant inflation rate. The schedule does not know whether capital is arriving or leaving; when demand falls it keeps issuing into a shrinking market. Sovereign currencies answer this with a central bank that reads indicators and changes policy, at the cost of discretion.

Thaler keeps the policy and removes the discretion. The indicator is the net flow of ETH through one pool; the reaction is a short set of published rules executed by a contract anyone can call. Supply grows faster when ETH comes in and slower when ETH goes out, and part of the ETH that leaves buys $THALER back and burns it. No operator can change the direction or size of the reaction.

## 3. System overview

Six contracts around one Uniswap v4 pool.

```text
        ETH buys                                  ETH sells
           |                                          |
           v                                          v
 +----------------------------------------------------------------+
 |  canonical ETH/THALER pool (Uniswap v4, 1% fee, spacing 200)   |
 |  FlowHook: buy tax on ETH in, sell tax on ETH out,             |
 |            records ETH in / ETH out for every epoch            |
 +----------------------------------------------------------------+
           |  tax, in ETH                       |  flow signal
           v                                    v
 +---------------------+   regime    +---------------------------+
 |      Treasury       | <---------- |       CentralBank         |
 |  unallocated ETH    |             |  epoch clock, multiplier  |
 +---------------------+             |  branch accumulator       |
      |      |      |                |  licenses, resolution     |
  70% |  15% |  15% |                +---------------------------+
      v      v      v                          |  mints $THALER
 expansion   POL    team                       v
 vault  or  vault  vault              bankers: charters with
 contraction  |                       1 to 10 branches each
 vault        v                                |
   |     full-range position             licenses paid in
   |     (only grows)                    $THALER and burned
   +-> reserves (expansion)
   +-> buyback and burn (contraction)
```

ETH enters through the trading tax and charter sales and is split 70/15/15 in the Treasury. The flow through the pool sets the multiplier and the regime, and the regime decides whether the active 70% builds reserves or buys back and burns.

## 4. The currency: $THALER

$THALER is an ERC20 token with 18 decimals and a hard cap of 1,000,000,000 enforced in the contract. Only the CentralBank can mint; the minter is set once and cannot be changed.

At genesis 100,000,000 $THALER is minted for one purpose: it is paired with ETH into the full-range liquidity position owned by the Treasury. The remaining 900,000,000 is the issuance budget, minted over time to bankers. The budget counts cumulative mints regardless of burns: once 900,000,000 has been issued, issuance stops even if supply has fallen.

Supply leaves circulation four ways: expansion licenses are burned in full; buybacks burn every unit bought; leftover $THALER from seeding and compounding is burned; any holder can burn their own balance. Half of every withdrawal fee is never minted.

## 5. Charters and branches

A charter is an ERC721 token ("Thaler Charter", symbol CHARTER); its holder is a banker. Each charter starts with one branch and can open up to ten. Every active branch receives an equal share of issuance, so a charter with four branches receives four shares.

Charters are sold in two parallel ways. The founding phase sells 1,000 charters at a fixed price, at most three per wallet. The daily Dutch auction sells a fixed number per day, days being whole 24-hour periods (UTC). Each day the price opens at three times the last close (three times the floor before any sale) and decays toward the floor with a four-hour half-life; a buyer pays the current price and any excess is refunded. Supply per day and the floor are owner policy in v0.1.

All proceeds go to the Treasury. Charters are soulbound: transfers revert until the owner enables them, a one-way switch. Minting and burning are always allowed.

## 6. Issuance and the multiplier

Base issuance is 700,000 $THALER per day at a multiplier of 1.00x. The multiplier starts at 1.00x and is bounded between 0.20x and 1.25x. Issuance accrues per second, divided equally across all active branches. With B = 700,000 per day, m the multiplier and N the active branches:

- issuance per second: r = B × m / 86,400
- over an interval Δt a charter with k branches accrues k × r × Δt / N
- one branch's daily issuance: B × m / N

At 1.00x with 1,000 branches, each accrues 700 $THALER per day. A banker withdraws at any time. Every withdrawal pays the fee of section 10 on the amount pending; the remainder is minted to the owner, capped by the remaining budget, and anything unminted stays owed.

Policy is decided per epoch. The clock starts at deployment and ticks every 6 hours on testnet, every 3 days on mainnet. For each completed epoch e the CentralBank reads from the hook the ETH that entered and left the pool and sets net(e) = in - out. The trailing net flow is net(e) + net(e - 1), with net(-1) = 0.

- Trailing net flow negative: the multiplier is cut by 0.15, not below 0.20x, and the positive-epoch counter resets.
- Otherwise, net(e) positive: the counter increases by one; at two, the multiplier is raised by 0.10, not above 1.25x, and the counter resets.
- Otherwise, net(e) negative: the counter resets and the multiplier is unchanged.
- Otherwise nothing changes.

The regime is Contraction if net(e) was negative, Expansion otherwise; the initial regime is Expansion. Accrual up to the end of each epoch is booked at the multiplier that governed that epoch before the policy for that epoch is applied, however late the roll happens. Rolling is permissionless, handles at most 50 epochs per call, and runs before every state-changing call to the CentralBank and before every Treasury allocation.

## 7. Expansion licenses

A banker opens an additional branch by buying an expansion license, paid in $THALER and burned in full in the same transaction. A charter cannot exceed ten branches, and at most 100 licenses are sold per day across the system.

The price is a Dutch auction that resets daily. The floor is two days of one branch's issuance, 2 × B × m / N, with a minimum of 1 $THALER. Each day the price opens at twice the last close and decays toward the floor with a four-hour half-life; before the first sale the price is the floor. Each purchase records its price as the new close. The floor rises with the multiplier and falls as branches open.

## 8. Trading tax and the flow signal

The canonical pool is a Uniswap v4 pool with native ETH as currency0 and $THALER as currency1, a 1% swap fee and tick spacing 200. A hook bound to this pool alone collects a tax in ETH and records the flow signal.

The buy tax is charged on the ETH input before the swap; the pool receives the input less the tax. The sell tax is charged on the ETH output after the swap; the seller receives the output less the tax. Tax goes to the Treasury inside the swap; the hook never holds ETH.

Both rates start at 90% when the pool is initialized and decay with a half-life of 6 hours on testnet and 3 days on mainnet:

rate = floor + (90% - floor) × 0.5^(elapsed / half-life)

The buy floor is 2%, the sell floor 3%. The buy rate is within one point of its floor after seven half-lives: about 42 hours on testnet, 21 days on mainnet. Early trading is expensive by design; the launch tax funds reserves and liquidity before issuance has accrued.

Only exact-input swaps are supported in v0.1; exact-output swaps revert. The Treasury is exempt: its buybacks and compounding are neither taxed nor counted. Every other swapper is taxed, whatever router it uses.

The flow signal is recorded per epoch at the pool boundary: on a buy, the ETH reaching the pool after tax; on a sell, the ETH the pool pays out before tax. Inflows and outflows are stored separately as gross ETH in and gross ETH out.

## 9. Treasury

The Treasury holds all protocol ETH. Inbound ETH is split 70% to the active vault, 15% to the POL vault and 15% to the team vault; the active vault is the expansion vault in Expansion and the contraction vault in Contraction. Allocation first rolls every completed epoch, so the split follows the regime of the last completed epoch.

The expansion vault accumulates ETH reserves. In v1 the owner withdraws ETH from the expansion vault and executes reserve purchases; an on-chain purchase path is a later update.

The contraction vault funds buybacks. Ticks are rate limited to one per hour. On each tick the Treasury spends min(10% of the contraction vault, 0.2% of the pool's ETH reserve) on a market buy of $THALER and burns everything received. The reserve is estimated on-chain from the liquidity the Treasury owns as polLiquidity × 2^96 / sqrtPriceX96, so liquidity added by third parties does not raise the caps.

On the same tick, if the POL vault holds at least the minimum (0.0005 ETH on testnet, 0.1 ETH on mainnet), the Treasury swaps min(half the vault, 0.2% of the pool's ETH reserve) to $THALER and pairs it with the same amount of ETH into the full-range position; leftover $THALER is burned, leftover ETH and whatever the cap left behind stay in the vault for the next tick.

The pool is created and seeded in one transaction: pool initialization on the Uniswap PoolManager and the genesis position are added atomically, so no swap can move the price of an empty pool before the first liquidity is in place. The tax clock of section 8 starts at that seed.

The team vault is claimable by the owner to the team address. Allocation and ticking are permissionless.

## 10. The withdrawal fee and resolution

Every withdrawal pays a fee on the amount pending. The fee decays quadratically with the charter's age. With P the fee period (30 days on testnet, 365 days on mainnet):

fee = 2% + 58% × ((P - age) / P)^2 for age < P, and 2% after.

The fee is 60% at mint, 16.5% at half the period and 2% from the end of the period on. The rate in force at the moment of withdrawal applies to the whole amount pending. Half of the fee is never minted and is counted as burned. The other half is added to the accumulator of every branch except the withdrawing charter's own, so other bankers receive it in proportion to their branches; if there are no other branches, it is not minted either.

A banker leaves by resolving the charter. Resolution is the final withdrawal, at the same fee, followed by removing all of the charter's branches and burning the NFT. Branches and the licenses burned to open them are not refunded.

## 11. Protocol-owned liquidity

The Treasury owns the only liquidity the protocol creates, and there is no function to remove it. The genesis position pairs 100,000,000 $THALER with the seed ETH across the full tick range (-887200 to 887200). Every allocation sends 15% of inbound ETH to the POL vault, and every compound adds to the same position. It provides liquidity at every price and can only grow.

## 12. Parameters

All values are constructor arguments or constants of the deployed contracts.

| Parameter | Testnet (Sepolia) | Mainnet |
|---|---|---|
| Epoch length | 6 hours | 3 days |
| Base issuance per day at 1.00x | 700,000 THALER | 700,000 THALER |
| Issuance budget | 900,000,000 THALER | 900,000,000 THALER |
| Genesis allocation to POL | 100,000,000 THALER | 100,000,000 THALER |
| Hard cap | 1,000,000,000 THALER | 1,000,000,000 THALER |
| Multiplier at start | 1.00x (10,000) | 1.00x (10,000) |
| Multiplier minimum | 0.20x (2,000) | 0.20x (2,000) |
| Multiplier maximum | 1.25x (12,500) | 1.25x (12,500) |
| Multiplier cut | 0.15 (1,500) | 0.15 (1,500) |
| Multiplier raise | 0.10 (1,000) | 0.10 (1,000) |
| Branches per charter, maximum | 10 | 10 |
| Licenses per day | 100 | 100 |
| License opening price | 2x last close | 2x last close |
| License half-life | 4 hours | 4 hours |
| License floor | 2 days of one branch's issuance, min 1 THALER | 2 days of one branch's issuance, min 1 THALER |
| Withdrawal fee minimum | 2% (200 bps) | 2% (200 bps) |
| Withdrawal fee maximum | 60% (6,000 bps) | 60% (6,000 bps) |
| Withdrawal fee period | 30 days | 365 days |
| Founding charter supply | 1,000 | 1,000 |
| Founding charter price | 0.001 ETH | 0.15 ETH |
| Founding charters per wallet | 3 | 3 |
| Charter auction per day | 10 | owner policy |
| Charter auction floor | 0.001 ETH | owner policy, set before launch |
| Charter auction opening price | 3x last close | 3x last close |
| Charter auction half-life | 4 hours | 4 hours |
| Pool fee | 1% (tier 10,000) | 1% (tier 10,000) |
| Pool tick spacing | 200 | 200 |
| Tax at launch, buy and sell | 90% (9,000 bps) | 90% (9,000 bps) |
| Buy tax floor | 2% (200 bps) | 2% (200 bps) |
| Sell tax floor | 3% (300 bps) | 3% (300 bps) |
| Tax half-life | 6 hours | 3 days |
| Treasury split, active / POL / team | 70% / 15% / 15% | 70% / 15% / 15% |
| Buyback cap per tick, share of contraction vault | 10% (1,000 bps) | 10% (1,000 bps) |
| Buyback cap per tick, share of pool ETH reserve | 0.2% (20 bps) | 0.2% (20 bps) |
| Tick interval, buyback and POL compound | 1 hour | 1 hour |
| POL compound swap cap per tick, share of pool ETH reserve | 0.2% (20 bps) | 0.2% (20 bps) |
| POL minimum compound | 0.0005 ETH | 0.1 ETH |

## 13. Contracts and verification

Addresses, the pool id and the deployment block are published on the project site, and every contract is verified on Etherscan from the day it is deployed.

- ThalerToken: the ERC20. Hard cap, mint restricted to the CentralBank, burn for anyone, running total of burned supply.
- CharterNFT: the ERC721 charter. Founding mint, daily ETH Dutch auction, soulbound transfers, registration with the CentralBank, proceeds to the Treasury, burn on resolution.
- CentralBank: the monetary authority. Epoch clock, multiplier and regime, per-branch accumulator, withdrawals, expansion licenses, resolution. The only minter of $THALER.
- FlowHook: a Uniswap v4 hook bound to the canonical ETH/THALER pool (fee 1%, tick spacing 200). Collects the tax in ETH for the Treasury and records ETH in and out per epoch. Reverts for any other pool and for exact-output swaps.
- Treasury: holds all protocol ETH. Allocation, the four vaults, buybacks and burns, liquidity compounding, pool initialization and the genesis seed, team claim.
- ThalerRouter: a minimal exact-input swap helper with minimum output and deadline checks.

Wiring between contracts is set once after deployment and cannot be changed.

Administrative powers in v0.1 sit with the deployer under two-step ownership and are limited to setting the charter auction supply per day and floor, enabling charter transfers (irreversible), claiming the team vault, and withdrawing ETH from the expansion vault for reserve purchases. No owner function touches issuance, the multiplier, the tax, the vault split, buybacks or liquidity.

## 14. Roadmap

v0.1, testnet: everything in this document, on Sepolia with the testnet column.

Subsequent updates, in the order planned:

- Dormancy reports and revocation: reporting charters that have stopped operating and revoking them.
- Reserve asset purchases: the expansion vault buying reserve assets such as tokenized gold.
- Charter transfers: enabling the transfer switch.
- Governance vote token: voting on the parameters that are owner policy today.
- Mainnet: deployment with the mainnet parameter column after an external audit.
- Multisig and timelock: administrative powers moved to a multisig behind a timelock.

## 15. Risks

Smart contract risk. The contracts hold ETH and control issuance. A defect in any of them, in Uniswap v4 or in the hook integration could result in loss of funds or incorrect issuance.

Unaudited v1. The v0.1 code has not been externally audited; mainnet deployment is conditioned on an audit.

Reflexive dynamics. Issuance and buybacks depend on flows, and flows depend on holder behavior. Sustained outflows cut issuance toward 0.20x and spend the contraction vault on buybacks; sustained inflows raise issuance toward 1.25x. The multiplier bounds and buyback rate limits bound the speed of the reaction, not its direction.

Early trading is expensive by design. The tax opens at 90%; trades in the first hours on testnet and the first weeks on mainnet pay most of their value in tax.

Testnet has no value. Sepolia ETH and testnet $THALER have no monetary value; the release exists to exercise the mechanics under real usage before mainnet.

Administrative keys. Until the multisig and timelock update, the owner functions in section 13 are held by a single key.
