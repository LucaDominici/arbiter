---
title: 'ADR-020: CLI-first over MCP for tool integrations'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-020: CLI-first over MCP for tool integrations

**Status:** Accepted
**Date:** 2026-04-11
**Deciders:** Luca Dominici
**Issue:** #95

## Context

Arbiter is a framework that generates governance and enforcement for target projects. Those projects must run their gates in CI, in a bare terminal, and under any AI coding harness (Claude Code, Cursor, Codex, Copilot). The Model Context Protocol (MCP) is useful in interactive agent sessions but introduces:

- Mandatory host-side setup — MCP servers are not available in GitHub Actions or in plain terminals.
- A different auth/config shape for every tool.
- Non-portable output formats outside the owning harness.
- A dependency on an evolving protocol.

Arbiter itself has never used MCP in `src/`, templates, hooks, or gates (verified 2026-04-11: zero references). But two leaks were leaving the door half-open:

1. **ADR-003** (gh CLI required) listed "GitHub MCP server" among alternatives with the text "may be added as an alternative path later".
2. **`docs/architecture/TEMPLATE-SYSTEM.md`** referenced a template `rules/mcp-usage.md` that was never created — a dangling reference.
3. **`docs/PRODUCT/FEATURE_COMPARISON.md`** listed MCP rows (75-78) as unqualified gaps vs the prior-art baseline, with no rationale about whether they were backlog or non-goals.

This ADR closes those leaks and formalises the policy that is already the de-facto practice.

## Decision

All tool integrations in arbiter — both internal to the framework and in the enforcement it generates for target projects — use direct CLI invocation. MCP servers are neither a hard dependency nor a supported fallback.

All new CLI invocations in runtime TypeScript (`src/**/*.ts`) MUST go through `src/utils/run-cli.ts`. EJS templates under `src/templates/` are stand-alone scripts shipped to target projects and use their own inline `spawnSync` — they cannot import the wrapper because they have no build dependency on arbiter. This is enforced via **INV-12** (see AGENTS.md) and the `.claude/hooks/check-no-direct-spawn.mjs` hook, which filters on `.ts`/`.tsx` files under `src/`.

## Rationale

- **CI portability.** CLI tools run everywhere — GitHub Actions, bare containers, editor terminals, local shells. MCP requires a live harness.
- **Frictionless distribution.** A target project that runs `arbiter init` does not have to configure any MCP server. The gates just work.
- **Uniformity.** `gh`, `git`, `node`, `cargo`, `gradlew`/`mvn`, `go`, `pytest` already cover every gate in L1/L2 across the five supported stacks.
- **Delegated auth.** Each CLI owns its own token/config — arbiter never touches secrets.
- **Testability.** A `spawnSync` with textual stdout is trivial to snapshot-test; an MCP handshake is not.

### Alternatives rejected

- **GitHub MCP as a fallback to `gh`** — rejected: doubles the code paths for no real benefit.
- **Hybrid pattern (CLI in CI, MCP interactively)** — rejected: two implementations to keep in sync.
- **HTTP direct to the GitHub API with a token from env** — already rejected in ADR-003 (token handling complexity).

## Consequences

**Positive:**

- Zero MCP setup on the target side → adoption friction drops to zero.
- The same gate runs in CI and locally → high confidence.
- A single wrapper (`src/utils/run-cli.ts`) centralises timeout, retry, and structured errors → uniform quality across every call site.
- INV-12 is machine-enforceable: `grep -rE "node:child_process" src/` may only match `src/utils/run-cli.ts`.

**Negative:**

- We forgo MCP-only features (for example, tools that expose typed schemas over MCP). Accepted — none of those are on the arbiter roadmap.
- We must parse CLI output (text or JSON). Mitigated by `runCliJson` and by the native `--json` / `--format json` flags of `gh`, `cargo`, `npm`, `pytest`.

## Supersedes / Amends

- **ADR-003** (gh CLI required): the "GitHub MCP server ... may be added as an alternative path later" clause is closed permanently by this ADR.
- **FEATURE_COMPARISON.md rows 75-78** (MCP Integration): reframed as explicit non-goals (rows 75, 78) or as "done via policy" (rows 76, 77).
