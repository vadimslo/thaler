#!/usr/bin/env python3
"""Thaler activity bot: keeps the testnet economy visibly alive.

Runs under LaunchAgent every 10 minutes. Each run rolls dice and performs zero, one or two
on-chain actions from a set of bot wallets: buys and sells on the canonical pool, founding
mints, branch openings, withdrawals, auction purchases, treasury ticks and epoch rolls.
A slow "mood" that flips every few hours biases buys vs sells so both regimes show up.

  python3 activity.py            one scheduled run (dice)
  python3 activity.py --force    one run with a guaranteed action
  python3 activity.py --status   wallets, balances, counters, last actions
  python3 activity.py --fund     top up bot wallets from the deployer

Guards: per-day tx cap, per-day gas cap in ETH, wallet ETH floor, deployer reserve floor,
explicit gas limits (public RPC estimates run low on these paths, see GOTCHAS), lock file.
Failures go to self_heal.py; Telegram gets one line only when a human has to act.
"""
import json
import os
import random
import subprocess
import sys
import time
import fcntl
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LOGS = ROOT / "logs"
LOGS.mkdir(exist_ok=True)
STATE = HERE / "state.json"
LOCK = HERE / ".lock"
CAST = str(Path.home() / ".foundry/bin/cast")
DEPLOY = json.load(open(ROOT / "contracts/deployments/11155111.json"))

# ---- limits (testnet ETH is free but finite; keep the deployer able to redeploy) ----
MAX_TX_PER_DAY = 60
MAX_GAS_ETH_PER_DAY = 0.03
WALLET_FLOOR_ETH = 0.004        # below this a wallet is refilled
WALLET_REFILL_ETH = 0.015
DEPLOYER_RESERVE_ETH = 0.06     # never spend the deployer below this
P_ACT = 0.55                    # chance a run does anything
P_SECOND = 0.25                 # chance of a second action in the same run
GAS = {"swap": 320_000, "mint": 400_000, "auction": 400_000, "branch": 260_000,
       "withdraw": 260_000, "resolve": 320_000, "tick": 480_000, "roll": 260_000, "approve": 80_000}


def env():
    out = {}
    for f in (ROOT / ".env", ROOT / ".env.bots"):
        if f.exists():
            for line in f.read_text().splitlines():
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip()
    return out


ENV = env()
RPC = ENV.get("SEPOLIA_RPC", "https://ethereum-sepolia-rpc.publicnode.com")
BOTS = [(k, v) for k, v in sorted(ENV.items()) if k.startswith("BOT_PK_")]


def log(msg):
    line = f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    with open(LOGS / "activity.log", "a") as f:
        f.write(line + "\n")
    print(line)


def state():
    if STATE.exists():
        return json.load(open(STATE))
    return {"day": "", "tx_today": 0, "gas_eth_today": 0.0, "mood": "expand", "mood_until": 0,
            "last": [], "totals": {}}


def save(s):
    tmp = STATE.with_suffix(".tmp")
    json.dump(s, open(tmp, "w"), indent=1)
    os.replace(tmp, STATE)


# ---- chain helpers ----
# `cast wallet ...` is offline (derives keys/addresses locally) and rejects --rpc-url on newer
# Foundry, so RPC is added only for the on-chain subcommands.
OFFLINE = {"wallet"}


def cast(*args, timeout=90):
    cmd = [CAST, *args] if args and args[0] in OFFLINE else [CAST, *args, "--rpc-url", RPC]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"cast {' '.join(args[:3])}: {r.stderr.strip()[-300:]}")
    return r.stdout.strip()


def call(addr, sig, *args):
    out = cast("call", addr, sig, *[str(a) for a in args])
    return out.split()[0] if out else out


def addr_of(pk):
    return cast("wallet", "address", "--private-key", pk)


def balance_eth(addr):
    return float(cast("balance", addr, "-e"))


def thaler_of(addr):
    return int(call(DEPLOY["token"], "balanceOf(address)(uint256)", addr)) / 1e18


