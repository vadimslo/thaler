# Thaler: content plan for the first two weeks

Purpose: a consistent stream of small, factual updates from a builder who ships. No promises, no hype words, no hashtags, no long dashes, at most one neutral emoji, under 280 characters per post. Every post points at something that can be checked on chain or on the site. Posting is done by hand; nothing here is scheduled to publish itself.

Channels: X account (to be created; handle suggestions: @thalerfi, @thaler_money, @thalerbank), GitHub releases, the /app/updates page. Same fact, three surfaces, one source: updates.json.

Cadence: one post a day, two on days with a shipped update. Mondays a short "state of the economy" line with live numbers from /app/protocol/. Never post a number that is not on the site at the moment of posting.

## Week 1

Day 1. Launch
"Thaler is live on Sepolia. A currency with a central bank written in code: issuance follows ETH flow through one pool, outflows fund buybacks that burn. Six verified contracts, every parameter public. <site>"

Day 1, second post. The mechanism, one picture
Screenshot of the flow diagram on Protocol Info with the line: "ETH in raises issuance. ETH out buys it back. That is the whole policy."

Day 2. Charters
"1,000 founding charters at 0.001 tETH. A charter is a licence to issue: one branch to start, ten at most, every active branch takes an equal share of 700,000 THALER a day. Licences for new branches are paid in THALER and burned. <site>/app/banks/"

Day 3. The tax curve
Chart of the buy and sell tax decaying from 90% to 2% and 3%. "The launch tax is high on purpose. It falls with a six hour half life on testnet. The same curve runs on mainnet with a three day half life."

Day 4. Dev update
"v0.1.1: withdrawal fee applies to every withdrawal, treasury seed is atomic with pool creation, buyback caps read treasury owned liquidity only. Changelog: <site>/app/updates/"

Day 5. Numbers
"State of the economy, day 5: N charters, N branches, multiplier 1.00x, N ETH in the vaults, N THALER burned. All readable on /app/protocol/."

Day 6. Why not a schedule
"Most supplies follow a calendar decided before launch. A calendar does not know whether capital is arriving or leaving. Thaler reads the net flow of one pool every six hours and reacts with a published rule. No committee."

Day 7. The ledger
Screen recording, 15 seconds: the live ledger filling with events. "Every event the system emits, in one table, from block <genesis block>."

## Week 2

Day 8. Buybacks
The first Buyback event with the hash: "First contraction epoch. The treasury bought N THALER on the pool and burned it. Rate limited: 10% of the vault and 0.2% of the reserve per hour."

Day 9. POL
"Protocol owned liquidity only grows. There is no function to remove it. Genesis position plus 15% of every inbound ETH, compounded hourly. <site>/app/protocol/params/"

Day 10. Dev update
Whatever shipped (planned: dormancy reports, charter transfers, a Telegram alert bot). Format: version, three lines of what changed, link to the changelog.

Day 11. Resolution fee
"Leaving is allowed and priced. The withdrawal fee decays from 60% at mint to 2% over thirty days. Half is never minted, half goes to the other branches."

Day 12. Numbers
Monday line with live numbers.

Day 13. Contracts
"Six contracts, all verified, all addresses on one page. Anyone can rebuild them from the repo and compare bytecode. <site>/app/protocol/contracts/"

Day 14. Two week recap
Four numbers and the next milestone (external audit before mainnet).

## Assets to prepare once

- Flow diagram screenshot (Protocol Info), light and dark crop.
- Tax curve chart (from the whitepaper parameters).
- Ledger screen recording.
- Hero illustration crops for the profile header and post images (web/public/illustrations).

## Not to post

- Price, market cap, listings, "when mainnet" dates.
- Anything about the number of people using it: the testnet activity is partly bots run by the team, and posts must not present it as organic demand.
- Promises of yield or returns.
