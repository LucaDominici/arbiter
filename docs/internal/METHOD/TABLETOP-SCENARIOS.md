---
title: 'Tabletop Scenarios — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-08-29'
owner: ''
canonical_id: 'TABLETOP-SCENARIOS'
tags: ['audience/dev', 'audience/agent', 'kind/method']
related:
  ['docs/REFERENCE/ship-driver.md', 'docs/REFERENCE/wave-drain.md', 'docs/REFERENCE/fix-on-red.md']
---

# Tabletop Scenarios — arbiter

**Purpose:** the seeded catalogue for `/tabletop`. Each entry is one journey a real user
lives end to end. The `tabletop` skill walks it in the persona's voice, executes the probes,
compares each step against what the docs promise, and writes
`.arbiter/evidence/tabletop/<slug>-<date>.md`.

**Location:** `docs/internal/METHOD/TABLETOP-SCENARIOS.md`

Every scenario carries the same seven fields. `Docs the user would read` cites
arbiter-repository paths only — a consumer-side artifact (a generated gate script, an emitted
workflow) is named in the probes, not cited as a path here.

Adding a scenario: append a `## N. <title>` block with all seven fields and a new slug, and
extend `EXPECTED_SLUGS` in `__tests__/docs/tabletop-scenarios.test.ts`.

---

## 1. Greenfield `arbiter init` on a TypeScript library

- **Slug:** `greenfield-init-ts`
- **Persona:** A TypeScript library author who has never run arbiter, installing it into an
  empty repository on a Friday afternoon.
- **Starting state:** A fresh git repository with a `package.json`, no `.claude/`, no
  `AGENTS.md`, no CI.
- **Goal:** Reach a repository where the emitted L1 gate passes and the author understands
  what each emitted gate is for.
- **Docs the user would read:** `README.md`, `docs/QUICKSTART.md`, `docs/CONCEPTS.md`
- **Executable probes:** `node dist/cli.js init --help`; a dry-run init against a scratch
  directory; render `src/templates/scripts/check-all.mjs.ejs` with a TypeScript-library config; read the
  materialized `AGENTS.md` twin under `examples/`.
- **Exit criterion:** Every command the quickstart names exists and accepts the flags it
  shows, and every file the quickstart promises appears in the dry-run plan.

## 2. Brownfield `arbiter update` on a Go service

- **Slug:** `brownfield-update-go`
- **Persona:** A platform engineer adopting arbiter into a three-year-old Go service that
  already has its own Makefile, linter config and GitHub Actions.
- **Starting state:** A Go repository with existing tooling and an older arbiter kit — or
  none at all — and a strong aversion to having its CI overwritten.
- **Goal:** Adopt the governance kit without clobbering the existing build, and know exactly
  which files were changed and which were skipped.
- **Docs the user would read:** `docs/QUICKSTART.md`,
  `docs/internal/DEVELOPMENT/CONFORMANCE.md`, `docs/DEPRECATIONS.md`
