---
title: '#2733 finding promote drains the spool it files'
doc_version: '1.0.0'
status: review-ready
last_review: '2026-09-20'
owner: 'Luca Dominici'
canonical_id: 'task-2733-promote-drain'
tags: ['audience/agent', 'kind/plan']
related: ['#2733', '#2724', '#1401', '#1405', '#1948']
context:
  issue: '#2733'
  type: fix
  pipeline: 'plan -> impl -> gate -> PR'
  branch_convention: 'task/#NNN-kebab-description'
  base_branch: main
  key_constraints:
    - 'Tier Standard: core paths (src/), a Stop hook, and the debt-ratchet input'
    - 'tech-debt.json keeps its {issues:[...]} shape - gen-gap.mjs consumes it'
    - 'A finding inside its closed-issue cooldown is durable nowhere and must stay in the spool'
  red_team_warnings:
    - 'Draining a cooldown or deferred finding deletes it permanently'
    - 'Shard rewrite is a read-modify-write: a concurrent finding add between read and write is lost'
    - 'File mtime is not a recency signal for the Stop hook; the drain receipt carries its own ts'
  estimate: 'S (2h)'
files:
  - .agents/plan/2733-promote-drain.md
  - src/findings/operations.ts
  - src/cli.ts
  - src/templates/claude/hooks/stop-finding-loss.mjs.ejs
  - .claude/hooks/stop-finding-loss.mjs
  - __tests__/commands/findings-promote.test.ts
  - __tests__/hooks/empirical/stop-finding-loss.test.ts
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L3.json
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L4.json
  - .arbiter/evidence/tdd/#2733.json
---

# #2733 finding promote drains the spool it files

## Problem (measured on #2724)

`arbiter finding promote` files findings as issues and appends issue numbers to
`.arbiter/evidence/findings-promote/tech-debt.json`, but leaves every promoted entry in the
`.arbiter/findings/*.jsonl` spool. Two independent consumers read the spool alone:

| Consumer           | Location                                            | Reads                                 | Effect after promote                              |
| ------------------ | --------------------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| debt ratchet       | `scripts/debt-lib.mjs:391` `collectFindingsMetrics` | distinct spool fingerprints           | `openFindingsCount` stays high, gate red          |
| finding-loss guard | `.claude/hooks/stop-finding-loss.mjs`               | spool lines with `ts >= sessionStart` | after a manual drain, reports "nothing persisted" |

The two pull in opposite directions: the ratchet demands an empty spool, the guard demands a
non-empty one. Capturing a finding, which `.claude/rules/60-incidental-capture.md` requires,
turns the ratchet red and promoting it does not turn it green.

## Route selected

**(a) `finding promote` drains what it successfully resolved.** This matches the code's own
documented contract (`operations.ts:3`, `debt-lib.mjs:382` "rewards DRAINING the spool") and the
owner's manual remediation on #2724. Route (b), the metric subtracting the ledger, was rejected:
it leaves the spool growing forever and still leaves the Stop guard reading a stale signal.

Draining alone would break the Stop guard, so the drain writes an append-only, timestamped
receipt the guard can read: `.arbiter/evidence/findings-promote/drained.jsonl`, one
`{ts, fingerprint, issue, disposition}` line per drained finding. `tech-debt.json` keeps its exact
`{issues: number[]}` shape (`scripts/gen-gap.mjs:246` consumes it); the receipt is a sibling file,
not a schema change.

## Drain set per disposition

`promoteOne` returns five actions. Only entries whose durability is proven leave the spool:

| Action                                        | Durable where                                         | Drained |
| --------------------------------------------- | ----------------------------------------------------- | ------- |
| `promoted`                                    | new issue, number recorded in both ledger files       | yes     |
| `dropped`                                     | code is gone, the finding no longer describes reality | yes     |
| `skipped`, issue state `open`                 | the existing open issue tracks it                     | yes     |
| `skipped`, `recentlyClosed` (30-day cooldown) | nowhere; after cooldown it must be re-promotable      | no      |
| `deferred` (age-sweep, young)                 | nowhere yet                                           | no      |
| `failed`                                      | nothing filed; whole run aborts before any drain      | no      |

Today `promoteOne` collapses the two `skipped` states into one; draining them together would
permanently delete a finding inside its cooldown window. The action carries the reason so the
cooldown case stays in the spool.

`failed` returns `{ok:false}` before the drain step: a partial run drains nothing. Re-running is
safe, because the `arbiter-fp:` body marker makes `searchIssueByFingerprint` skip already-filed
findings.

