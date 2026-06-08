---
generated: true
source: 'docs/GOVERNANCE/LABELS.md'
source_sha: '3388833dfc804bba742e0462022d0e143d1149fb'
last_updated: '2026-06-08'
---

# arbiter Label Catalogue

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/GOVERNANCE/LABELS.md](../docs/GOVERNANCE/LABELS.md)

# arbiter Label Catalogue

**Principle:** _no scopo → no label._ Every label in arbiter's canonical set has a
**consumer** — automation that applies/reads it, a gate, or a documented process.
Labels with no consumer are removed (see [Removed labels](#removed-labels)).

## Single source of truth

| File                                  | Scope                                                                 |
| ------------------------------------- | --------------------------------------------------------------------- |
| `src/templates/github/labels.yml.ejs` | **Canonical** set emitted into every generated repo (kit-block gated) |
| `.github/labels.yml`                  | arbiter-self's own labels (the ALWAYS subset; no kit-block)           |

`_label-sync.yml` reconciles `.github/labels.yml` into the live repo on push to
`main` using `gh label create --force` — it is **create/update-only and never
prunes**. Removing a label from the file does not delete it from the live repo;
deletions are performed manually (`gh label delete`) and are out of `_label-sync`'s
remit by design (a pruning sync would nuke project-specific and GitHub-default
labels in every generated consumer repo).

Each row below cites its consumer. When you add a label, add its consumer here too,
or it is bloat.

## ALWAYS — emitted for every governance level

| Label                                                                                           | Track | Consumer (evidence)                                                                                                                      | Class              |
| ----------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `size: XS` / `size: S` / `size: Standard`                                                       | both  | `TASK_SIZE_LABELS` `src/generators/labels.ts`; provisioned at `arbiter init`; `taskTiers` enum `{XS,S,Standard}` (`src/wizard/types.ts`) | automated          |
| `approved-by-human`                                                                             | both  | applied by `_label-on-approve.yml`; **gate** asserted by `_ai-draft-check.yml` (INV-91 AI-PR gate)                                       | gate               |
| `tier: T2` / `tier: T3` / `tier: T4`                                                            | both  | `docs/SYSTEM/CI-TIER-MODEL.md` — CI-tier triage marker                                                                                   | documented-process |
| `heartbeat-nightly-missed` / `heartbeat-weekly-missed` / `heartbeat-monthly-missed`             | both  | filed by `09-heartbeat.yml` when a scheduled workflow misses its freshness window                                                        | automated          |
| `kit-drift`                                                                                     | both  | filed by `kit-self-canary.yml` on KIT catalog drift                                                                                      | automated          |
| `nightly-regression` / `weekly-regression` / `monthly-regression`                               | both  | filed by `06-nightly.yml` / `07-weekly.yml` / `08-monthly.yml` on gate-fail                                                              | automated          |
| `track: core` / `track: templates` / `track: kit` / `track: docs` / `track: ci` / `track: meta` | both  | `docs/METHOD/TRACK_MODEL.md` — dual-track canon issue routing                                                                            | documented-process |
| `tech-debt`                                                                                     | both  | applied by `arbiter task record-tech-debt` (`src/commands/task-record-tech-debt.ts`)                                                     | automated (CLI)    |
| `follow-up`                                                                                     | both  | lifecycle marker (`POST_MERGE_REVIEW_TEMPLATE`, `CANON.md`)                                                                              | documented-process |
| `blocked`                                                                                       | both  | lifecycle marker                                                                                                                         | documented-process |
| `in-progress`                                                                                   | both  | removed by `issue-state.yml` on PR open (manual start state of the in-progress→in-review→closed cycle)                                   | automated          |
| `in-review`                                                                                     | both  | applied by `issue-state.yml` on PR open, removed on close                                                                                | automated          |
| `stale`                                                                                         | both  | added/removed by `_pr-staleness.yml`                                                                                                     | automated          |
| `no-stale`                                                                                      | both  | **gate** read by `_pr-staleness.yml` to exempt a PR from staleness sweeps                                                                | gate               |
| `governance`                                                                                    | both  | applied by the `compliance-item` issue template; governance-change entry point (`docs/GOVERNANCE/index.md`)                              | automated          |

## KIT-BLOCK — emitted only when `kitEnabled` (quality program + standard triage)

| Label                                          | Consumer (evidence)                                           | Class              |
| ---------------------------------------------- | ------------------------------------------------------------- | ------------------ |
| `quality`                                      | quality-program marker (kit-install)                          | documented-process |
| `deferred`                                     | wave-deferral triage                                          | documented-process |
| `needs-info`                                   | triage convention                                             | documented-process |
| `bug`                                          | applied by the `bug-report` issue template                    | automated          |
| `enhancement` / `chore` / `documentation`      | issue-type triage convention                                  | documented-process |
| `compliance`                                   | applied by the `compliance-item` issue template               | automated          |
| `security` / `performance` / `breaking-change` | triage convention                                             | documented-process |
| `P0` / `P1` / `P2`                             | priority triage convention                                    | documented-process |
| `duplicate` / `wontfix` / `invalid`            | GitHub resolution convention                                  | documented-process |
| `good first issue` / `help wanted`             | `docs/GOVERNANCE/GOOD-FIRST-ISSUE-POLICY.md` curation process | documented-process |

> The KIT-BLOCK triage labels have no _workflow gate-reader_; their consumer is a
> documented triage process or an issue template. They are retained as conventional
> GitHub labels. A future task may revisit them under a strict reading.

## Removed labels

Deleted in #1131 — no consumer found anywhere (workflow, gate, CLI, or documented process):

| Label

_[content truncated — see source for full text]_