def send(pk, to, sig, *args, value=None, gas=300_000):
    # An empty sig means a plain ETH transfer; newer cast rejects "" as a signature, so omit it.
    head = [to, sig, *[str(a) for a in args]] if sig else [to]
    cmd = ["send", *head, "--private-key", pk, "--gas-limit", str(gas), "--json"]
    if value is not None:
        cmd += ["--value", str(value)]
    out = json.loads(cast(*cmd, timeout=240))
    ok = out.get("status") in ("0x1", 1, "1")
    gas_used = int(out.get("gasUsed", "0x0"), 16)
    price = int(out.get("effectiveGasPrice", "0x0"), 16)
    return ok, out.get("transactionHash"), gas_used * price / 1e18


# ---- actions ----
def act_buy(pk, who):
    eth = round(random.uniform(0.0003, 0.0015), 6)
    if balance_eth(who) < eth + WALLET_FLOOR_ETH:
        return None
    dl = int(time.time()) + 1200
    return send(pk, DEPLOY["router"], "swapExactIn(bool,uint256,uint256,address,uint256)",
                "true", int(eth * 1e18), 0, who, dl, value=int(eth * 1e18), gas=GAS["swap"]), f"buy {eth} ETH"


def act_sell(pk, who):
    bal = thaler_of(who)
    if bal < 20_000:
        return None
    amt = int(bal * random.uniform(0.05, 0.3))
    wei = amt * 10**18
    if int(call(DEPLOY["token"], "allowance(address,address)(uint256)", who, DEPLOY["router"])) < wei:
        ok, h, g = send(pk, DEPLOY["token"], "approve(address,uint256)", DEPLOY["router"], 2**255, gas=GAS["approve"])
        if not ok:
            return (ok, h, g), "approve router"
    dl = int(time.time()) + 1200
    return send(pk, DEPLOY["router"], "swapExactIn(bool,uint256,uint256,address,uint256)",
                "false", wei, 0, who, dl, gas=GAS["swap"]), f"sell {amt:,} THALER"


def charters_of(who):
    """Charter ids held by `who`, found via the on-chain totals (ids are sequential, burned ones revert)."""
    total = int(call(DEPLOY["charter"], "totalMinted()(uint256)"))
    mine = []
    for i in range(1, total + 1):
        try:
            if call(DEPLOY["charter"], "ownerOf(uint256)(address)", i).lower() == who.lower():
                mine.append(i)
        except RuntimeError:
            continue
    return mine


def act_mint(pk, who):
    minted = int(call(DEPLOY["charter"], "foundingMintedBy(address)(uint256)", who))
    if minted >= 3:
        return None
    price = int(call(DEPLOY["charter"], "FOUNDING_PRICE()(uint256)"))
    if balance_eth(who) < price / 1e18 + WALLET_FLOOR_ETH:
        return None
    return send(pk, DEPLOY["charter"], "mintFounding(uint256)", 1, value=price, gas=GAS["mint"]), "founding mint"


def act_auction(pk, who):
    left = int(call(DEPLOY["charter"], "auctionRemainingToday()(uint256)"))
    price = int(call(DEPLOY["charter"], "auctionPrice()(uint256)"))
    if left == 0 or balance_eth(who) < price / 1e18 * 1.05 + WALLET_FLOOR_ETH:
        return None
    return send(pk, DEPLOY["charter"], "buyAtAuction()", value=int(price * 1.03), gas=GAS["auction"]), f"auction buy at {price/1e18:.5f} ETH"


def act_withdraw(pk, who):
    ids = charters_of(who)
    random.shuffle(ids)
    for i in ids:
        pending = int(call(DEPLOY["centralBank"], "pending(uint256)(uint256)", i))
        if pending > 1000 * 10**18:
            return send(pk, DEPLOY["centralBank"], "withdraw(uint256)", i, gas=GAS["withdraw"]), f"withdraw charter #{i} ({pending/1e18:,.0f} pending)"
    return None


