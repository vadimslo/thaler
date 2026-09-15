# Thaler contracts: design spec (v1, Sepolia)

Read fully before writing any contract. Interfaces in `src/interfaces/` are the contract between components: implement them exactly, add nothing public that is not listed unless clearly needed (getters are fine). Solidity 0.8.26, via_ir on, OpenZeppelin 5.1 (`@openzeppelin/contracts/...`), Uniswap v4 core at `@uniswap/v4-core/src/...`, periphery at `@uniswap/v4-periphery/src/...`. `forge build` must pass with zero errors.

## Actors and wiring

```
ThalerToken  (ERC20 cap 1e27; minter = CentralBank, one-shot setCentralBank; constructor mints 100M to msg.sender for the genesis seed)
CharterNFT   (ERC721 "Thaler Charter" / "CHARTER"; founding mint + ETH Dutch auction; forwards ETH to Treasury; calls centralBank.registerCharter on every mint)
CentralBank  (epoch clock, multiplier, branch accumulator, license auction in THALER, withdrawal fee, resolve; mints THALER on withdraw)
FlowHook     (v4 hook: buy/sell tax in ETH -> Treasury; records ETH in/out per epoch; reads centralBank.currentEpoch())
Treasury     (all protocol ETH; vault split; buyback+burn; POL full-range position; pool creation + genesis seed in one tx; owner withdrawal of the expansion vault)
ThalerRouter (exact-input swap helper for users; unlock-callback pattern)
```