- **Executable probes:** `node dist/cli.js update --help`; `node dist/cli.js init --dry-run`
  against a copy of a fixture under `__tests__/fixtures/real-projects/`, then — once the kit
  is installed — `node dist/cli.js diff` (the read-only preview of what `update` would write)
  and `node dist/cli.js update --adopt-plan` (the preview of what adoption would overwrite);
  render the Go gate registry and diff it against the materialized Go example under
  `examples/go-library/` — archetype `library`, not the `backend-web-db`-shaped service
  this persona actually runs. **Known coverage gap (tracked, #2454):** this probe only
  proves gate-registry rendering matches for `library`; `backend-web-db`-specific Go gate
  code has no example-drift coverage (`examples:regenerate`'s `LIVING_EXAMPLES` is a
  closed list scoped to `library` by design — see `examples/README.md`), though the
  Generator Matrix's Go DEEP cell does prove the generated L1 gate runs green for
  `backend-web-db` via the `go-backend-web-gcr` fixture. Read the brownfield-detection
  code path.
- **Exit criterion:** The preview names every write and every skip-if-exists — `init
--dry-run` is driven by the same generator plan the real run executes (#2452) — and no
  documented skip promise is contradicted by the plan.

> There is no `update --dry-run`. The whole-run preview of `update` is `arbiter diff`
> ("`update` with the writes elided"); `update --adopt-plan` previews the narrower
> question of which withheld files adoption would overwrite. Naming a third spelling
> would only add a surface that can drift.

## 3. `/ship` one XS issue to a merged PR

- **Slug:** `ship-one-xs-issue`
- **Persona:** A solo maintainer with one small, well-specified issue and thirty minutes.
- **Starting state:** A clean checkout on `main`, an open XS issue, no active task state.
- **Goal:** Drive the issue to a merged PR through `/ship` without leaving the orchestration
  path, and see each phase gate assert something real.
- **Docs the user would read:** `.claude/commands/ship.md`, `docs/REFERENCE/ship-driver.md`,
  `docs/REFERENCE/state-file.md`
- **Executable probes:** `node dist/cli.js task --help` and each subcommand's `--help`;
  `node dist/cli.js task get --field phase`; read `.claude/skills/tdd/SKILL.md` against the
  phase-transition table; run `node scripts/check-tdd-evidence.mjs` on the current branch.
- **Exit criterion:** Every phase the ship driver documents maps to a real subcommand and a
  real gate, and no phase is reachable by a command the docs do not name.

## 4. `/drain` a four-issue wave as one train

- **Slug:** `drain-wave-of-four`
- **Persona:** A maintainer with a backlog of four independent small issues who wants one
  reviewed PR instead of four.
- **Starting state:** Four open, workable issues with disjoint file-sets; no worktrees open.
- **Goal:** Batch, dispatch, integrate and land the wave as a single green PR, with each
  issue's TDD evidence intact.
- **Docs the user would read:** `.claude/commands/drain.md`, `docs/REFERENCE/wave-drain.md`,
  `docs/REFERENCE/wave-primitives.md`, `.claude/rules/50-batch-execution.md`
- **Executable probes:** `node dist/cli.js worktree --help`; `node dist/cli.js worktree list`;
  read the wave-drain skill against the batch-execution carve-out conditions; run
  `__tests__/scripts/check-touched-vs-manifest.test.ts` and read
  `scripts/check-touched-vs-manifest.mjs` — the harvest-time gate that a group's touched
  files (`git diff --name-only` against the wave's base) stay inside that group's declared
  `Files:` manifest row.
- **Exit criterion:** The disjoint-file-set precondition has a mechanism behind it:
  `check-touched-vs-manifest.mjs`, run per group at wave-drain harvest — though it proves
  one group's write-set compliance (touched ⊆ manifest), not pairwise cross-group
  disjointness, which stays a plan-time declaration checked by review, not computed. The
  worktree isolation rule and the single-wave-PR promise have no standalone probe script;
  verify them by inspection instead: confirm `git worktree add -b` — not application code —
  is what makes branch creation atomic (ADR-103 §D1), and confirm the wave-drain skill's
  harvest step merges every group into one PR rather than one per issue.

  > `check-agent-dispatch.mjs` — cited here in an earlier revision — verifies the
  > review-dispatch matrix (tier→vertical floor, model-diversity and refutation-skeptic
  > counts), a different axis from this criterion; a green run from it says nothing about
  > disjointness, isolation, or PR shape (#2445).

## 5. The PR goes red in CI and the agent recovers

- **Slug:** `pr-red-and-recover`
- **Persona:** An agent whose PR was green locally and is now red on a job it has never read.
- **Starting state:** An open PR with one failing required check and no local reproduction.
- **Goal:** Get from "red check" to "root cause named and fixed" through the documented
  watcher → job log → fix → re-watch loop, without a blind retry.
- **Docs the user would read:** `docs/REFERENCE/fix-on-red.md`,
  `docs/REFERENCE/ci-tier-workflows.md`, `.claude/rules/95-closer-mode.md`
- **Executable probes:** `gh pr checks --help` and `gh run view --help`; read the CI tier
  table against `.github/workflows/`; run the local-CI parity gate to confirm the failing job
  is locally reproducible.
- **Exit criterion:** Every required check named in the tier docs exists in a workflow, and
  each one maps to a local command the recovery loop can actually run.

## 6. A consumer upgrades arbiter and reviews the delta

- **Slug:** `consumer-upgrade-delta`
- **Persona:** A team lead on a governed project bumping arbiter a minor version, who must
  explain the diff to two reviewers before merging it.
- **Starting state:** A governed project on an older arbiter kit, with local edits to a
  couple of generated files.
- **Goal:** Understand precisely what the upgrade changes, what it will not touch, and which
  deprecations are now due.
- **Docs the user would read:** `docs/SEMVER.md`, `docs/DEPRECATIONS.md`, `CHANGELOG.md`,
  `docs/REFERENCE/backward-compat-harness.md`
- **Executable probes:** `node dist/cli.js diff` (and `diff --withheld`) on a materialized
  example under `examples/`; `node dist/cli.js update --adopt-plan` on the same tree; run
  `node scripts/check-deprecations.mjs` — it parses `docs/DEPRECATIONS.md`'s active-window
  rows and the `CLI_DEPRECATED_FLAGS` registry, failing if a deprecated symbol is missing
  its removal-window gap; read `CHANGELOG.md` against the deprecation window the semver
  policy promises.
- **Exit criterion:** Every deprecation listed carries a version and a removal window, and
  the preview's skip set matches what the semver policy says an upgrade preserves.

  > `check-api-snapshot.mjs` — cited here in an earlier revision — verifies arbiter's own
  > internal TS export surface (`plugin.ts`, `invariants/`, `compatibility/`) hasn't
  > drifted unacknowledged; that is a real gate, but on a different axis from this
  > criterion — it says nothing about a listed deprecation's version/removal window or
  > about the upgrade preview's skip set (#2445).
