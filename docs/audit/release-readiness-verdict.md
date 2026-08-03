---
title: 'Release-Readiness Verdict — `npm publish` of `@arbiter/cli`'
doc_version: '1.0.0'
status: active
last_review: '2026-07-12'
owner: ''
canonical_id: ''
tags: ['kind/audit', 'audience/dev']
related: []
---

# Release-Readiness Verdict — `npm publish` of `@arbiter/cli`

> **Nota di stato (2026-07-13):** verdetto sigillato per durabilità dal branch `seal/fable-docs`.
> Il finding **B2** di questo documento (first-run RED al tier default L2, causato da `knip` che
> segnalava la devDependency `prettier` iniettata dal generatore) è stato chiuso su `main` dai
> commit `82f1f89d` (fix del generatore) e `ae47d943` (test e2e che asserisce il gate al tier
> default L2, non solo L1). Nota: il documento etichetta B2 come appartenente alla "classe
> #1491-B4" — il finding **B4** dell'issue #1491 stesso resta invece aperto/non riverificato a
> questa data, e non va confuso con il B2 qui sopra. Lo stato autoritativo del publish-gate è
> l'issue #1491.

**Date:** 2026-07-12
**Audited ref:** `main@40062674` (as pinned by the owner) — **main moved during the audit**: 7 direct
pushes landed (`867ea265`…`29198280890`-in-flight, the T0–T2 doc-set wave + dogfood chores). Findings
are marked per-ref where it matters.
**Method:** black-box, evidence-first. Built the pinned snapshot, ran `arbiter init` on a virgin
TypeScript repo, ran the generated gates, ran the full self test-suite, cross-checked every
generated `arbiter <sub>` reference against the real CLI registry, inspected CI runs, packaging,
and the H1–H7 / anti-context-rot ledgers. No claim below is taken from a README.

---

## VERDETTO: **QUASI — NO-GO oggi**

The ideas are no longer ahead of the execution: 13,699 self-tests, a 1.2 MB / 1,137-file tarball
with real prepublish gates, verified privacy scrub (0 private-name hits in `src/` + `dist/`),
green L1 first-run (43 checks), green Nightly and Weekly lanes, real user docs
(README/QUICKSTART/website with quickstart–concepts–reference–recipes structure). This is a
shippable product **category**.

But it is not shippable **today**, for six proven reasons. The killer is thesis-level: at the
moment of the publish decision, arbiter does not pass arbiter.

---

## Bloccanti provati (each: evidence → why it blocks publish)

### B1 — Main is RED on its own gate, and pushes keep landing on it

