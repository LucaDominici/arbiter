#!/usr/bin/env bash
# pid-watch.sh (#2103) — coordinator-side until-loop on a bg-run.sh exit file.
#
# M16 terminal handoff — subagents never own waits: ALL watches belong to the
# coordinator. This is the coordinator's wait primitive: it emits EXACTLY ONE
# stdout line when the job ends (the exit code), so the coordinator fires at
# most one notification per job. It reads the exit FILE, never process
# liveness — the launching agent's session is long gone by design (that is
# the point of bg-run.sh), so a PID-based wait would hang forever.
#
# Usage: pid-watch.sh <name> [--timeout-min N]
# Env:   BG_DIR (default .arbiter/bg) — must match the bg-run.sh invocation.
# Exit:  0 job finished; 1 job vanished without an exit code; 2 timeout/usage.
set -euo pipefail

BG_DIR="${BG_DIR:-.arbiter/bg}"
TIMEOUT_MIN=90

if [ "${1:-}" = "--self-test" ]; then
  # Fixture with NO live process at all — proves the watcher reads the exit FILE.
  SELF_BG_DIR=$(mktemp -d)
  printf '42' >"$SELF_BG_DIR/gate.exit"
  OUT=$(BG_DIR="$SELF_BG_DIR" "$0" gate)
  rm -rf "$SELF_BG_DIR"
  set +e
  LINES=$(printf '%s\n' "$OUT" | grep -c .)
  set -e
  if [ "$LINES" != "1" ]; then
    echo "pid-watch.sh self-test FAILED: expected exactly 1 line, got $LINES" >&2
    exit 1
  fi
  case "$OUT" in
    *42*) ;;
    *) echo "pid-watch.sh self-test FAILED: exit code missing in: $OUT" >&2
      exit 1 ;;
  esac
  echo "pid-watch.sh self-test OK (exactly one exit line)"
  exit 0
fi

NAME=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --timeout-min) TIMEOUT_MIN="$2"; shift 2 ;;
    *) NAME="$1"; shift ;;
  esac
done

if [ -z "$NAME" ]; then
  echo "Usage: pid-watch.sh <name> [--timeout-min N]" >&2
  echo "       pid-watch.sh --self-test" >&2
  exit 2
fi

PID_FILE="$BG_DIR/$NAME.pid"
EXIT_FILE="$BG_DIR/$NAME.exit"
LOG_FILE="$BG_DIR/$NAME.log"

START=$(date +%s)
while [ ! -f "$EXIT_FILE" ]; do
  # The process is gone but never wrote an exit code (e.g. SIGKILL): report it
  # instead of looping until timeout — silence is the failure mode M16 kills.
  if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "bg $NAME: gone without exit code (pid $pid, see $LOG_FILE)" >&2
      exit 1
    fi
  fi
  NOW=$(date +%s)
  if [ $((NOW - START)) -ge $((TIMEOUT_MIN * 60)) ]; then
    echo "bg $NAME: timed out after ${TIMEOUT_MIN} min (see $LOG_FILE)" >&2
    exit 2
  fi
  sleep 5
done

echo "bg $NAME: exited $(cat "$EXIT_FILE")"
