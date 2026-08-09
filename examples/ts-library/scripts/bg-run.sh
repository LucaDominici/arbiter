#!/usr/bin/env bash
# bg-run.sh (#2103) — launch a long-running command DETACHED (survives the caller's
# session), recording {PID, exit code, log} for a coordinator-side pid-watch.sh.
#
# M16 terminal handoff — subagents never own waits: the WORKER's brief ends at
# commit + launch + a structured handoff {SHA, worktree, PID, exit-file, log} with
# an explicit END-TURN. All watches belong to the coordinator (pid-watch.sh, a
# background until-loop on the exit file). This helper replaces the raw nohup
# recipe (feedback_scoped_pid_wait): the detached process is invisible to harness
# child-tracking BY DESIGN, so the launching agent MUST end its turn after this
# returns — a foreground wait on this PID is exactly the parked-wait bug M16 bans.
#
# Usage: bg-run.sh <name> -- <command> [args...]
# Env:   BG_DIR (default .arbiter/bg) — where <name>.pid/.exit/.log land.
# Exit:  0 on successful DETACHED launch (the job keeps running after this returns).
set -euo pipefail

BG_DIR="${BG_DIR:-.arbiter/bg}"

if [ "${1:-}" = "--self-test" ]; then
  SELF_BG_DIR=$(mktemp -d)
  BG_DIR="$SELF_BG_DIR" "$0" selftest -- sh -c 'sleep 1; exit 7' >/dev/null 2>&1
  i=0
  while [ ! -f "$SELF_BG_DIR/selftest.exit" ] && [ "$i" -lt 50 ]; do
    sleep 0.1
    i=$((i + 1))
  done
  rc=""
  if [ -f "$SELF_BG_DIR/selftest.exit" ]; then
    rc=$(cat "$SELF_BG_DIR/selftest.exit")
  fi
  if [ "$rc" != "7" ]; then
    echo "bg-run.sh self-test FAILED: exit code not captured as 7 (got: ${rc:-none})" >&2
    rm -rf "$SELF_BG_DIR"
    exit 1
  fi
  rm -rf "$SELF_BG_DIR"
  echo "bg-run.sh self-test OK (detached launch + exit-code capture)"
  exit 0
fi

if [ "$#" -lt 3 ] || [ "$2" != "--" ]; then
  echo "Usage: bg-run.sh <name> -- <command> [args...]" >&2
  echo "       bg-run.sh --self-test" >&2
  exit 2
fi

NAME="$1"
shift 2
mkdir -p "$BG_DIR"
: >"$BG_DIR/$NAME.log"
# setsid: own session, fully detached (survives the caller's session end).
# nohup: ignore SIGHUP. The wrapper records the command's exit code into
# <name>.exit when it finishes — the only signal pid-watch.sh ever reads.
BG_EXIT="$BG_DIR/$NAME.exit" setsid nohup bash -c '"$@"; rc=$?; printf "%s" "$rc" > "$BG_EXIT"' \
  bash "$@" >"$BG_DIR/$NAME.log" 2>&1 &
echo $! >"$BG_DIR/$NAME.pid"

echo "bg-run: launched $NAME (pid $(cat "$BG_DIR/$NAME.pid"), exit-file $BG_DIR/$NAME.exit, log $BG_DIR/$NAME.log)"
