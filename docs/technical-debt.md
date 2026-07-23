---
title: 'Technical Debt Register'
doc_version: '0.1.0'
status: active
last_review: '2026-07-12'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/reference']
related:
  [
    'docs/design/gold-doc-capability.md',
    'docs/design/gold-doc-self-tier-and-coherence.md',
    'standards/gold-doc-set.yml',
  ]
---

# Technical Debt Register

_Register table — known shortcuts, their cost, and the payback plan. Scaffolded by
`arbiter doc-set --apply` (T3, dogfooded on this very repo) the moment `tier_floor: enterprise`
(T1b) made this row mandatory on self; entries below are genuine, verified during the T3-T5 work
that landed this register — not placeholders._

| Item                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Class         | Interest                                                                                                                                | Plan                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHANGELOG.md`, `ROADMAP.md`, `PRIVACY.md` carry no frontmatter (pre-existing; `CHANGELOG.md` follows the Keep-a-Changelog/changesets convention `check-doc-style.mjs` already excludes from its own scan via `ROOT_FILES`) — `tier_floor: enterprise` (T1b) promoted all 3 from dormant/recommended to graded, and the new per-doc freshness gate (T4) now flags them STALE (fail-closed on a missing frontmatter block, by design).                     | docs          | Freshness gate over-reports by 3 docs every run; does not block L2 (freshness is monthly/release-only, never wired into check-all.mjs). | Run `scripts/docs-add-frontmatter.mjs` (or hand-add) on the 3 root docs; keep CHANGELOG.md's `last_review`-only shim compatible with the changesets tool. |
| T5b′ (CLI-surface phantom-command-scan extension: `.claude/skills`/`.claude/commands`/`.claude/agents`/`src/templates` roots, `*.md.ejs` extension, spawn-array matcher) and T5b″ (`standards/cli-emitted-surface.yml` ledger + tombstone protocol) from `docs/design/gold-doc-self-tier-and-coherence.md` §2 are specified but not implemented by this work (explicitly out of scope — a parallel agent's task boundary covers `templates/.claude/cli`). | architectural | H7 (coherence blind to `arbiter <sub>` ghosts) stays open; a future command deletion could again strand an emitted runner invisibly.    | Separate task, scoped to whoever owns `.claude/commands` + `src/templates/claude`.                                                                        |
| Most conditional doc families (`docs/operations/*`, `docs/security/*`, `docs/delivery/*`, ...) predate the `freshness_class` field (T1, #H3) and have none — `check-doc-freshness.mjs` defaults an absent class to the `policy` (180d) bar rather than fail-closed-stale, to avoid instant false-positive noise across ~20 rows.                                                                                                                          | docs          | Freshness bars for those families are an approximation, not a deliberate policy choice per family.                                      | Backfill an explicit `freshness_class` per conditional row (transcription work, Haiku-tier per the model pyramid) and drop the default.                   |
| `jscpd` is held at 5.0.11 in `package.json`/`package-lock.json` — 5.0.12's `jscpd-linux-x64-gnu` native binary requires GLIBC 2.32+, which the self-hosted CI runner's OS image lacks, breaking the `duplication` and `debt ratchet` checks fail-closed (#1286) if bumped. See #2089 for the related dogfood cache-mtime flakiness this surfaced alongside.                                                                                               | deps          | Blocks the routine dependabot bump for this one package until the runner image is updated or jscpd ships a glibc-2.31-compatible build. | Bump the self-hosted runner's OS image (or move `duplication`/`debt ratchet` to a runner label with newer glibc), then re-run the dependabot bump.        |
