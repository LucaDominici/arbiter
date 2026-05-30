#!/usr/bin/env bash
#
# cleanup-orphan-boards.sh — purge 152 orphan project boards left by arbiter
# on the LucaDominici GitHub account.
#
# Context: Wave 0 smoke test finding F11 (.arbiter/wave0/haben-smoke-test.md).
# Snapshot of current account state preserved at:
#   .arbiter/wave0/evidence/gh-projects-snapshot.json
#
# Policy:
#   * DRY-RUN by default. Pass --execute to actually delete.
#   * Preserves #1 "Viafera Backlog" (75 items, real user content).
#   * Deletes any board whose title matches one of: "arbiter Board",
#     "viafera Board", "haben Board" (the three names arbiter has used).
#   * If a board with one of those titles ever has items > 0, it is SKIPPED
#     and reported — manual review required before deletion.
#   * Output: per-board action line; final summary.
#
# Safety:
#   * Run --dry-run first. Diff the planned list against the snapshot.
#   * Verify gh auth status user before --execute.
#   * Once executed, deletions are irreversible. There is no undo.
#
# Authored: 2026-05-26 (Wave 0 smoke test follow-up)
# Operator: Luca (Claude does not execute this; DEC-005 + safety policy)

set -euo pipefail

OWNER="${GH_OWNER:-LucaDominici}"
EXPECTED_USER="$OWNER"
DRY_RUN=true
LIMIT=300

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) DRY_RUN=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --owner) OWNER="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

# Pre-flight 1: gh authenticated as expected user
actual_user="$(gh api /user --jq .login 2>/dev/null || true)"
if [[ "$actual_user" != "$EXPECTED_USER" ]]; then
  echo "FATAL: gh authenticated as '$actual_user', expected '$EXPECTED_USER'." >&2
  echo "       Run 'gh auth login' as the right user and retry." >&2
  exit 1
fi
echo "gh user: $actual_user (matches expected $EXPECTED_USER)"

# Pre-flight 2: fetch current project list
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
gh project list --owner "$OWNER" --limit "$LIMIT" --format json > "$tmp"

total="$(jq '.projects | length' "$tmp")"
echo "Total project boards on $OWNER: $total"

# Selection: titles arbiter has used; items must equal 0; number != 1
selected="$(jq -r '
  .projects[]
  | select(.title == "arbiter Board" or .title == "viafera Board" or .title == "haben Board")
  | select(.items.totalCount == 0)
  | select(.number != 1)
  | "\(.number)\t\(.title)\t\(.url)"
' "$tmp")"

skipped="$(jq -r '
  .projects[]
  | select(.title == "arbiter Board" or .title == "viafera Board" or .title == "haben Board")
  | select(.items.totalCount > 0)
  | "\(.number)\t\(.title)\t\(.items.totalCount) items\t\(.url)"
' "$tmp")"

count_sel="$(printf '%s\n' "$selected" | grep -c . || true)"
count_skip="$(printf '%s\n' "$skipped" | grep -c . || true)"

echo
echo "Selected for deletion: $count_sel"
echo "Skipped (non-empty, manual review): $count_skip"
echo

if [[ -n "$skipped" ]]; then
  echo "SKIPPED boards (have items > 0, NOT touched):"
  printf '%s\n' "$skipped" | sed 's/^/  /'
  echo
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY-RUN — planned deletions (first 10 + last 5):"
  printf '%s\n' "$selected" | head -10 | sed 's/^/  DELETE  /'
  if [[ "$count_sel" -gt 15 ]]; then
    echo "  …"
    printf '%s\n' "$selected" | tail -5 | sed 's/^/  DELETE  /'
  fi
  echo
  echo "To actually delete, re-run with --execute."
  exit 0
fi

# Confirm before destructive run
echo "About to delete $count_sel project boards on $OWNER."
read -r -p "Type DELETE to confirm: " ans
if [[ "$ans" != "DELETE" ]]; then
  echo "Aborted (confirmation not given)."
  exit 130
fi

ok=0; fail=0
while IFS=$'\t' read -r number title url; do
  [[ -z "$number" ]] && continue
  if gh project delete "$number" --owner "$OWNER" >/dev/null 2>&1; then
    ok=$((ok+1))
    printf '  deleted #%s — %s\n' "$number" "$title"
  else
    fail=$((fail+1))
    printf '  FAILED  #%s — %s (%s)\n' "$number" "$title" "$url" >&2
  fi
done <<< "$selected"

echo
echo "Done. Deleted: $ok  Failed: $fail"
if [[ "$fail" -gt 0 ]]; then
  exit 1
fi
