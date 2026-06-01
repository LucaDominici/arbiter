---
title: Follow-up — dual-ADR consolidation + CLI-ref gate (deferred from parity-gates wave)
type: audit
status: active
date: 2026-06-02
doc_version: '1.0.0'
last_review: '2026-06-02'
owner: ''
canonical_id: ''
tags: ['audience/auditor', 'audience/dev', 'kind/audit']
related: []
---

# Follow-up — dual-ADR consolidation + CLI-ref single-source gate

The "finish dual-ADR consolidation + anti-drift parity gates" task shipped its
**GLOBAL_INVARIANTS↔catalog parity gate** (INV-110, `scripts/check-global-invariants-parity.mjs`)
in this PR. The other three sub-items are recorded here for a careful follow-up
PR rather than rushed: a Step-0 analysis (3 read-only agents) revealed the ADR
store is in a **materially worse state than the task assumed**, and a botched ADR
migration loses architectural history. Splitting honors "no decision lost".

## DEFERRED — Item 1+2: collapse the dual ADR store + fix ID collisions

`docs/ADR/` (76 files) is canonical; `docs/SYSTEM/DECISIONS.md` (1420 lines, marked
FROZEN) holds parallel full-text for ~28 ADRs. Collapsing it is NOT a clean
"reduce to an index" — verified data-integrity problems:

### Orphaned decisions (full text ONLY in DECISIONS.md, no docs/ADR file) — extract FIRST

- `ADR-048` test taxonomy extension
- `ADR-049` operations handbook
- `ADR-051` (DECISIONS version) red-team SSOT alignment checks
- `ADR-052` (DECISIONS version) ISO 27001 / NIS2 / GDPR compliance gate mapping
- `ADR-050` (DECISIONS version) risk register + P×I — note: this decision was later
  re-filed as **ADR-074**; the DECISIONS entry uses the obsolete id.

### ID collisions (same id, DIFFERENT decision in DECISIONS.md vs docs/ADR/)

Each is a forensic-audit-era decision (DECISIONS.md lines ~22-327, dated 2026-05-14..16)
that was never migrated, while the id was later reused for a promoted decision:
| id | DECISIONS.md decision | docs/ADR/ file decision |
|----|----------------------|--------------------------|
| 043 | Matrix downgrade-vs-fix verdict | Docs Site IA (superseded by 075) |
| 044 | User-toggle catalog preconditions | Docs Site Versioning |
| 046 | MCP fallback determinism rule | Stack Adapter Model |
| 047 | evidence-prune + red-team SSOT alignment | Security Scanning Suite (M24) |
| 050 | Risk register + P×I (→074) | Pipeline Complexity Tiers |
| 051 | Red-team SSOT checks | Collaboration-Mode Axis |
| 052 | Compliance gate mapping | Fast-Forward Merge Policy |
| 055 | Frontend Governance (→073) | SpotBugs hard-block baseline |

### Safe migration plan (for the follow-up PR)

1. For each colliding/orphaned DECISIONS.md decision, determine whether its content
   already lives in docs/ADR/ under a DIFFERENT (later) id — if so it is a stale
   duplicate, drop from DECISIONS.md. If not, extract to a NEW docs/ADR file with
   the next free id (077+), populate `canonical_id`, add to the README index.
2. This is exactly what **INV-107** (`scripts/check-adr-index.mjs` — unique numbers,
   canonical_id, README sync) governs; run it after migration to prove convergence.
3. Reduce DECISIONS.md to a generated digest (one line per ADR → file link) OR delete
   it and repoint refs. Verify count of distinct decisions before == after (zero loss).
4. `verify graph` must show no orphan ADR node.

## DEFERRED — Item 4: CLI-ref single-source gate

`website/reference/cli.md` is **hand-written, no generator, no drift gate**.
Analysis: **0 phantom** commands (the task's assumed phantom governance/use/state/version
do not exist), but **~50 registered commands are undocumented** (report, review[+plan/code/diff],
verify[+evidence/plan/graph/tdd], graph[+build], trace, blame, integrations[+list],
task[+resume/advance/recover/record-red/record-tech-debt], work[+list/create/show/close/advance],
harness, knowledge-map, notary[+check/template], compare, gauntlet[+generate/verify],
ci[+plan/verify-plan], agent-rules[+export/verify], benchmark[+hooks], experiments[+list],
kit[+install/validate/generate]).

### Plan (for the follow-up PR)

1. Add a generator that introspects the registered command tree (commander `program.commands`
   from the built CLI, or parse `.command('...')` in `src/cli.ts` + `src/commands/`).
2. Regenerate cli.md from that list (each command + description + options).
3. Gate `scripts/check-cli-ref-parity.mjs` (L1): every registered command documented,
   no phantom. Wire into check-all; promote to an INV + AGENTS.md row.

## Convergence note

The ADR migration is an **INV-107 violation surfaced** (the gate that should have
caught it exists). Recommend the follow-up PR run `check-adr-index.mjs` first to
enumerate the exact violations as its work-list.
