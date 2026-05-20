---
title: 'Case study: arbiter governs arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Case study: arbiter governs arbiter

**Issue:** #651 (R1.O1)
**Repo:** [LucaDominici/arbiter](https://github.com/LucaDominici/arbiter)

The most credible signal a governance framework can produce is using it on
itself. arbiter's own development is governed by arbiter. This page documents
how that recursion works in practice — the governance level applied, which
invariants have actually fired during arbiter's development, how the
meta-config is structured, and where to find the public evidence trail.

---

## Governance level

arbiter applies **L2** to itself, not L3.

| Setting                     | Value                                                    |
| --------------------------- | -------------------------------------------------------- |
| `governanceLevel`           | `L2`                                                     |
| `features.debtGates`        | `true`                                                   |
| `features.mutationTesting`  | `true`                                                   |
| `features.securityScanning` | `true`                                                   |
| `features.soloDevMode`      | `true` (relaxes review-agent count; gates stay intact)   |
| `invariantTiers`            | `["architectural", "governance", "data", "operational"]` |
| `archetype`                 | `library`                                                |
| `lanes`                     | `["docs"]`                                               |

L3 is the framework's strictest preset (mandatory contract testing,
evidence-harness, mutation score floor at 80%). arbiter ships L2 on itself
because the docs/contract test surface for a CLI tool is narrower than for a
service — but the L2 invariant tiers (architectural + governance + data +
operational) are the same ones any consumer project gets.

