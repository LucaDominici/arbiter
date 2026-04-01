#!/usr/bin/env bash
# arbiter quality gate script
# Usage: ./scripts/check-all.sh [L1|L2]
# L1: format + lint + unit tests (fast, pre-commit)
# L2: L1 + coverage + audit (full, pre-push)

set -euo pipefail

LEVEL="${1:-L2}"
PASS="\033[0;32mPASS\033[0m"
FAIL="\033[0;31mFAIL\033[0m"
HEADER="\033[1;34m"
RESET="\033[0m"
FAILED=0

run_check() {
  local name="$1"; shift
  printf "${HEADER}[CHECK]${RESET} %s ... " "$name"
  if "$@" > /tmp/arbiter_check_output 2>&1; then
    printf "%b\n" "${PASS}"
  else
    printf "%b\n" "${FAIL}"
    cat /tmp/arbiter_check_output
    FAILED=$((FAILED + 1))
  fi
}

echo ""
printf "${HEADER}=== arbiter Quality Gate: %s ===${RESET}\n" "$LEVEL"
echo ""

# ─── L1: Fast checks ───────────────────────────────────────────────────────

run_check "typecheck"   npx tsc --noEmit
run_check "format"      npx prettier --check .
run_check "lint"        npx eslint src
run_check "unit tests"  npm test


# ─── L2: Full checks ────────────────────────────────────────────────────────
if [[ "$LEVEL" == "L2" ]]; then

  run_check "audit"       npm audit --audit-level=high

fi

echo ""
if [[ $FAILED -gt 0 ]]; then
  printf "${HEADER}=== FAILED: %d check(s) ===${RESET}\n\n" "$FAILED"
  exit 1
else
  printf "${HEADER}=== ALL PASSED ===${RESET}\n\n"
fi