## Approach

1. `src/findings/operations.ts`
   - `promoteOne` returns `{kind:'skipped', tracked: boolean}` (`tracked` = matched an open issue).
   - Collect `{fingerprint, issue?, disposition}` for every drainable action during the loop.
   - After a clean loop, `drainSpool(dir, drainable)` rewrites each shard, keeping every line whose
     parsed fingerprint is not in the drain set, then appends the receipt lines.
     Unparseable lines are kept: never delete what cannot be proven drained.
   - Return `drained: Outcome[]` so the caller can report it.
   - `ponytail:` note the read-modify-write ceiling (see Risks).
2. `src/cli.ts` prints `N drained` in the promote summary.
3. `.claude/hooks/stop-finding-loss.mjs` and its `src/templates/.../stop-finding-loss.mjs.ejs` twin
   (Track A + Track B, same PR) count drain-receipt lines with `ts >= sessionStartMs` alongside
   spool lines and agent returns. Extract the shared JSONL-since counter so both call one helper
   (duplication ratchet). `ts` is read from the record, never file mtime.
4. `scripts/debt-lib.mjs` is NOT changed: under route (a) the spool already means "still open".

## Acceptance Criteria

- [ ] AC-1: After a successful `finding promote`, every fingerprint it filed as a new issue is gone from `.arbiter/findings/*.jsonl`.
- [ ] AC-2: Fingerprints dropped as stale, and those skipped because an open issue already tracks them, are also drained; a fingerprint skipped inside the closed-issue cooldown and a deferred fingerprint remain in the spool byte-identical.
- [ ] AC-3: `collectFindingsMetrics` reports a lower `openFindingsCount` after promote without any change to `scripts/debt-lib.mjs`; a fully drained spool reports 0.
- [ ] AC-4: Each drained fingerprint is recorded in `.arbiter/evidence/findings-promote/drained.jsonl` with its timestamp, disposition and, when filed, issue number; `tech-debt.json` keeps its `{issues:[...]}` shape.
- [ ] AC-5: `stop-finding-loss.mjs` stands down when a session promoted-and-drained findings and captured nothing else, and still fires when a session dispatched at least 2 research agents and persisted nothing at all.
- [ ] AC-6: A failed issue creation drains nothing: the spool is byte-identical after an aborted run.
- [ ] AC-7: Spool lines that cannot be parsed are never removed by the drain.
- [ ] AC-8: The emitted hook twin (`.ejs`) and the self hook carry the same logic; bake snapshots are regenerated, not hand-edited.

## Non-Goals

- No change to `collectFindingsMetrics`, the ratchet, or the `tech-debt.json` schema.
- No new command, config key, dependency, or issue.
- No cross-process locking for the spool (see Risks).
- No change to the revalidation ladder, cooldown length, or age-sweep threshold.

## Test strategy

| AC         | Test                                                                                                  | Proof                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| AC-1, AC-2 | `__tests__/commands/findings-promote.test.ts`, replacing the existing "never rewrites the spool" case | promoted/dropped/open-skipped fingerprints removed; cooldown and deferred lines unchanged                  |
| AC-3       | same file, importing `collectFindingsMetrics` from `scripts/debt-lib.mjs`                             | count before > count after; drained-to-empty gives 0                                                       |
| AC-4       | same file                                                                                             | receipt lines parse and carry `ts`/`fingerprint`/`issue`; `tech-debt.json` still `{issues:[...]}`          |
| AC-5       | `__tests__/hooks/empirical/stop-finding-loss.test.ts`                                                 | drain receipt written after session start gives exit 0 and no message; nothing persisted gives the message |
| AC-6, AC-7 | `findings-promote.test.ts`                                                                            | byte-equality of the shard after a failing `createIssue`; malformed line survives a drain                  |
| AC-8       | existing emission and bake parity                                                                     | `npm run regen`                                                                                            |

## Risks

- Read-modify-write on the shards. Per-shard files exist so concurrent `finding add` appends do
  not contend; the drain rewrites a whole shard, so a line appended between read and write is lost.
  Accepted: promote is an explicit, operator-initiated, single-run command, and the write is one
  `writeFileTranslated` per shard. `ponytail:` whole-shard rewrite; move to a tombstone file if
  concurrent promote and add ever becomes real.
- The drain receipt lives under gitignored `.arbiter/**`, so a fresh clone has no history. The Stop
  guard only needs entries from the current session, so this is correct, not a gap.

## Rollback

Revert the commit: promote returns to append-only, the spool keeps every entry, both consumers read
exactly what they read today.