Source of truth: [`arbiter.json`](https://github.com/LucaDominici/arbiter/blob/main/arbiter.json).

---

## Invariants that actually fired during development

These are not theoretical — every one of the following has blocked an arbiter
PR or commit at some point in the repo's history.

| INV ID   | Catalog name                    | Concrete enforcement                                                                                                                                                                                  |
| -------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-04   | `no-any-type`                   | `.claude/hooks/check-no-any.mjs` blocks every `Edit`/`Write` introducing TypeScript `any` (or `as any`).                                                                                              |
| INV-06   | `no-orphan-todos`               | `.claude/hooks/check-no-orphan-todo.mjs` rejects `TODO`/`FIXME` without a `(#NNN)` issue reference.                                                                                                   |
| INV-12   | `no-direct-spawn`               | `.claude/hooks/check-no-direct-spawn.mjs` requires all `child_process` use to route through `src/utils/run-cli.ts`. PII variants of the same INV block `git config user.email` in commit/log writers. |
| INV-21   | `no-placeholder-leak`           | `.claude/hooks/check-no-placeholders.mjs` blocks committing `// FIXME placeholder` patterns left in code.                                                                                             |
| INV-32   | `matrix-fixture-policy`         | `scripts/check-matrix-fixtures.mjs` refuses to promote any language → `proven` in `cross-language-matrix.json` without at least one real-project fixture.                                             |
| INV-59   | `parity-content-hash`           | The local L2 gate and the CI lane must compute identical content hashes for non-excluded checks; divergence trips the parity drill.                                                                   |
| CANON-04 | `every-new-ejs-has-render-test` | New `.ejs` templates fail the L1 gate (`template tests`) until a render assertion is added under `__tests__/templates/`.                                                                              |
| CANON-16 | `refactor-first-survey`         | Every new file under `src/` requires an "Existing Code Survey" block in the task plan documenting which existing function was rejected for extension and why.                                         |

The full catalogue lives at
[`src/invariants/catalog.ts`](https://github.com/LucaDominici/arbiter/blob/main/src/invariants/catalog.ts);
each entry there names the enforcement file that actually trips it.

---

## How the meta-config works

There is one `arbiter.json` that governs arbiter itself, plus the same
templated `arbiter.json` that arbiter emits when run on a consumer project.
The relationship:

```
arbiter.json                        ← arbiter governing arbiter (this repo)
src/templates/arbiter.json.ejs      ← what arbiter renders into consumer repos
src/utils/config.ts                 ← the loader/migrator that reads both
```

Both files go through the same `loadConfig` + `migrate` chain
(`src/config/migrations/{v0-to-v1,v1-to-v2}.ts`), so when the schema changes,
arbiter's own config is the first migration victim. This is on purpose: any
schema break that would break a consumer project breaks arbiter first.

Snapshot durability is layered on top — `.arbiter-generated.json` wraps the
active config in a SHA-256 envelope (`src/state/envelope.ts`) with versioned
storage migrations (`src/state/migrations/`) and per-write backup rotation
(`src/state/backups.ts`). Tamper or corruption is repairable with
`arbiter doctor --repair-state`. See
[`docs/REFERENCE/state-file.md`](../REFERENCE/state-file.md).

The CI lane and the local lane run the same `scripts/check-all.mjs`. The
parity-content-hash invariant (INV-59) trips when the two diverge.

---

## Public evidence trail

| Surface                       | What's there                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `AGENTS.md` (repo root)       | Canonical governance: invariants list, hard stops, agent protocol.                    |
| `.claude/hooks/`              | The actual enforcement edge — readable source for every blocking hook.                |
| `.evidence/` (gitignored)     | Per-command run records (cmd, args, exit, headSha) appended by every CLI invocation.  |
| `.arbiter/`                   | Local-only runtime state — gate markers, plan-review evidence (#695), backups (#619). |
| `docs/SYSTEM/CANON.md`        | The 15 CANON-NN process rules audited from waves #151–#186.                           |
| `docs/SYSTEM/DECISIONS.md`    | Architecture decision records (ADRs) — every non-trivial structural choice.           |
| `scripts/check-all.mjs`       | The full gate command — L1 (every commit) and L2 (every push) lanes.                  |
| GitHub Actions                | Every PR runs the same `check-all.mjs` lanes as a developer's local pre-push.         |
| `package.json` `scripts.test` | Vitest suite — 5000+ assertions, all green on `main`.                                 |

The knowledge-map graph (`scripts/build-knowledge-map.mjs`, R1.O2) and the
notary system (`docs/SYSTEM/NOTARY.md`, R1.O3) extend this with cross-reference
graphs and semantic doc-drift tracking. Both are gated.

---

## Recursion limits

arbiter does NOT govern itself in three places, and the limits are documented
because they're constraints, not omissions:

1. **No telemetry.** arbiter ships zero outbound telemetry. The
   `anti-telemetry` L1 check (`scripts/check-anti-telemetry.mjs`) blocks
   merges that add a phone-home. The case study cannot include adoption
   metrics for that reason.
2. **No external review service.** Plan reviews are dispatched locally via
   `claude -p` (#695); arbiter never POSTs project source to a third party.
3. **Pre-edit hooks ≠ post-merge audits.** The hook layer catches what it
   catches at edit time, but the gate is still the authority. A skipped
   hook (`--no-verify`) is detected by the gate; a skipped gate is the only
   way to break the loop, and is a documented hard-stop.

---

## Where to read next

### Self-governance artifacts (#652–#655)

- [Public evidence trail](arbiter-itself-evidence.md) — scrubbed snapshot of gate evidence (#653)
- [Nightly canary](arbiter-itself-canary.md) — drift detection: does `arbiter init --dry-run` produce changes? (#654)
- [Governance index](../GOVERNANCE/index.md) — ADRs, AGENTS.md, RACI in one place (#652)

### Incident case studies (#655)

Real invariant firings during arbiter's own development:

1. [INV-04: `any` ban catching an unsafe cast](incidents/01-inv04-any-ban-unsafe-cast.md)
2. [INV-06: orphan TODO caught at milestone closeout](incidents/02-inv06-orphan-todo-milestone-closeout.md)
3. [INV-12: PII + direct spawn caught in a generator](incidents/03-inv12-no-pii-generator.md)
4. [INV-32: matrix fixture parity blocking a `beta → proven` promotion](incidents/04-inv32-matrix-fixture-parity.md)
5. [CANON-16: refactor-first saving an avoidable file creation](incidents/05-canon16-refactor-first-saving-file.md)

### Reference

- [`AGENTS.md`](../../AGENTS.md) — canonical invariants + governance.
- [`docs/SYSTEM/CANON.md`](../SYSTEM/CANON.md) — 15 process rules.
- [`docs/PLUGIN-API.md`](../PLUGIN-API.md) — the public plugin surface, with stability markers.
- [`docs/CHANNELS.md`](../CHANNELS.md) — npm release channels (stable / beta / canary).
- [`docs/REFERENCE/state-file.md`](../REFERENCE/state-file.md) — `.arbiter-generated.json` envelope + repair.
