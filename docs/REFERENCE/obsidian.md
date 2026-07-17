---
title: 'Reference: arbiter obsidian'
doc_version: '1.0.0'
status: active
last_review: '2026-07-17'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['107-obsidian-subcommand']
---

# Reference: arbiter obsidian

> **Target:** governed repos at L2+ (the Obsidian vault requires the `docs/` SSOT corpus)
> **Command:** `src/commands/obsidian.ts`, registered in `src/cli.ts`
> **Scripts orchestrated:** `scripts/gen-wiki.mjs`, `scripts/check-wiki-lint.mjs`
> **ADR:** [ADR-107](../internal/ADR/107-obsidian-subcommand.md)

## Synopsis

```
arbiter obsidian [options]

  --repo <dir>        Target repo directory (default: current directory)
  --vault-path <dir>  Vault directory relative to the repo root (default: "wiki")
  --sync              Regenerate the vault then re-validate (fail-closed)
  --validate-only     Validate the existing vault without writing
  --write             Reserved for a future writer; v1 is read-only (ADR-001)
  --dry-run           Report only — writes nothing (default)
  --json              Emit machine-readable JSON output
```

`arbiter obsidian` is a **v1 thin generic orchestrator**. It does not parse markdown,
walk `[[wikilinks]]`, or check staleness itself — it shells out to the two vault
scripts a governed repo already received from `arbiter update`/`init`
(`scripts/gen-wiki.mjs`, `scripts/check-wiki-lint.mjs`) and turns their output into a
stable, structured result.

## Mode precedence

Exactly one of the four mode flags may be given. Precedence when more than one flag is
passed is `--validate-only` > `--sync` > `--write` > `--dry-run` — but passing **more
than one** mode flag is treated as a conflict and exits 2, it does not silently apply
the precedence order.

| Mode                  | Behavior                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `--validate-only`     | Runs `check-wiki-lint.mjs --wiki-dir <vault>` against the existing vault. Writes nothing.                                                   |
| `--sync`              | Runs `gen-wiki.mjs --wiki-dir <vault>` (write), then re-validates. Fail-closed: a regen that leaves the vault broken still reports `error`. |
| `--write`             | Reserved. v1 has no writer of its own beyond the `--sync` regen path — behaves like `--dry-run`.                                            |
| `--dry-run` (default) | Reports the resolved vault directory. **Writes nothing** (ADR-001: read-only by default).                                                   |

## Preflight

Both `scripts/gen-wiki.mjs` and `scripts/check-wiki-lint.mjs` must exist in the target
repo. If either is missing, the command exits 2 with a hint to run `arbiter update`
(which regenerates them via `src/generators/wiki.ts`).

## Exit-code table (INV-53)

| Exit | Status            | Meaning                                                                              |
| ---- | ----------------- | ------------------------------------------------------------------------------------ |
| 0    | `ok`              | Mode completed; validation (if run) found no violations.                             |
| 1    | `warning`/`error` | Vault validation found violations (broken link, orphan, stale, or missing citation). |
| 2    | `error`           | Blocker: missing vault scripts, conflicting mode flags, or a spawn/launch failure.   |

## `--json` envelope (`contractVersion: 1`)

```jsonc
{
  "status": "ok" | "warning" | "error",
  "exitCode": 0 | 1 | 2,
  "mode": "sync" | "validate" | "dry-run" | "write",
  "contractVersion": 1,
  "vaultDir": "wiki",
  "regenerated": true,        // present only for --sync
  "validation": {             // present for --validate-only and --sync
    "brokenLinks": 0,
    "orphans": 0,
    "stale": 0,
    "ok": true
  },
  "reason": "..."              // present on warning/error
}
```

## What v1 does NOT do

- No GitHub-issue linking from vault pages.
- No frontmatter rewriting beyond what `gen-wiki.mjs` itself already does.
- No rename-rewrite — renaming a source doc does not repoint existing `[[wikilinks]]`.
- No bespoke walker, markdown parser, or wikilink engine — everything is delegated to
  the two existing scripts; see ADR-107's CANON-16 survey for why a new engine was
  rejected.

## Prerequisite: L2+

The Obsidian vault (`wiki/`) requires the `docs/` SSOT corpus that only L2+ governance
levels populate (see `src/generators/wiki.ts`: `generateWiki` is a no-op at L1). Running
`arbiter obsidian` against an L1 repo will hit the missing-scripts preflight and exit 2
with the `arbiter update` hint — there is nothing to sync until the corpus exists.

## Relationship to gen-wiki.mjs / check-wiki-lint.mjs

`arbiter obsidian` never duplicates the two scripts' logic. A `--vault-path` other than
the default `wiki` is passed straight through as `--wiki-dir` to both scripts — this
requires both scripts to support that flag (as of #1979, `check-wiki-lint.mjs` already
did; `gen-wiki.mjs` was given parity as part of this same change, see ADR-107 §Design-risk-#3).
