# Conformance Scorecard — design notes

This document captures the design of the `arbiter conformance` scorecard dimensions
(`src/conformance/`). It is the human-readable companion to the code-computed probes.

## §1 — Purpose

`arbiter conformance` scores a project against the arbiter gold-pattern standard and
emits a per-dimension matrix (`Y` / `P` / `N` / `NA` / `NV` + evidence). The score is
**deterministic and code-computed, never AI-scored**: identical repo state ⇒ identical
result.

## §2 — Verdict scale

| Verdict | Meaning                                            |
| ------- | -------------------------------------------------- |
| `Y`     | pass                                               |
| `P`     | partial                                            |
| `N`     | fail                                               |
| `NA`    | not applicable (e.g. wrong archetype / not governed)|
| `NV`    | not verified (evidence not yet produced)           |

## §3 — Families and two-tier scoring

Dimensions are grouped into quality families, scored two-tier (tier-1 = must-pass gate;
tier-2 = weighted contributor):

- **reality-contact** — `D-TEST-LEVELS`, `D-LIVE-E2E`, `D-FE-RENDER-GATE`,
  `D-DOMAIN-API`, `D-DONE-EVIDENCE`
- **discipline** — `D-GATE-GREEN`, `D-COVERAGE-THRESHOLDS`, `D-INVARIANTS-ENFORCED`,
  `D-NO-OVERCLAIM`, `D-COMMIT-HYGIENE`, **`DISC-finding-hygiene`** (#1405)
- **docs-convention** — `DOC-README`, `DOC-CHANGELOG`, `DOC-ADR`, `DOC-CONTRIBUTING`,
  `DOC-LICENSE`, `DOC-API-DOCS`, `DOC-SECURITY`

The discipline family is equal-weight: adding `DISC-finding-hygiene` rebalances each
member's contribution. The conformance baseline is recaptured at integration time so the
ratchet folds in the new probe.

## §4 — Evidence

Every dimension entry carries an `Evidence` object (`file` + optional `line` + optional
`detail`). Evidence is a deterministic reference to the artifact the verdict was derived
from — never free prose. IO errors in any probe are caught and surfaced as a non-`Y`
verdict, never a crash (fail-safe).

## §5 — DISC-finding-hygiene (#1405)

`DISC-finding-hygiene` measures whether a project **drains** its incidental-findings
spool, not merely whether findings exist.

**Source of truth.** The per-shard findings spool `.arbiter/findings/*.jsonl` (#1401),
written by `arbiter note`. Each line is a `FindingEntry`
(`ts`/`note`/`kind`/`severity`/`foundDuring`/`file`/`line`/`sha`/`graphNode?`/`fingerprint`).
The probe is a **read-only consumer** — it never mutates the spool or the entry shape.

**Inputs.**

- `openFindingsCount` — distinct `fingerprint`s across all shards (dedup-safe; the same
  finding captured in two worktrees counts once).
- `unpromotedFindingsAge` — age in whole days of the **oldest** open finding (0 when the
  spool is empty/drained).
- A recorded prior snapshot `.arbiter/finding-hygiene-baseline.json`
  (`{ openFindingsCount }`) used to detect a count regression.

**Verdict ladder.**

| Condition                                          | Verdict |
| -------------------------------------------------- | ------- |
| spool directory absent                             | `NA`    |
| `openFindingsCount` rose vs the recorded prior     | `N`     |
| oldest open finding older than 14 days (no regress)| `P`     |
| drained (count 0) / fresh / non-regressing         | `Y`     |

**Threshold.** `FINDING_STALE_DAYS = 14` — a finding left un-promoted for longer than a
fortnight is stale and should be promoted (`arbiter findings promote`, #1403) or drained.

## §6 — Anti-gaming rationale (INV-114)

The headline must reward findings **CLOSED**, never findings **OPENED**. A naive
"findings tracked? → green" probe would invert the incentive: an agent could farm a green
signal by filing low-value notes. `DISC-finding-hygiene` is designed against that:

- **Mere presence of filed findings NEVER yields `Y` when the count regressed.** Filing
  N fresh findings without draining any raises `openFindingsCount`, which is a regression
  (`N`). Freshness alone does not buy a pass.
- **Spool absent → `NA`, never `N`.** A project that has never filed a finding is not
  penalised — absence of evidence is not evidence of debt.
- **Lower-is-better everywhere.** Both `openFindingsCount` and `unpromotedFindingsAge`
  are `lower-is-better` in the debt ratchet (`scripts/debt-baseline.json`), so the only
  way to improve the signal is to **drain** the spool (promote findings to tracked issues
  or fix them), never to file more.

This mirrors the debt-ratchet metrics added in `scripts/debt-lib.mjs`
(`collectFindingsMetrics`): the same spool, the same lower-is-better direction, the same
anti-gaming stance, evaluated by `debt-report.mjs --gate` (a rise without drain regresses
the gate).
