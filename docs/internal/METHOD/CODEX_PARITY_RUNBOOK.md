---
title: 'Codex Parity Runbook — arbiter'
doc_version: '1.1.0'
status: active
last_review: '2026-07-17'
owner: ''
canonical_id: 'RB-02'
# handles: the invariants this runbook is the operational response to (RB-NN, #2480 wave 8).
# The parity gate's own contract: exit codes (INV-53) and the codex-track surface (INV-59). This runbook is what an operator does when check-codex-parity.mjs goes red.
handles: [INV-53, INV-59]
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

| Exit | Meaning                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------- |
| 0    | PASS — parity surface 100% classified, no findings                                                    |
| 1    | FAIL — at least one parity violation (see playbook below)                                             |
| 2    | ERROR — environment/config problem, **fail-closed** (e.g. merge-base unresolvable, missing data file) |

Sample failure output:

```
  [derived-drift] .agents/rules/90-exec-protocol.md: codex derivation diverges from canonical claude source .claude/rules/90-exec-protocol.md (first diff at line 33) — fix the derivation, never hand-edit the codex copy
check-codex-parity: parity-surface: 75/75 (100%)
check-codex-parity: FAIL — 1 finding(s); see website/problems/codex-parity.md for the failure playbook
```

---

## What each check proves

| Check (finding kind)                                    | Bug-class it prevents                                                                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `derived-drift`                                         | A shared rule's Codex copy silently diverging from the canonical Claude template — the exact #1966 incident (Codex `90-exec-protocol` lost the CANON-22 hard stop)                           |
| `golden-mismatch` / `golden-unjustified`                | Generated-vs-generated circularity: output is compared to committed, reviewed goldens; goldens rewritten without a canonical-source change are refused (hardening 6/15)                      |
| `unclassified`                                          | A new emission nobody classified — the silent-gap class that let 14 Claude hooks go undocumented                                                                                             |
| `multi-class`                                           | Ambiguous classification resolved by precedence instead of review (hardening 4)                                                                                                              |
| `stale-allowlist` / `allowlist-hash-mismatch`           | An "intentional divergence" entry outliving (or drifting beyond) the divergence it approved                                                                                                  |
| `stale-exclusive`                                       | A BY-DESIGN-EXCLUSIVE declaration surviving the file it declared                                                                                                                             |
| `manifest-extra` / `manifest-missing`                   | Generator output escaping the registry view, or registered files not actually emitted (hardening 2: scan is the independent denominator)                                                     |
| `known-limitations-missing` / `known-limitations-stale` | The CODEX.md Known Limitations table drifting from the ACTUAL baked hook inventory (it documented 10 hooks while 24 were emitted)                                                            |
| `empty-track`                                           | A vacuously green run over zero files (hardening 3)                                                                                                                                          |
| `baseline-drift` / `baseline-removed`                   | Unreviewed surface changes; shrinkage is compared against the baseline **at merge-base** so editing output and baseline in the same change stays red without a removal record (hardening 14) |
| `schema`                                                | Malformed data files driving the checks                                                                                                                                                      |

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

**Repo-mode vs fixture-mode.** The baseline ratchet and the golden-evolution
heuristic are defined against the arbiter repo's own history, so they run in
repo-mode only (the default invocation, and the gate path). In fixture mode
(`--baked-dir`, tests) the check states
`baseline: skipped — fixture mode (--baked-dir): not a repo context` and runs
the pure parity classification (including the nonzero-track non-vacuity
check). This is a loud, asserted skip — never a silent one — and the repo-mode
gate keeps the fail-closed contract above.

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

---

## Self-track parity (check-codex-self-parity)

The fixture gate above bakes into an **empty** directory, so it structurally
cannot see rot in arbiter's OWN materialized codex track. The rot vector is
real: the derived rules and the adapter are emitted with `skipIfExists: true`,
so once materialized, `arbiter update` never refreshes them in place — this is
how the repo's `.agents/rules/90-exec-protocol.md` lost the CANON-22 section
in self-config while the fixture gate stayed green. The self-track gate closes
that hole (ADR-106 addendum, 2026-07-17):

```bash
node scripts/check-codex-self-parity.mjs
```

It emits the codex track fresh via the repo's own generator + resolved config
into an empty tmpdir (dist-import pattern, same as `check-self-dogfood.mjs` —
a missing or unimportable `dist/` fails closed with exit 2; run
`npm run build` first), scans the emission against the repo's `.agents/**` +
`.codex/**`, and requires every repo file under those roots to be exactly one
of:

| Class            | Meaning                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| EMITTED-MATCH    | normalized content equals today's fresh emission                                                                                                 |
| PINNED           | intentional divergence, pinned in `scripts/data/codex-self-parity-divergences.json` (dated rationale + content hash, CANON-14 pin semantics)     |
| RUNTIME-ARTIFACT | repo-runtime file the generator never emits, declared in `scripts/data/codex-self-parity-runtime-artifacts.json` (e.g. `.agents/plan/PLAN.json`) |

Inside the repo gate it runs at **L2**, immediately after
`codex parity (#1966)`; CI inherits it via check-all L2. Exit codes follow the
same INV-53 contract as above (0 pass / 1 findings / 2 fail-closed error;
emission failure ⇒ 2).

### Finding classes

