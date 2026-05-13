# Plan: #277/#278/#280/#281 — Sweep findings unified PR

## Context

Four sweep-finding consolidation issues:

- #277 (Sweep 1, foundation layer)
- #278 (Sweep 2, detector layer)
- #280 (Sweep 4, commands/wizard/worktree)
- #281 (tracker for #279 + #280 children)

## Triage results

**#280 + #281: NO CODE NEEDED.** All 23 children #305-#327 of #280 are CLOSED. All 23 children #282-#304 of #279 are CLOSED. Both #280 and #281 are bookkeeping closures.

**#277 (Sweep 1):**

- ALREADY FIXED via prior PRs: #2 (AI_TOOLS), #3+#4 (INV-ID drift — see INV-51 in AGENTS.md), #6 (mergeSettingsJson), #5 partial (now warns)
- DEFER (deeper redesign or wide ripple, file follow-up issues):
  - #1 fs.ts WriteResult action — 10+ test assertion + 5+ call site cascade
  - #11 UserFacingError class — new abstraction
  - #12 INV-32 `selfOnly?` — schema change
  - #13 alwaysActive cluster — needs ADR-028 equivalent
  - #9 languageDetail Partial — catalog backfill required (multiple entries with `languages:[...]` lack `languageDetail`)
- FIX in this PR: #7, #8, #10, #14 (SIGTERM), #16 (redundant mkdirSync)

**#278 (Sweep 2):**

- DEFER: #3 (silent swallow ENOENT — wide refactor), #7 (github runCmd), #8 (modules.ts readFileSync)
- FIX in this PR: #1 (Kotlin DSL), #2 (java sentinel), #5 (git regex dotted names), #6 (JAVA_NO_RAW_TYPES import), #9 (prettier substring)

## Existing Code Survey

No new files under src/. All changes are edits to existing files. CANON-16 N/A.

## Commit plan

1. `cluster(#278): detector fixes — Kotlin DSL + java sentinel + git regex + Java import hook + prettier exact-match`
2. `cluster(#277): foundation fixes — loadSnapshot migrate + maturity-check types + run-cli attempts + minor`
3. `chore(#280,#281): close trackers — all children merged`

## Gate strategy

L1 after each commit. L2 before push.