def act_branch(pk, who):
    ids = charters_of(who)
    random.shuffle(ids)
    price = int(call(DEPLOY["centralBank"], "licensePrice()(uint256)"))
    if int(call(DEPLOY["centralBank"], "licensesRemainingToday()(uint256)")) == 0:
        return None
    bal = int(thaler_of(who) * 1e18)
    for i in ids:
        br = int(call(DEPLOY["centralBank"], "branchesOf(uint256)(uint8)", i))
        if br < 10 and bal >= price:
            if int(call(DEPLOY["token"], "allowance(address,address)(uint256)", who, DEPLOY["centralBank"])) < price:
                ok, h, g = send(pk, DEPLOY["token"], "approve(address,uint256)", DEPLOY["centralBank"], 2**255, gas=GAS["approve"])
                if not ok:
                    return (ok, h, g), "approve bank"
            return send(pk, DEPLOY["centralBank"], "openBranch(uint256)", i, gas=GAS["branch"]), f"open branch on #{i} for {price/1e18:,.0f} THALER"
    return None


def act_tick(pk, who):
    unalloc = int(call(DEPLOY["treasury"], "unallocated()(uint256)"))
    last = int(call(DEPLOY["treasury"], "lastTick()(uint256)"))
    if unalloc == 0 and time.time() - last < 3600:
        return None
    return send(pk, DEPLOY["treasury"], "tick()", gas=GAS["tick"]), "treasury tick"


def act_roll(pk, who):
    cur = int(call(DEPLOY["centralBank"], "currentEpoch()(uint256)"))
    last = int(call(DEPLOY["centralBank"], "lastRolledEpoch()(uint256)"))
    if cur == 0 or last >= cur - 1:
        return None
    return send(pk, DEPLOY["centralBank"], "rollEpochs()", gas=GAS["roll"]), f"roll epochs (to {cur - 1})"


def weights(mood):
    base = {"buy": 26, "sell": 18, "withdraw": 14, "branch": 8, "mint": 7, "auction": 4, "tick": 12, "roll": 11}
    if mood == "expand":
        base["buy"] += 14; base["sell"] -= 8
    else:
        base["sell"] += 14; base["buy"] -= 10
    return base


ACTIONS = {"buy": act_buy, "sell": act_sell, "withdraw": act_withdraw, "branch": act_branch,
           "mint": act_mint, "auction": act_auction, "tick": act_tick, "roll": act_roll}


def pick(mood):
    w = weights(mood)
    names = list(w)
    return random.choices(names, weights=[max(1, w[n]) for n in names], k=1)[0]


# ---- funding ----
def fund(s=None, force=False):
    dep_pk, dep = ENV["DEPLOYER_PK"], ENV["DEPLOYER"]
    dep_bal = balance_eth(dep)
    moved = 0
    for name, pk in BOTS:
        who = addr_of(pk)
        bal = balance_eth(who)
        if bal < WALLET_FLOOR_ETH or force:
            if dep_bal - WALLET_REFILL_ETH < DEPLOYER_RESERVE_ETH:
                log(f"  deployer at {dep_bal:.4f} ETH, below reserve after refill: cannot fund {name}")
                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                if s is not None and s.get("low_notified") != today:
                    notify(f"⛽ Thaler: деплоеру нужен Sepolia ETH, боты не пополняются (осталось {dep_bal:.3f})")
                    s["low_notified"] = today
                return moved
            ok, h, g = send(dep_pk, who, "", value=int(WALLET_REFILL_ETH * 1e18), gas=21_000)
            log(f"  fund {name} {who[:10]} +{WALLET_REFILL_ETH} ETH ok={ok} {h}")
            dep_bal -= WALLET_REFILL_ETH + g
            moved += 1
    return moved


# ---- notify / heal ----
def notify(text):
    try:
        secrets = {}
        for line in (Path.home() / ".config/recordings/secrets.env").read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1); secrets[k.strip()] = v.strip().strip('"')
        import urllib.request, urllib.parse
        data = urllib.parse.urlencode({"chat_id": secrets["TELEGRAM_USER_ID"], "text": text}).encode()
        urllib.request.urlopen(f"https://api.telegram.org/bot{secrets['TELEGRAM_BOT_TOKEN']}/sendMessage", data, timeout=15)
    except Exception as e:  # notification failure must never break the bot
        log(f"  notify failed: {e}")