| Finding                  | Meaning                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STALE`                  | A repo file's normalized content diverges from the fresh emission and no pin covers it — the `skipIfExists` rot class                                |
| `MISSING`                | The generator emits a file today that has no counterpart under the repo roots (e.g. a newly derived rule never materialized)                         |
| `UNCLASSIFIED`           | A repo file under the roots that is neither emitted-match, pinned, nor a declared runtime artifact                                                   |
| `DRIFTED-PIN`            | A pinned file moved beyond the pinned content hash — the divergence no longer matches what was reviewed                                              |
| `HEALED-PIN`             | A pin whose divergence no longer exists (file now matches the emission) — the pin has outlived its reason                                            |
| `DEAD-PIN`               | A pin referencing a path that no longer exists under the roots                                                                                       |
| `DEAD-ARTIFACT`          | A runtime-artifact declaration matching no repo file — ledger rot, symmetric with `DEAD-PIN`                                                         |
| `CONTRADICTORY-ARTIFACT` | A declared runtime artifact that the generator emits — the declaration is contradictory and must be removed                                          |
| `UNREADABLE`             | A track entry that is not a readable regular file (symlink, FIFO, permission error) — every file on the parity surface must be a plain readable file |

### Failure playbook (self-track)

- **`STALE`**: usually re-materialize — copy the fresh emission over the repo
  copy (procedure below). If the divergence is intentional self-hardening,
  pin it instead in `scripts/data/codex-self-parity-divergences.json` with a
  dated rationale and the content hash.
- **`MISSING`**: re-materialize — copy the emitted file into the repo path.
- **`UNCLASSIFIED`**: decide what the file is — a repo-runtime file (declare
  it in `scripts/data/codex-self-parity-runtime-artifacts.json` with a
  reason), an intentional extra (pin it), or debris (remove it).
- **`DRIFTED-PIN`**: re-review the divergence; either refresh the pin (new
  hash + updated dated rationale) or re-materialize and drop the pin.
- **`HEALED-PIN`**: delete the entry — a pin outliving its divergence is
  refused, same semantics as the fixture gate's stale allowlist.
- **`DEAD-PIN`**: delete the entry.
- **`DEAD-ARTIFACT`**: delete the stale entry from
  `scripts/data/codex-self-parity-runtime-artifacts.json`.
- **`CONTRADICTORY-ARTIFACT`**: remove the declaration — an emitted file can
  never be a runtime artifact.
- **`UNREADABLE`**: fix or remove the offending entry (replace the symlink /
  special file with a plain file, or restore read permissions). Symlinks are
  rejected by design: the generator never emits them, and following one
  reopens the blocking-read class the gate refuses fail-closed.

### Re-materialization procedure

1. Emit fresh to a scratch dir using the same sequence the gate uses (see the
   emission block in `scripts/check-codex-self-parity.mjs`; it mirrors the
   `check-self-dogfood.mjs` dist-import precedent):

   ```js
   const stored = loadConfig(repoRoot)
   const { config } = resolveProjectConfig(repoRoot, 'arbiter', stored)
   generateCodex({ ...config, targetDir: scratchDir }, { dryRun: false })
   ```

   The scratch dir must be empty — that is what defeats `skipIfExists`.

2. For every `STALE`/`MISSING` file, **copy scratch → repo path**. Write
   modes matter here:
   - `.agents/rules/*` and `.codex/codex-adapter.mjs` are emitted with
     `skipIfExists: true` — the generator will NEVER refresh them in place;
     they MUST come from the scratch copy.
   - `.agents/CODEX.md` and `.codex/config.toml` are overwrite-mode
     (`backup: true`) — the generator can refresh them in place, but the
     scratch-copy route works uniformly for all files.
3. Re-run `node scripts/check-codex-self-parity.mjs`. Any divergence you
   deliberately keep gets a pin (branch b above) instead of a copy.

### Frontmatter note

Repo copies may carry the repo's doc-frontmatter block (e.g.
`.agents/CODEX.md`, `.agents/plan/README.md`); the templates do not emit one.
The gate strips a leading YAML frontmatter block from the REPO side before
comparing — but ONLY when every non-blank line of the block is an inline
`key: value` whose key is on the repo metadata allowlist
(`FRONT_MATTER_KEY_ALLOWLIST` in `scripts/lib/codex-self-parity-lib.mjs`:
title, doc_version, status, last_review, owner, canonical_id, tags, related;
each at most once). A block carrying anything else — unknown keys, list
items, plain text, duplicates — stays on the compare surface and reds the
gate (injected-directive defense, default-deny). Within that bound, keeping
or dropping frontmatter on a re-materialized file is a style decision, not a
parity one. Markdown is additionally Prettier-normalized on BOTH sides before
compare (formatting is invisible to parity, like frontmatter); files over
1 MB skip Prettier and compare raw.

### Known couplings (red-team 2026-07-17, accepted)

- **Non-`.md` files compare byte-exact.** `.codex/codex-adapter.mjs` and
  `.codex/config.toml` are emitted with the hardcoded Prettier fallback
  (`ARBITER_DEFAULT_PRETTIER_ARGS`, `src/utils/prettier-format.ts`); the gate
  stays green only while the repo `.prettierrc.json` is semantically equal to
  that fallback. If either diverges (or a Prettier major changes a default),
  the gate reds with a `stale` finding — re-materialize per the procedure above.
- **`.agents/plan/PLAN.json` must exist while declared.** It is a declared
  RUNTIME-ARTIFACT; deleting it from the tree without pruning its entry in
  `scripts/data/codex-self-parity-runtime-artifacts.json` produces a
  `dead-artifact` red (fail-closed by design).
- **`.codex/config.toml` green state is flag-coupled.** The committed file
  carries the `check-no-pii.mjs` and `check-no-skipped-tests.mjs` blocks, which
  the template emits only when arbiter's own resolved config keeps
  `enableSecurityScanning` on and `enableNoSkippedTests` not disabled. Flipping
  either flag reds the gate until the file is re-materialized — intended
  detection, recorded here so the red is not mistaken for a gate bug.
