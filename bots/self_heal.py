#!/usr/bin/env python3
"""Self-heal for the Thaler activity bot: one attempt, headless Claude, one line to Telegram.

  python3 self_heal.py "<traceback>"

Guards: anti-recursion (THALER_NO_HEAL=1 on the verification run), budget cap, timeout.
Root-cause detail goes to logs/self_heal.log only.
"""
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CLAUDE = Path.home() / ".local/bin/claude"
TIMEOUT = 900
LOG = ROOT / "logs" / "self_heal.log"
sys.path.insert(0, str(HERE))
from activity import notify  # noqa: E402


def log(msg):
    with open(LOG, "a") as f:
        f.write(f"{datetime.now(timezone.utc).isoformat()} {msg}\n")


def main(trace):
    if os.environ.get("THALER_NO_HEAL") == "1":
        log("skip: already healing"); return 0
    notify("🔧 Thaler activity bot упал, чиню сам")
    log("CRASH:\n" + trace)
    brief = (f"The Thaler testnet activity bot at {HERE}/activity.py crashed under launchd.\n\nTraceback:\n{trace}\n\n"
             "Read GOTCHAS.md in the project root first. Find the root cause and fix it in the bot code "
             "(never touch contracts/ or web/). Then verify with `THALER_NO_HEAL=1 python3 activity.py --status` "
             "and `THALER_NO_HEAL=1 python3 activity.py --force`. Do not invent a bug if the cause is an RPC outage: "
             "in that case make the bot tolerate it (skip the run, log, exit 0). Reply with two lines: cause, fix.")
    env = {**os.environ, "THALER_NO_HEAL": "1"}
    env.pop("CLAUDECODE", None)
    try:
        r = subprocess.run([str(CLAUDE), "-p", "--permission-mode", "bypassPermissions", "--output-format", "text",
                            "--max-turns", "40", "--max-budget-usd", "3", brief],
                           cwd=str(HERE), capture_output=True, text=True, timeout=TIMEOUT, env=env)
        log("claude: " + (r.stdout or r.stderr)[-1500:])
    except subprocess.TimeoutExpired:
        log("claude: timeout")
    chk = subprocess.run([sys.executable, str(HERE / "activity.py"), "--status"], cwd=str(HERE),
                         capture_output=True, text=True, timeout=300, env=env)
    if chk.returncode == 0:
        notify("✅ Thaler activity bot починил сам, работает"); log("verify ok"); return 0
    notify("⚠️ Thaler activity bot не починился, детали в ~/thaler/logs/self_heal.log")
    log("verify failed: " + (chk.stderr or chk.stdout)[-800:]); return 1


if __name__ == "__main__":
    sys.exit(main(" ".join(sys.argv[1:]) or "(no trace)"))