- CI `Full Gate (L2, INV-59)` **failed** on the pinned commit `40062674` (run 29194714679):
  `format` check, file `__tests__/templates/_monthly-render.test.ts` — introduced _by that same
  commit_ (PR #1939). Reproduced locally on today's tip: `npx prettier --check` still fails on it.
- The next main push (`2fe61044`, run 29197869837) **failed again** (Full Gate L2 + D4-LITE +
  CI Required). A third push is in flight and will fail too (the file is untouched).
- 7 direct pushes to a red main in <3 h; the generated pre-push hook runs exactly this gate, so it
  was bypassed or stale. Auto-filed P1 #1940 is open, unaddressed, while feature work continued.
- The self unit suite on tip also fails honestly: `check-phantom-command-scan.mjs` → FAIL
  (`docs/design/gold-doc-tranches-t3-t5.md` cites `arbiter mark`, a non-registered command — the
  anti-ghost gate caught its own wave's doc).
- **Why blocking:** the product's one-line pitch is _"governance that can't be faked"_. Publishing
  from a repo that is currently faking its own governance is self-refuting, and `prepack` gates
  aside, you'd be tagging a release commit whose own CI is red.

### B2 — A new user's first push is blocked by arbiter's own false positive (#1491-B4 class, alive)

- Virgin TS repo → `arbiter init -y` → default `governanceLevel: L2` → generated pre-push runs
  `node scripts/check-all.mjs gate` → **exit 1**: `dead code` (knip) flags `prettier` — a
  devDependency **arbiter itself injected** (generated `package.json:18`) and which arbiter's own
  generated `format` check uses (it passes at check #7 of the same run). The generated knip config
  doesn't know about the generated gate's prettier usage. Reproduced end-to-end today.
- The team's own proof to the contrary is tier-blind: the T8 packaged-artifact E2E
  (`__tests__/integration/e2e/functional/packaged-artifact.test.ts:6,96`) asserts only the **L1**
  gate and only runs under `VITEST_L2=1` (nightly). Nothing verifies the default-level (L2)
  first-run — which is exactly where it's red.
- **Why blocking:** first post-init push fails for every default-config user. That is the single
  worst possible first impression for a governance installer.

### B3 — `arbiter init -y` aborts on its own output on the most common path

- Clean repo without `node_modules` (i.e., right after `git clone`): init generates
  `src/test/example.behavioral.test.ts` importing `vitest`
  (`src/generators/behavioral-tests.ts:119–126`), adds vitest to `package.json`, but never
  installs — then immediately runs the `tsc:noEmit` verify probe, which fails on the file init
  just wrote. Result: **"arbiter init aborted"** (exit 1), _after_ writing 205 files, mutating
  `package.json`, and switching `core.hooksPath` — with a misleading hint ("install typescript",
  which was already installed; the actual fix is plain `npm install`). Re-running init after
  `npm install` succeeds (exit 0).
- **Why blocking:** the flagship command (`npx @arbiter/cli init`) half-fails on the canonical
  first-touch path and misdiagnoses itself.

### B4 — The tarball ships agent playbooks that command nonexistent CLI verbs

Verified against the live registry (`error: unknown command`):

- `arbiter mark` — `src/templates/claude/commands/ship.md.ejs:58,347`;
  `src/templates/claude/commands/task.md.ejs:34`. This is the /ship **state-cursor protocol**:
  resume/recovery is built on a command that does not exist.
- `arbiter review plan` — `ship.md.ejs:95,343`; `claude/skills/wave-drain/SKILL.md.ejs:149`. The
  plan-review **gate** of the ship flow. (Real command is `verify plan`.)
- `arbiter work close` — `ship.md.ejs:301` (real: `wt close`).
- Same class, docs-side — **partially resolved (#2017)**: `CONTEXT_PACK_SPEC.md.ejs` /
  `CONTEXT_SLICE_SPEC.md.ejs` were rendered by **no generator** and have since been deleted
  (PR #1959); the orphaned `scripts/emit-context-slice.mjs` and its test were deleted with them.
  `scripts/emit-context-pack.mjs` does exist in self. **Resolved (#2230):** the emitted agent text
  no longer names the script — `.claude/agents/context-checker.md:28` and its emitted twin
  `src/templates/claude/agents/context-checker.md.ejs:28` now describe `CONTEXT_PACK.md` as a
  context pack without claiming a generator exists in governed repos.
  `scripts/emit-context-pack.mjs` stays self-only by design (its header declares it internal tooling).
- The guard that should catch this (H7, CLI-surface coherence on the _emitted_ agent surface) is
  design-only; its design doc isn't even on main (see B5 note).
- **Why blocking:** these files are _in the npm tarball_ and are the operating instructions given
  to every downstream agent. Day-one users will watch their agents hit dead ends inside the
  vendor's own protocol.

### B5 — Self-verification runs at the weakest bar (H6 live, now codified)

- `node scripts/check-doc-set.mjs` on self: **`[tier: solo]`** — 12 applicable docs, 36 N/A.
  Self is `collaborationMode: trunk-solo`, so the new tiers{} machinery (T1, landed today) resolves
  self to the _solo_ column. The enterprise-grade governance product audits itself against the
  solo checklist. The `tier_floor` fix (Fix 1) and enterprise self-enrollment (Tranche 5) exist
  only in a design doc sealed on a non-main branch commit (`8a492182`) — the rebase dropped the
  entire design/methodology corpus (incl. the H1–H7 ledger itself) from main.
- **Why blocking (for the claim, not the tarball):** "self-governed" is a marketing pillar;
  shipping while self runs the weakest tier converts the H6 finding from gap to public liability.

### B6 — The publish gate itself is unproven in a release environment

- `prepublishOnly` = pack-size + tarball-contents checks; `prepack` = build + third-party-license
  `--check`. Locally, 3 `gen-third-party-licenses` tests fail and the script mis-resolves the repo
  root when invoked directly (tries to open `…/repos/package.json`, one level above the repo).
  Likely env-sensitive (host npm 12 vs `engines.npm <11` — itself a nit: npm 11/12 users get
  warnings), but **nobody has demonstrated a green `npm pack` end-to-end in the environment that
  will publish**. CI at `40062674` had these tests green, so this is adjudicable in one run — do it.
- Also unverifiable offline: ownership of the **`@arbiter` npm scope** (`@arbiter/cli` is 404 —
  unpublished; unscoped `arbiter` on npm is a Salesforce ORM, a bin-name confusion risk for users
  typing `npx arbiter`). <!-- install-command-allow --> If the scope isn't yours, nothing else matters.
- `package.json` lacks `repository`/`homepage`/`bugs`/`keywords` — the npm page would be bare.
- **Why blocking:** you cannot GO without one proven green pack + confirmed scope.

---

## Scorecard H1–H7 (gold-doc capability)

| Gap                                                        | At pinned `40062674` | On main tip (today)                                                                        |
| ---------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| H1 dead governed presence gate (`arbiter doc-set` missing) | OPEN                 | **CLOSED** (`867ea265`) — command exists, hidden, thin-runner wired L2+ as WARN            |
| H2 path-blind manifest                                     | OPEN                 | **CLOSED** (`7940398c`)                                                                    |
| H3 tier-blind manifest                                     | OPEN                 | **CLOSED** (`f3e8cb54`, `standards/gold-doc-set.yml:54` tiers{} live)                      |
| H4 freshness gate                                          | OPEN                 | OPEN (no `scripts/check-doc-freshness.mjs`)                                                |
| H5 body generator is a banner                              | OPEN                 | OPEN (`scripts/check-doc-set.mjs:232` still emits `> **STUB — fill me in.**`)              |
| H6 self passes weak bar                                    | OPEN                 | OPEN — and now _codified_ (self = solo tier, proven live)                                  |
| H7 coherence blind to CLI ghosts                           | OPEN                 | OPEN (scanner covers docs/website; emitted agent surface unguarded — B4 is the live proof) |

**Caveat:** the three closures landed as direct pushes onto a red main within the last hours; their
CI runs failed on the pre-existing format break, so "closed" has not yet been sealed by a green
pipeline.

**Anti-context-rot ledger** (methodology M-matrix): 13 enforcers EXISTS vs **6 TO-CREATE**
(M1 handoff-lint, M4 finding-loss detector, M9 spawn-time interception, M11 kernel-as-plugin, +2)
— all six unbuilt, and the ledger document itself lives only on the sealed branch commit, not on
main. The governance memory is currently subject to the exact rot it describes. A live specimen:
a crashed self-test left its mutation sentinel in the real tree
(`.arbiter/ship/supervisor.sh:47` → `echo drift-sentinel`), which turns `check-self-dogfood.mjs`
red locally — the test harness mutates the real repo (`withRealRepoMutationLock`) in violation of
the project's own M9 "worktrees, never the main tree" rule.

## Scaffold-not-wired residual (beyond B4)

The project's own open tracking issue **#1887** confesses the rest: 8+ `enableXxx` flags with no
activation path or silently dropped on `arbiter update` (`resolve-project-config.ts` read-back
gaps), dead emissions (`.evidence/BACKLOG.md.template` — since removed; `mutation/README.md.ejs`
and the `evidence-rotate.mjs` "called by task harness" doc-lie — both since corrected), a
format-incompatible `.eslintrc-no-fake-db.json`, deploy/DAST orphans, and 8 Gradle snippets
requiring manual `apply from:`. Partial progress is real — `check-feature-matrix.mjs`/`gen-gap.mjs`
are now emitted _and wired_ (verified in the virgin repo, `scripts/check-all.mjs:600–601`) — but
the issue is open, `needs-human`, and untriaged against the release.

## Cosa manca per il GO (ordered, ~1–2 focused days + CI cycles)

1. **Green main, for real:** `prettier --write __tests__/templates/_monthly-render.test.ts`; fix
   the `arbiter mark` phantom citation in `docs/design/gold-doc-tranches-t3-t5.md`; stop pushing
   until one full PR-Fast run on main is green. Close #1940.
2. **Fix the virgin-repo L2 red (B2):** teach the generated knip config about the generated gate's
   prettier usage (or stop injecting prettier); re-run the virgin experiment until
   `check-all.mjs gate` exits 0 on first try. Add a default-level first-run E2E (not L1-only).
3. **Fix init ordering (B3):** run the install (or defer the verify probe with an honest
   "run `npm install`, then `arbiter verify`" exit path); fix the misleading hint.
4. **Purge or implement the ghost verbs (B4):** `mark` (design says RESTORE — decide), `review
plan` → `verify plan`, `work close` → `wt close`; delete or wire the context-pack spec
   templates; extend the phantom scan to the emitted agent surface so the class is structurally
   dead (H7).
5. **Prove the publish path:** one green `npm pack` in the release env (node 22 + npm 10);
   confirm `@arbiter` scope ownership; add `repository`/`homepage`/`keywords`; reconcile the
   version story (CHANGELOG says 0.5.0, release epic #1770 says publish 0.1.0; one changeset
   still pending).
6. **Repo-public track (separate gate from npm):** #1770-T7 — 126 `docs/internal/` files are still
   git-tracked; T3 runner-label sweep partial. npm publish does not require repo-public; do not
   couple them.

Post-publish acceptable: H4, H5, Tranche-5 self-enrollment (H6/H7 hardening), #1887 backlog,
`cli.ts` split (#1882) — provided H6 is not marketed as solved.

## Bottom line

Not "idee giuste, esecuzione incompleta" anymore — the execution is ~90% there and the remaining gaps are
narrow, enumerated, and cheap. But the last 10% is precisely the part the product exists to
enforce: a green main, an honest first-run, and no ghost promises in the box. Publish after the
six blockers above are individually proven fixed — none of them takes more than hours, and items
1–3 are the difference between launching a governance tool and launching a counterexample.
