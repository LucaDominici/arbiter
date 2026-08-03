---
title: 'ADR-107: arbiter obsidian subcommand — thin generic orchestrator'
doc_version: '1.0.0'
status: active
last_review: '2026-07-17'
owner: ''
canonical_id: '107'
tags: ['audience/dev', 'kind/adr']
related: ['089-collapse-hand-docs-to-ssot-core-plus-generated-wiki']
---

# ADR-107: arbiter obsidian subcommand — thin generic orchestrator

**Project:** arbiter
**Date:** 2026-07-17
**Status:** Accepted

## Context

A governed repo already receives two vault scripts from arbiter's own wiki
generator (`src/generators/wiki.ts` → `scripts/gen-wiki.mjs`,
`scripts/check-wiki-lint.mjs`, ADR-089). Both are self-contained, deterministic,
git-aware compilers/linters for the Obsidian-compatible `wiki/` vault. What was
missing was a single CLI entrypoint a user (or CI) could run to sync or
validate that vault without remembering two separate `node scripts/*.mjs`
invocations and their flags.

### CANON-16 survey (existing-code-first)

Grepped `gen-wiki`, `check-wiki-lint`, `obsidian` across `src/`:

- **`src/generators/wiki.ts`** — the EMISSION side only. It writes the two
  scripts (`skipIfExists`) into a consumer repo's `scripts/` directory as part
  of template generation. It never invokes them; its lifecycle ends at
  `arbiter update`/`init` time.
- No existing command runs the emitted scripts against a repo's _current_
  state (post-emission orchestration). This is a distinct responsibility —
  "did the vault should-be-in-sync check pass right now" — not template
  drift, so folding it into `wiki.ts` would conflate a generator (writes
  files once, idempotent-by-hash) with an orchestrator (invoked repeatedly,
  reports pass/fail).

**Conclusion: refactor rejected, new file justified.** `src/commands/diff.ts`
is the closest neighbor in shape — a thin command with a dry-run/write
precedence contract and a `--json` envelope — and `obsidian.ts` reuses that
pattern rather than inventing a new one.

## Decision

`arbiter obsidian` is a **v1 thin generic orchestrator**: it shells out to
`scripts/gen-wiki.mjs` and `scripts/check-wiki-lint.mjs` in the target repo.
It does NOT reimplement a wikilink walker, markdown parser, or staleness
checker — that logic stays exactly once, in the scripts themselves.

- **Mode precedence:** `--validate-only` > `--sync` > `--write` > `--dry-run`
  (default). Conflicting flags (more than one of the four) → exit 2.
- **Preflight:** both scripts must exist in the target repo, or exit 2 with
  a `run 'arbiter update'` hint (the emission side already handles
  `skipIfExists` regeneration).
- **`--validate-only`:** spawns `check-wiki-lint.mjs --wiki-dir <vault>`,
  parses its `[broken-link]` / `[orphan]` / `[stale]` / `[citation]`-tagged
  output into a structured `validation` object. Any violation → `status:
'error'`, exit 1 (INV-53: 0/1/2, not a launch failure).
- **`--sync`:** spawns `gen-wiki.mjs --wiki-dir <vault>` (write), then
  re-validates — fail-closed, so a regen that leaves the vault broken still
  reports `error`/exit 1, not a false `ok`.
- **Bare `--dry-run` (default) and `--write`:** v1 has no bespoke writer of
  its own beyond the reused `gen-wiki.mjs` regen path (which only runs under
  `--sync`), so both report the resolved vault dir without touching disk —
  read-only-by-default (ADR-001).
- **Exit contract:** 0 = ok, 1 = warning/violations found, 2 = error/blocker
  (spawn failure, missing scripts, conflicting flags) — INV-53.
- **`--json`:** emits the full `ObsidianResult` envelope
  (`contractVersion: 1`) so CI can consume it without parsing human text.

### INV-12 deviation from the literal task wording

The originating task description said "spawnSync the vault scripts."
`check-no-direct-spawn.mjs` (a `PostToolUse` hook) hard-blocks any
`node:child_process` import under `src/` outside `src/utils/run-cli.ts`
(INV-12). `obsidian.ts` therefore calls the existing `runCli()` wrapper
instead of `spawnSync` directly — same effective behavior (`shell: false`,
no interpolation), but through the one sanctioned call site.

### Design-risk #3 verification: --wiki-dir flag parity

The design flagged a risk that `check-wiki-lint.mjs`'s emitted template might
lack a `--wiki-dir` flag the self-hosted script has. Verification showed the
OPPOSITE gap: `check-wiki-lint.mjs` (and its `.ejs` template) already had
`--wiki-dir` parity. The actual gap was on the **write side** —
`gen-wiki.mjs` (and its template) hardcoded `WIKI_DIR` to `<repo>/wiki` with
no override, which would have silently broken `--vault-path` for `--sync`.
Fixed with the same minimal flag-parsing pattern already used by
`check-wiki-lint.mjs`, applied to both `scripts/gen-wiki.mjs` (self-hosted)
and `src/templates/scripts/gen-wiki.mjs.ejs` (emitted).

## What v1 does NOT do

- No GitHub-issue linking from vault pages.
- No frontmatter rewriting beyond what `gen-wiki.mjs` already does.
- No rename-rewrite (renaming a source doc does not repoint existing
  `[[wikilinks]]`; that stays a `gen-wiki.mjs` concern if ever added).
- No bespoke walker/parser/linter — 100% delegated to the two existing
  scripts.

## Consequences

### Positive

- Single command surface (`arbiter obsidian`) instead of two ad hoc script
  invocations, with a stable JSON contract for CI.
- Zero new parsing/walking logic to maintain — bugs in link resolution or
  staleness detection are fixed once, in the scripts, and both `obsidian`
  and any direct script invocation benefit.
- `--vault-path` parity fix benefits every consumer repo already running
  `gen-wiki.mjs`, not just this orchestrator.

### Negative

- `obsidian.ts`'s `validation` object is only as rich as
  `check-wiki-lint.mjs`'s stdout text (regex-parsed tags) — a stdout format
  change in that script silently degrades the structured counts. Acceptable
  for v1 given both live in the same repo family and are covered by tests.
- `--write` mode currently has no distinct behavior from `--dry-run` (no
  bespoke v1 writer) — reserved for a future increment.

## Links

- Related ADRs: ADR-089 (SSOT-core + generated wiki), ADR-001 (read-only by
  default), ADR-020 (`runCli` / INV-12)
- Issues: #1979
