---
title: '#2490 init --json --dry-run emits the JSON envelope'
doc_version: '1.0.0'
status: active
last_review: '2026-09-20'
owner: 'Luca Dominici'
canonical_id: ''
tags: ['audience/agent', 'kind/plan']
related: ['#2490', '#2452']
context:
  issue: '#2490'
  type: fix
  pipeline: 'plan → impl → gate → PR'
  branch_convention: 'task/#2490-init-json-dry-run'
  base_branch: main
  key_constraints:
    - 'Reuse computeDryRunPreview (#2452) — no second preview source.'
    - 'Reuse the existing jsonOutput envelope — no schema change.'
    - 'Human --dry-run output must not change.'
    - 'stdout under --json stays a single parseable document.'
  red_team_warnings:
    - 'A generator or banner printing to stdout during the dry run would break parseability — the test asserts exactly one line.'
    - 'A machine consumer could read data.files as exhaustive; the doc-set skeletons are undecidable before the run, so that caveat must survive into the envelope.'
    - 'runInit creates .arbiter/ and takes a lock before the dry-run branch, so a fixture dir is not cleanly reusable between two runs in one test.'
  estimate: 'XS (1h)'
files:
  - .agents/plan/2490-init-json-dry-run.md
  - .arbiter/evidence/tdd/#2490.json
  - __tests__/commands/init-json-dry-run.test.ts
  - docs/QUICKSTART.md
  - scripts/data/codex-self-parity-runtime-artifacts.json
  - src/commands/init.ts
---

# Plan: Issue #2490 — `init --json --dry-run` must emit the JSON envelope

> Plan location: `.claude/plans/` is the documented home, but this session's harness
> refuses writes under `.claude/`. The Context Block and `files:` manifest the
> `pre-edit-plan-anchor` hook validates are identical here, and
> `arbiter lifecycle start --plan` takes any repo-relative path (precedent:
> `.agents/plan/2594-bun-prepare.md`). `.agents/` is a codex track root, so the file
> is declared in `scripts/data/codex-self-parity-runtime-artifacts.json` the way the
> self-parity gate asks for — same line the #2594 plan holds.

## Scope

`src/commands/init.ts:174` returns from the dry-run branch through
`displayDryRunPreview(config)`, which writes the human banner to stdout and returns.
`--json` is accepted, silently ignored, and the process exits 0 — a CI consumer that
asked for machine-readable output gets a success code and unparseable text.

## Acceptance Criteria

- [ ] AC-1: `init --json --dry-run` writes the standard `jsonOutput` envelope
      (`command: 'init'`, `status: 'ok'`) whose `data` carries the previewed create /
      modify / skip lists produced by the plan.
- [ ] AC-2: no supported flag combination exits 0 with an output shape other than the
      one requested. `--json` without `--yes` already fails loudly (exit 78, JSON error
      envelope); the dry-run combination becomes supported rather than silently ignored.
- [ ] AC-3: a test pins `--json --dry-run` to a single parseable JSON line, and pins its
      payload path set to the same plan the human preview reports — inheriting #2452's
      preview == plan relationship rather than asserting a path count.

## Non-Goals

- No change to the human `--dry-run` surface.
- No change to the `jsonOutput` envelope schema.
- No new CLI flags.

## Existing Code Survey (CANON-16)

- `jsonOutput` / `statusToExitCode` — `src/utils/json-output.ts`. Reused as-is; already
  imported by `init.ts` for the `--json` + interactive guard.
- `computeDryRunPreview(config)` — `src/commands/init/generate.ts:526`. Already the single
  source of the preview (#2452 projects the real generator plan through it);
  `displayDryRunPreview` is only its human renderer. Reused directly — **no new preview
  code and no new file under `src/`**.
- Test fixtures — `__tests__/helpers.ts` (`createTestProject`, `initGit`) and the parity
  idiom in `__tests__/commands/init-dryrun-plan-parity.test.ts`.
- New test file justified: `__tests__/commands/init-json.test.ts` mocks the generator
  registry to `[]`, so a parity assertion there would be vacuous. This test needs the real
  registry on a real fixture — a different fixture lifecycle.

## Blast radius (`/impact`)

`runInit` is the only caller of the dry-run branch. `computeDryRunPreview` is re-exported
from `src/commands/init.ts` and consumed by `__tests__/coverage/init.cov.test.ts`,
`__tests__/commands/init-dry-run-parity.test.ts`,
`__tests__/commands/init-dryrun-plan-parity.test.ts` and
`__tests__/commands/init-brownfield-safety.test.ts`. This change **calls** it and does not
alter it, so every dependent keeps working. No file outside the manifest is touched.

### AC-2 sibling check (done before implementation)

`init.ts:169` holds a second silent `return` (`if (config === null) return`) — the same bug
class. `resolveConfig` returns `null` only from the interactive-wizard branch
(`src/commands/init/resolve-config.ts:302`), reached only when `!options.yes` and no
recipe/preset. `--json` already hard-requires `--yes` (`init.ts:114`, exit 78), so that
path is unreachable under `--json`. No fix needed; not widened into this diff.

## Approach

In the `options.dryRun` branch of `runInit`, when `options.json` is set, emit the envelope
from the same preview instead of the human renderer. The deferred doc-set note the human
surface prints is carried as a `warnings` entry so a machine consumer cannot read `files`
as exhaustive.

## Proof

- `__tests__/commands/init-json-dry-run.test.ts`
  - stdout is exactly one line and parses as the `init` envelope with `status: 'ok'`;
  - the payload's path set equals the path set the human `--dry-run` preview prints for an
    identically seeded fixture (two separate dirs — see the third red-team warning).
- Full clean-HEAD gate: `node scripts/check-all.mjs`.

## Rollback

Revert the commit; the human dry-run path is untouched by construction.