Deploy order (script): Token → CharterNFT → CentralBank(token, charter) → token.setCentralBank(bank) → charter.setCentralBank(bank) → Treasury(token, poolManager, bank, team) → charter.setTreasury(treasury) → mine hook salt (HookMiner, CREATE2 deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C) → FlowHook{salt}(poolManager, bank, treasury) → bank.setHook(hook) → treasury.setHook(hook) → Router(poolManager, treasury) → treasury.initializePool(sqrtPriceX96) (records key, poolId and price only) → token.approve(treasury, 100M) → treasury.seedLiquidity{value: seedEth}(100M) (creates the pool on the PoolManager and adds the first liquidity in the same transaction; the hook's launchedAt is that timestamp). Owner of everything = deployer (Ownable2Step). Write `deployments/sepolia.json` with all addresses + poolId + block.

Testnet params (constructor args or constants; the whitepaper publishes both testnet and mainnet columns):

| param | testnet | mainnet (later) |
|---|---|---|
| EPOCH | 6 hours | 3 days |
| BASE_ISSUANCE_PER_DAY | 700_000e18 | same |
| ISSUANCE_BUDGET | 900_000_000e18 | same |
| multiplier start / min / max / cut / raise | 10_000 / 2_000 / 12_500 / 1_500 / 1_000 | same |
| MAX_BRANCHES | 10 | 10 |
| LICENSES_PER_DAY | 100 | 100 |
| license open multiple / half-life / floor | 2x last close / 4h / 2 days of one branch's issuance (min 1e18) | same |
| withdrawal fee min / max / period (`RESOLVE_FEE_*`) | 200 / 6000 bps / 30 days | 200 / 6000 / 365 days |
| FOUNDING_SUPPLY / PRICE / PER_WALLET | 1000 / 0.001 ether / 3 | 1000 / 0.15 ether / 3 |
| charter auction per day / floor / open multiple / half-life | 10 / 0.001 ether / 3x last close / 4h | policy / TBD / 3x / 4h |
| pool fee / tickSpacing | 10_000 (1%) / 200 | same |
| tax launch / buy floor / sell floor / half-life | 9_000 / 200 / 300 bps / 6 hours | 9_000 / 200 / 300 / 3 days |
| treasury split active/POL/team | 7_000 / 1_500 / 1_500 | same |
| buyback per tick: min(10% vault, 0.2% pool ETH reserve), TICK_INTERVAL | 1_000 bps / 20 bps / 1 hour | same |
| POL compound swap per tick: min(polVault / 2, 0.2% pool ETH reserve) | 20 bps | same |
| POL_MIN_COMPOUND | 0.0005 ether | 0.1 ether |

Make testnet/mainnet-varying values constructor parameters (immutables), constants otherwise.

## CentralBank mechanics

- `currentEpoch() = (block.timestamp - GENESIS) / EPOCH`. GENESIS = deployment timestamp.
- Accrual: MasterChef accumulator. `accPerBranch` (1e18-scaled). `_update()`: if totalBranches > 0, `accPerBranch += issuancePerSecond() * (now - lastUpdate) * 1e18 / totalBranches`; always set lastUpdate = now. `issuancePerSecond = BASE_ISSUANCE_PER_DAY * multiplier / 1e4 / 86400`. Per charter: `pending = branches * accPerBranch / 1e18 - debt` (+ stored `owed`). On any change of branches or withdraw: settle into `owed`, reset debt.
- `withdraw(tokenId)`: msg.sender == charter.ownerOf(tokenId). Settle pending P. fee = P * withdrawFeeBps(id) / 1e4, net = P - fee. minted = min(net, ISSUANCE_BUDGET - totalIssued), minted to the owner, totalIssued += minted; net - minted stays owed (never mint over budget). Of the fee: half is never minted (counted in `totalFeesUnminted`; `totalResolveBurned()` is an alias getter), half goes to every other branch: `accPerBranch += half * 1e18 / (totalBranches - branches)` and the charter's own debt is re-based to the new accumulator so it does not receive its own fee. With no other branches that half is also unminted. Emit `Withdrawn(tokenId, owner, minted, fee)`.
- Register: `registerCharter` only from `charter`; branches = 1, mintedAt = now, debt set from current acc, totalBranches += 1.
- `openBranch`: owner of tokenId, reverts `BudgetExhausted` once totalIssued >= ISSUANCE_BUDGET, branches < MAX_BRANCHES, licensesRemainingToday() > 0. price = licensePrice(); `token.burnFrom(msg.sender, price)`; record last close = price, licensesSoldToday += 1 (day index = now / 1 days, reset on new day); branches += 1; totalBranches += 1.
- `licensePrice()`: floor = max(2 * issuancePerBranchPerDay(), 1e18) where issuancePerBranchPerDay = BASE*mult/1e4/totalBranches (if totalBranches==0 use BASE*mult/1e4). start = lastLicenseClose == 0 ? floor : 2 * lastLicenseClose. elapsed = now - dayStart (day boundaries = multiples of 1 days). price = Decay.decay(start, floor, elapsed, 4 hours). Use `src/base/Decay.sol`.
- `withdrawFeeBps(id)` == `resolveFeeBps(id)`: age = now - mintedAt; if age >= PERIOD return MIN; else `MIN + (MAX - MIN) * (PERIOD - age)^2 / PERIOD^2`. The same fee applies to every withdrawal, resolution included.
- `resolve(id)`: exactly a final withdraw (same fee, same split, emits `Withdrawn`), then totalBranches -= branches, delete charter accounting, `charter.burnFromBank(id)`. Any budget-capped remainder still owed is dropped with the accounting. Emit `CharterResolved(id, owner, paid, burned, redistributed)`.
- Epochs: `rollEpochs()`: roll every completed epoch e (completed when currentEpoch() > e) starting at the first unrolled one, at most 50 per call; a further call continues. For each e: first book accrual up to the epoch's end, `GENESIS + (e + 1) * EPOCH`, at the multiplier that governed the epoch (no-op if already booked past it), then apply policy: `(in, out) = hook.flowOf(e)`; net = in - out; prevNet = net of e - 1 (0 if e == 0); trailing = net + prevNet. If trailing < 0: multiplier = max(MIN, mult - CUT), consecutivePositive = 0. Else if net > 0: consecutivePositive += 1; at 2: multiplier = min(MAX, mult + RAISE), consecutivePositive = 0. Else if net < 0 (trailing >= 0): consecutivePositive = 0, multiplier unchanged. Else (net == 0): nothing. regime = net < 0 ? Contraction : Expansion. Emit EpochRolled per epoch. If hook is unset, treat flow as 0. Accrual after the last rolled boundary is booked by `_update()` at the current multiplier.
- `regime()` = stored regime from last roll (Expansion initially).
- Every state-changing entry point calls `rollEpochs()` first (cheap when nothing to roll), then `_update()`.

## CharterNFT mechanics

- Ownable2Step. `mintFounding(qty)`: qty >= 1, foundingMinted + qty <= FOUNDING_SUPPLY, foundingMintedBy[msg.sender] + qty <= FOUNDING_PER_WALLET, msg.value == qty * FOUNDING_PRICE. Mint sequential ids starting at 1, call `centralBank.registerCharter(id, msg.sender)` for each, forward ETH to treasury (`treasury.call{value}`; require success). Emit per token.
- Auction: day index = now / 1 days. `auctionRemainingToday = auctionPerDay - soldToday` (reset per day). `auctionPrice()`: start = lastAuctionClose == 0 ? 3 * auctionFloor : 3 * lastAuctionClose; elapsed since day start; `Decay.decay(start, auctionFloor, elapsed, 4 hours)`. `buyAtAuction()`: remaining > 0, msg.value >= price; refund excess; mint; register; forward price to treasury; lastAuctionClose = price. Auction is available in parallel with founding (they are independent supplies).
- Soulbound: override `_update` (OZ5) to revert on transfers between two non-zero addresses while `!transfersEnabled` (mint and burn allowed). `burnFromBank` only from centralBank.
- `tokenURI`: on-chain data URI with a tiny JSON (name "Thaler Charter #id", description, attributes branches from centralBank.branchesOf). Keep small, no SVG needed.

## FlowHook mechanics (Uniswap v4)

Permissions: beforeInitialize, beforeSwap, afterSwap, beforeSwapReturnDelta, afterSwapReturnDelta. Nothing else. Flags = BEFORE_INITIALIZE_FLAG | BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG | BEFORE_SWAP_RETURNS_DELTA_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG.

- `_beforeInitialize(sender, key, _)`: require sender == treasury, !poolBound, key.currency0 == native (address 0), key.currency1 == token, key.fee == 10_000, key.tickSpacing == 200. Store poolKey, poolBound = true, launchedAt = now. Emit PoolBound. This runs inside `Treasury.seedLiquidity`, so the tax clock starts at the seed.
- Tax rates: `buyTaxBps = Decay.decay(LAUNCH_TAX_BPS, BUY_FLOOR_BPS, now - launchedAt, TAX_HALF_LIFE)`, sell same with SELL_FLOOR_BPS. Before launch return LAUNCH_TAX_BPS.
- Exempt: `sender == treasury` → no tax, no flow recording, return zero deltas.
- Only exact input supported: `params.amountSpecified < 0`; if >= 0 revert `ExactOutputNotSupported()`.
- Buy (zeroForOne, ETH in): in `_beforeSwap`: amountIn = uint256(-amountSpecified); tax = amountIn * buyTaxBps / 1e4; if tax > 0: `poolManager.take(key.currency0, treasury, tax)`; record `flow[epoch].ethIn += amountIn - tax`; totals; emit Taxed. Return `(selector, toBeforeSwapDelta(int128(int256(tax)), 0), 0)`. (Positive specified delta = hook is credited `tax`, which cancels the take; the pool swaps amountIn - tax; the swapper pays the full amountIn.)
- Sell (oneForZero, THALER in, ETH out): `_beforeSwap` returns zero delta. In `_afterSwap`: ethOut = uint256(int256(delta.amount0())) (positive = swapper receives). tax = ethOut * sellTaxBps / 1e4; if tax > 0: `poolManager.take(key.currency0, treasury, tax)`; record `flow[epoch].ethOut += ethOut`; emit. Return `(selector, int128(int256(tax)))` (hookDeltaUnspecified: charged to the swapper, credited to the hook, cancelling the take).
- For buys `_afterSwap` returns `(selector, 0)`.
- epoch = `ICentralBank(centralBank).currentEpoch()`.
- The hook must revert if used with any key other than the bound one (`key.toId() != poolKey.toId()` → revert `WrongPool()`), except in beforeInitialize.
- `receive()` not needed. Never hold ETH.

## Treasury mechanics

- Ownable2Step. `receive()` → `unallocated += msg.value`. Never revert in receive (PoolManager.take sends ETH here).
- `allocate()`: a = unallocated; if 0 return. toTeam = a * TEAM_BPS / 1e4; toPol = a * POL_BPS / 1e4; toActive = a - toTeam - toPol; call `ICentralBank(centralBank).rollEpochs()` first so the split follows the regime of the last completed epoch, then read `regime()`; Contraction → contractionVault += toActive else expansionVault += toActive. unallocated = 0. Emit.
- Invariant: `address(this).balance >= unallocated + expansionVault + contractionVault + polVault + teamVault` (equality except dust).
- `initializePool(sqrtPriceX96)`: owner, one-shot, hook set. Records key = PoolKey(Currency.wrap(address(0)), Currency.wrap(token), 10_000, 200, IHooks(hook)), its poolId and the price; sets poolInitialized. The pool itself is not created here: an empty pool's price can be moved for free, so creation waits for the seed.
- Full-range ticks: tickLower = -887200, tickUpper = 887200 (multiples of 200; TickMath.MIN_TICK = -887272).
- `seedLiquidity(thalerAmount)`: owner, one-shot, after initializePool. transferFrom thaler; `poolManager.initialize(key, sqrtPriceX96)` and the first liquidity in the same transaction; compute liquidity via `LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtLower, sqrtUpper, msg.value, thalerAmount)` (from `@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol`); add liquidity through `poolManager.unlock` + `modifyLiquidity` with salt 0; settle both currencies (native via `poolManager.settle{value}()`, ERC20 via sync/transfer/settle); any leftover THALER burned, leftover ETH → polVault. polLiquidity += L. Emit Seeded.
- `tick()`: `allocate()`; return unless `now >= lastTick + TICK_INTERVAL`. Both swaps are sized from the pre-tick reserve: cap = poolEthReserve() * BUYBACK_RESERVE_BPS / 1e4. Buyback = nextBuybackAmount(); if > 0: swap ETH→THALER on the pool via unlock (zeroForOne, exactInput, sqrtPriceLimit = TickMath.MIN_SQRT_PRICE + 1), burn all THALER received, contractionVault -= ETH actually spent, counters, emit Buyback. Then POL, inside the same interval branch: if seeded and polVault >= POL_MIN_COMPOUND: half = min(polVault / 2, cap); swap half ETH→THALER (same path); pair the same amount `half` of ETH with the THALER received into the full-range position, burn leftover THALER, leftover ETH and whatever the cap left behind stay in polVault for the next interval; emit PolCompounded. lastTick = now.
- `nextBuybackAmount() = min(contractionVault * BUYBACK_VAULT_BPS / 1e4, poolEthReserve() * BUYBACK_RESERVE_BPS / 1e4)`.
- `poolEthReserve()`: `StateLibrary.getSlot0` → `polLiquidity * 2^96 / sqrtPriceX96` (uint256 math, FullMath.mulDiv). Treasury-owned liquidity only, so third-party or just-in-time liquidity cannot inflate the per-tick caps.
- Unlock callback: implement `IUnlockCallback.unlockCallback(bytes)` with an internal action enum (Swap, AddLiquidity); require msg.sender == poolManager. Use `CurrencySettler` pattern (v4-core `test/utils/CurrencySettler.sol` is test code; re-implement the few lines: for native `poolManager.settle{value: amt}()`, for ERC20 `poolManager.sync(c); token.transfer(poolManager, amt); poolManager.settle()`; `poolManager.take(c, address(this), amt)` for positive deltas). Use `TransientStateLibrary.currencyDelta` or the returned BalanceDelta to know amounts.
- `claimTeam()`: owner; sends teamVault to `team`; teamVault = 0.
- `withdrawExpansion(to, amount)`: owner; amount <= expansionVault; expansionVault -= amount; send ETH to `to`; emit ExpansionWithdrawn. Reserve purchases are executed by the owner off this contract in v1; an on-chain purchase path is a later update.
- Hook is tax-exempt for Treasury because `sender` in hook callbacks is the address calling `poolManager.swap`, i.e. this contract.

## ThalerRouter

- `swapExactIn(buy, amountIn, minOut, to, deadline)`: deadline check; buy → require msg.value == amountIn; sell → msg.value == 0, `token.transferFrom(msg.sender, address(this), amountIn)`. Read poolKey from `ITreasury(treasury).poolKey()`. `poolManager.unlock(abi.encode(...))`; in callback: swap with `SwapParams(zeroForOne = buy, amountSpecified = -int256(amountIn), sqrtPriceLimitX96 = buy ? MIN_SQRT_PRICE+1 : MAX_SQRT_PRICE-1)`; settle input (native: `settle{value}`; erc20: sync/transfer/settle), take output to `to`. amountOut from the returned delta (for buy: delta.amount1(); sell: delta.amount0()) — note the hook's after-swap delta is already reflected in the delta returned by poolManager.swap? NO: `PoolManager.swap` returns `swapDelta` which already has the hook delta applied (hookDelta subtracted from the caller's delta). Use `poolManager.currencyDelta` (TransientStateLibrary) on `address(this)` after the swap to settle exactly what is owed/owned. minOut check on amountOut. Emit.
- Reentrancy guard on `swapExactIn`.

## Testing conventions

- Local: deploy a real `PoolManager(address(0))` in tests (`new PoolManager(address(0))`) — or use `Deployers` from `@uniswap/v4-core/test/utils/Deployers.sol`. Hook: compute a flagged address (any address with the right low 14 bits, e.g. `address(uint160(Hooks.BEFORE_INITIALIZE_FLAG | ... ) ^ (0x4444 << 144))`) and `deployCodeTo("FlowHook.sol:FlowHook", abi.encode(pm, bank, treasury), hookAddr)`.
- Native ETH as currency0: use `Currency.wrap(address(0))` (CurrencyLibrary.ADDRESS_ZERO).
- Shared fixture `test/Base.t.sol` deploys everything exactly in the deploy order above with testnet params, seeds 100M THALER + 1 ether, and exposes helpers `buy(user, ethIn)` / `sell(user, thalerIn)` through the router.
- Every test file must pass: `forge test --match-path test/<File>.t.sol -vv`.
