#!/usr/bin/env bash
# arbiter ship driver — stateless tick supervisor.
# State lives on GitHub (issues, labels, PRs) and in the arbiter engine's files;
# this loop holds none. One tick = one bounded agent run; a dead tick loses nothing.
# Sequencing, failure memory, and the 2-strike policy are engine-owned
# (`arbiter ship`, `arbiter ship-on-red`) — this script must never reimplement them.
set -euo pipefail

REPO_DIR="${1:?usage: supervisor.sh /path/to/repo}"
MAX_TICKS="${MAX_TICKS:-40}"
TICK_TIMEOUT="${TICK_TIMEOUT:-1500}"   # hard cap per tick, seconds
SHIP_TICK_SLEEP="${SHIP_TICK_SLEEP:-30}"
cd "$REPO_DIR"

for i in $(seq 1 "$MAX_TICKS"); do
  echo "=== tick $i/$MAX_TICKS $(date -Is) ==="
  # A failed or timed-out tick logs and CONTINUES — state is already persisted;
  # the next tick resumes from it. Only HALT or an empty backlog stop the loop.
  if ! timeout "$TICK_TIMEOUT" claude -p "$(cat .arbiter/ship/TICK_PROMPT.md)" \
    --permission-mode acceptEdits --max-turns 80; then
    echo "tick $i: exit/timeout — state persisted; next tick resumes"
  fi

  if [ -f .arbiter/ship/HALT ]; then
    echo "HALT: $(cat .arbiter/ship/HALT)"
    break
  fi

  # Backlog check is failure-tolerant: a GitHub hiccup must never kill the loop.
  if ! open=$(gh issue list --label 'ship' --state open --json number --jq 'length' 2>/dev/null); then
    echo "tick $i: backlog check failed — retrying next tick"
    sleep "$SHIP_TICK_SLEEP"
    continue
  fi
  if ! [[ "$open" =~ ^[0-9]+$ ]]; then
    echo "tick $i: backlog count unreadable — retrying next tick"
    sleep "$SHIP_TICK_SLEEP"
    continue
  fi
  if [ "$open" -eq 0 ]; then
    echo "Backlog drained."
    break
  fi
  sleep "$SHIP_TICK_SLEEP"
done