def heal(trace):
    if os.environ.get("THALER_NO_HEAL") == "1":
        log("  heal skipped (THALER_NO_HEAL=1)")
        return
    subprocess.Popen([sys.executable, str(HERE / "self_heal.py"), trace[-3000:]], cwd=str(HERE))


# ---- main ----
def run(force=False):
    s = state()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if s["day"] != today:
        s.update({"day": today, "tx_today": 0, "gas_eth_today": 0.0})
    now = time.time()
    if now > s.get("mood_until", 0):
        s["mood"] = random.choice(["expand", "expand", "contract"])
        s["mood_until"] = now + random.uniform(3, 9) * 3600
        log(f"mood -> {s['mood']} for {(s['mood_until']-now)/3600:.1f}h")
    if s["tx_today"] >= MAX_TX_PER_DAY or s["gas_eth_today"] >= MAX_GAS_ETH_PER_DAY:
        log(f"daily cap reached ({s['tx_today']} tx, {s['gas_eth_today']:.4f} ETH gas)")
        save(s); return
    if not force and random.random() > P_ACT:
        log("dice: quiet run")
        save(s); return

    fund(s)
    n_actions = 2 if random.random() < P_SECOND else 1
    for _ in range(n_actions):
        name, pk = random.choice(BOTS)
        who = addr_of(pk)
        # bootstrap: a wallet with no THALER buys first; one with THALER but no charter mints
        order = []
        if thaler_of(who) < 1000:
            order.append("buy")
        elif not charters_of(who):
            order.append("mint")
        tried = set()
        for _attempt in range(7):
            kind = order.pop(0) if order else pick(s["mood"])
            if kind in tried:
                continue
            tried.add(kind)
            if len(tried) == 6 and "buy" not in tried:
                kind = "buy"  # last resort: a buy is always possible while the wallet has ETH
            try:
                res = ACTIONS[kind](pk, who)
            except RuntimeError as e:
                log(f"  {name} {kind}: skipped ({str(e)[:160]})")
                continue
            if res is None:
                continue
            (ok, h, gas_eth), label = res
            s["tx_today"] += 1
            s["gas_eth_today"] += gas_eth
            s["totals"][kind] = s["totals"].get(kind, 0) + (1 if ok else 0)
            s["last"] = ([{"t": today, "who": name, "what": label, "ok": ok, "tx": h}] + s["last"])[:30]
            log(f"  {name} {label}: {'ok' if ok else 'REVERTED'} {h} gas {gas_eth:.6f} ETH")
            if not ok:
                s["totals"]["reverted"] = s["totals"].get("reverted", 0) + 1
            break
        time.sleep(random.uniform(5, 40))
    save(s)


def status():
    s = state()
    print(f"mood {s['mood']} · today {s['tx_today']} tx, {s['gas_eth_today']:.4f} ETH gas · totals {s['totals']}")
    dep = ENV["DEPLOYER"]
    print(f"deployer {dep[:10]} {balance_eth(dep):.4f} ETH")
    for name, pk in BOTS:
        who = addr_of(pk)
        print(f"{name} {who[:10]} {balance_eth(who):.4f} ETH · {thaler_of(who):,.0f} THALER · charters {charters_of(who)}")
    for x in s["last"][:6]:
        print(f"  {x['t']} {x['who']} {x['what']} {'ok' if x['ok'] else 'REVERTED'}")


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if not BOTS:
        sys.exit("no BOT_PK_* in .env.bots")
    if arg == "--status":
        status(); sys.exit(0)
    with open(LOCK, "w") as lk:
        try:
            fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("another run holds the lock"); sys.exit(0)
        try:
            if arg == "--fund":
                fund(state(), force=True)
            else:
                run(force=(arg == "--force"))
        except Exception as e:  # noqa: BLE001
            import traceback
            tb = traceback.format_exc()
            log("CRASH " + tb.replace("\n", " | ")[-800:])
            heal(tb)
            sys.exit(1)
