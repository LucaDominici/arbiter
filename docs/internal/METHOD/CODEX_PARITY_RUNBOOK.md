---
title: 'Codex Parity Runbook — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-07-16'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/runbook']
related: []
---

# Codex Parity Runbook

Operational guide for the codex-track parity contract (ADR-106, #1966): how to
run the gate, what each check proves, what to do when it goes red, and how to
extend the parity surface safely. Operator-facing summary:
`website/problems/codex-parity.md`.

---

## One-command local run

```bash
node scripts/check-codex-parity.mjs
```

The check bakes a pinned fixture project (TypeScript scaffold, `init --yes
--tools claude,codex --level L2`) into a unique tmpdir via the real CLI, runs
every parity check against that bake, prints findings plus the
`parity-surface: N/N (100%)` line, and removes the tmpdir.

Inside the repo gate it runs at **L2** (`gate`):

```bash
node scripts/check-all.mjs gate    # L2 gate — includes 'codex parity (#1966)'
make gate                          # identical: the Makefile target delegates to check-all gate
```

Both invocations are equivalent (INV-59 local↔CI parity); the CI counterpart
is the `gate-full` job. Exit codes follow the repo contract (INV-53):

| Exit | Meaning |
| ---- | ------- |
| 0    | PASS — parity surface 100% classified, no findings |
| 1    | FAIL — at least one parity violation (see playbook below) |
| 2    | ERROR — environment/config problem, **fail-closed** (e.g. merge-base unresolvable, missing data file) |

Sample failure output:

```
  [derived-drift] .agents/rules/90-exec-protocol.md: codex derivation diverges from canonical claude source .claude/rules/90-exec-protocol.md (first diff at line 33) — fix the derivation, never hand-edit the codex copy
check-codex-parity: parity-surface: 75/75 (100%)
check-codex-parity: FAIL — 1 finding(s); see website/problems/codex-parity.md for the failure playbook
```

---

## What each check proves

| Check (finding kind) | Bug-class it prevents |
| -------------------- | --------------------- |
| `derived-drift` | A shared rule's Codex copy silently diverging from the canonical Claude template — the exact #1966 incident (Codex `90-exec-protocol` lost the CANON-22 hard stop) |
| `golden-mismatch` / `golden-unjustified` | Generated-vs-generated circularity: output is compared to committed, reviewed goldens; goldens rewritten without a canonical-source change are refused (hardening 6/15) |
| `unclassified` | A new emission nobody classified — the silent-gap class that let 14 Claude hooks go undocumented |
| `multi-class` | Ambiguous classification resolved by precedence instead of review (hardening 4) |
| `stale-allowlist` / `allowlist-hash-mismatch` | An "intentional divergence" entry outliving (or drifting beyond) the divergence it approved |
| `stale-exclusive` | A BY-DESIGN-EXCLUSIVE declaration surviving the file it declared |
| `manifest-extra` / `manifest-missing` | Generator output escaping the registry view, or registered files not actually emitted (hardening 2: scan is the independent denominator) |
| `known-limitations-missing` / `known-limitations-stale` | The CODEX.md Known Limitations table drifting from the ACTUAL baked hook inventory (it documented 10 hooks while 24 were emitted) |
| `empty-track` | A vacuously green run over zero files (hardening 3) |
| `baseline-drift` / `baseline-removed` | Unreviewed surface changes; shrinkage is compared against the baseline **at merge-base** so editing output and baseline in the same change stays red without a removal record (hardening 14) |
| `schema` | Malformed data files driving the checks |

---

## Failure playbook (decision tree)

Drift found — decide which branch you are on:

- **(a) Unintended divergence** (`derived-drift`, `golden-mismatch`): fix the
  derivation or the canonical template under `src/templates/claude/rules/`.
  **Never hand-edit the generated codex copy** — it does not exist as a
  template anymore; the Codex generator renders the Claude source directly.
- **(b) Intended divergence**: add an entry to
  `scripts/data/codex-parity-allowlist.json` with `reason`, both
  content hashes (`sha256` of the normalized contents), and — in the SAME
  commit — its staleness coverage (the gate already fails on healed/drifted
  entries; add a targeted test if the divergence has behavior worth pinning).
- **(c) New emission unclassified** (`unclassified`): classify it before the
  gate will pass — either wire it as DERIVED (add the pair to
  `DERIVED_PAIRS` + a golden), allowlist it (branch b), or declare it
  BY-DESIGN-EXCLUSIVE in `scripts/data/codex-parity-exclusive.json` with an
  id and a real reason.
- **Known-limitations findings**: never edit the table by hand — it is
  generated. Add/fix the descriptor in
  `src/generators/codex-known-limitations.ts` (a hook without a descriptor
  fails generation, by design).
- **Baseline findings**: review the surface change, then
  `node scripts/check-codex-parity.mjs --update-baseline` and commit the data
  file. A REMOVED file additionally needs a
  `removals: [{file, reason, issue}]` record in the baseline — unexplained
  shrinkage stays red even if you regenerate.

---

## Golden evolution protocol (hardening 15)

A legitimate canonical-source change that shifts goldens requires, in one
branch:

1. Change the canonical template under `src/templates/claude/rules/`.
2. Regenerate the affected golden(s) into a scratch dir, inspect the semantic
   diff, and copy the reviewed result into
   `__tests__/fixtures/codex-parity/golden/` — the golden diff is part of the
   PR review.
3. Reference the canonical-change commit + reason in the update commit.

The gate refuses goldens **modified** without any `src/templates/claude/`
change in the same branch (`golden-unjustified`). There is deliberately no
`--update-goldens` convenience flag in the gate path; blind bulk regeneration
is a review rejection.

---

## Merge-base prerequisite (hardening 17)

The baseline anti-shrinkage check resolves `git merge-base origin/main HEAD`
and reads the baseline at that commit via `git show`. When the ref or history
is missing (shallow clone), the check **fails closed** with exit 2 and
remediation text — it never skips silently. Prerequisites:

- CI: `actions/checkout` with `fetch-depth: 0` (the `gate-full` job on this
  repo already does this).
- Local/other contexts: `git fetch origin main` before running the gate.
- Bootstrap (baseline not yet existing at merge-base) is recognized and passes
  the shrinkage step only — all other checks still run.

---

## Coverage interpretation (two axes)

- **Axis 1 — checker code coverage**: `codex-parity-lib.mjs` and
  `check-codex-parity.mjs` are exercised by dedicated suites
  (`__tests__/scripts/codex-parity-lib.test.ts`,
  `__tests__/scripts/check-codex-parity.test.ts` — unit, mutation,
  fail-closed, concurrency, E2E). Note: the repo's v8 coverage gate
  deliberately measures **product code only** and excludes `scripts/**`
  (see `vitest.config.ts`), so these two files do not enter the numeric
  ratchet; their coverage is enforced by the suites above being part of the
  L1 unit gate. The generator-side modules
  (`src/generators/codex-known-limitations.ts`, `codex.ts`, `claude.ts`) ARE
  product code and sit inside the existing coverage gate + ratchet (#1483).
- **Axis 2 — parity-surface coverage**: computed by the check itself at gate
  time (`parity-surface: N/N (100%)`); anything below 100% is already a
  failure via `unclassified`/`multi-class` findings. The ratchet blocks
  surface shrinkage via the merge-base baseline.

---

## Extension procedure

Adding a **new shared rule** (derived into the Codex track):

1. Author the rule once under `src/templates/claude/rules/`.
2. Add it to `planClaudeRules` (src/generators/claude.ts) and to
   `CODEX_DERIVED_RULES` (src/generators/codex-known-limitations.ts).
3. Add the pair to `DERIVED_PAIRS` (scripts/lib/codex-parity-lib.mjs) and
   commit the golden under `__tests__/fixtures/codex-parity/golden/rules/`.
4. `node scripts/check-codex-parity.mjs --update-baseline`, commit the
   baseline change.
5. Run the parity suite:
   `npx vitest run __tests__/scripts/check-codex-parity.test.ts __tests__/scripts/codex-parity-lib.test.ts`

Adding a **new codex-only emission**: emit it from the codex generator, add a
BY-DESIGN-EXCLUSIVE declaration with reason, update the baseline.

Adding a **new Claude hook**: give it a descriptor in
`codex-known-limitations.ts` (generation fails closed without it), decide
bridged/gate/manual honestly, update the baseline.
