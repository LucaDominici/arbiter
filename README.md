---
title: 'Arbiter — AI governance that installs itself.'
doc_version: '1.0.0'
status: active
last_review: '2026-07-09'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/spine']
related: []
---

# Arbiter

**AI governance that installs itself — and can't be faked.**

[![No Telemetry](https://img.shields.io/badge/telemetry-none-brightgreen)](PRIVACY.md)
[![npm version](https://img.shields.io/npm/v/@arbiter/cli)](https://www.npmjs.com/package/@arbiter/cli)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](https://nodejs.org/)

```bash
npx @arbiter/cli init
```

Run init in a repository that already contains a supported language marker. In a new empty
directory, pass it explicitly (for example, `npx @arbiter/cli init --language typescript`):
arbiter exits non-zero when the language is unknown because the naming and test-pyramid checks
cannot be configured honestly.

![Terminal demo: arbiter init scaffolds governance for a TypeScript project, then the L1 gate runs clean](docs/assets/demo.svg)

Coding agents are great at writing code and even better at claiming it works.
Arbiter makes "done means tested" mechanical: `npx @arbiter/cli init` gives your
repo a single canonical rulebook, gates that fail loudly, and evidence checks
anchored to git history. If the test never failed first, the task doesn't
advance. No telemetry, no server, no lock-in — delete the generated files and
it's gone.

---

## Three primitives

Arbiter is built on three ideas. Everything else — hooks, gates, generators,
CLI flags — is plumbing in service of them. (Full treatment: [docs/CONCEPTS.md](docs/CONCEPTS.md).)

### Evidence-gated "done"

A task isn't done because someone says it's done — it's done because the
artifacts prove it. Arbiter's TDD-evidence checks and `stop-evidence-guard`
hook (INV-114) require a test that failed before the fix and passes after it,
correlated to the current branch and commit SHA, before a completion claim is
accepted. A claim with no matching evidence is rejected like a failing gate —
agents can't fake green.

### Governance that installs itself

One `arbiter init` emits `AGENTS.md` (the canonical governance file every
supported AI tool reads), thin per-tool pointer files, hooks, gates, and a
matching CI workflow — all ordinary, version-controlled files. Re-running
`arbiter init` — or `arbiter update` / `arbiter diff` to preview what would
change — refreshes what arbiter manages and leaves your customizations alone.

### Task lifecycle with teeth

Work moves through a fixed, machine-checked phase sequence — plan → red (a
failing test written first) → green (the fix makes it pass) → verify → ship —
and each advance is gate-blocked: `arbiter task advance` runs that phase's gate
and refuses to move forward on red. Any agent (human-directed or autonomous)
can drive it; the phase machine enforces the order regardless of who's behind
the wheel.

---

## Quickstart

```bash
npx @arbiter/cli init
```

1. Ask your coding agent to implement a change and report done.
2. It can't — the `stop-evidence-guard` hook blocks the completion claim
   because there's no correlated evidence yet (INV-114).
3. Write a failing test first, then record it: `arbiter task record-red --test-path <file>`.
4. Implement until the test passes.
5. `node scripts/check-all.mjs L1` goes green — now "done" is accepted, because
   it's backed by a test that failed before the fix and passes after it.

That's the whole loop. For the full ten-minute walkthrough — install options,
what lands in your repo, uninstalling — see [docs/QUICKSTART.md](docs/QUICKSTART.md).

The full gate supports 4-core development machines. Step timeouts preserve the
measured 10-minute budget of the 24-core reference runner by scaling it with
available cores (`10 minutes × 24 / cores`, with a 10-minute floor). A killed
step is reported as `TIMEOUT`, separately from a command or assertion failure.

---

## Stack support

**Supported:** TypeScript, Java, Go, Python, Rust · Claude Code, Codex.
**Experimental:** Kotlin · Cursor, Aider, Copilot, Gemini, Windsurf.

> Tier rule: a language is **Supported** iff all of its _required cells_ —
> `static_analysis`, `coverage`, `architecture`, `security` in
> [`src/compatibility/cross-language-matrix.json`](src/compatibility/cross-language-matrix.json)
> — are `proven`; otherwise **Experimental**. Kotlin is `beta` on all four, so
> it is the sole Experimental language today.

| Language   | Detected from              | Build tool   | Lint          | Format   | Status       |
| ---------- | -------------------------- | ------------ | ------------- | -------- | ------------ |
| TypeScript | `package.json`             | npm          | eslint        | prettier | Supported    |
| Java       | `pom.xml` / `build.gradle` | gradle/maven | checkstyle    | spotless | Supported    |
| Rust       | `Cargo.toml`               | cargo        | clippy        | rustfmt  | Supported    |
| Go         | `go.mod`                   | go           | golangci-lint | gofmt    | Supported    |
| Python     | `pyproject.toml`           | pip/uv       | ruff          | ruff     | Supported    |
| Kotlin     | `build.gradle.kts`         | gradle       | detekt        | —        | Experimental |

---

## See it for real

[`examples/ts-library/`](examples/ts-library/), [`examples/python-library/`](examples/python-library/),
and [`examples/go-library/`](examples/go-library/) are exactly what `arbiter init` generates today for
each of these three stacks (TypeScript, Python, Go) — not a hand-curated demo. A dedicated CI cell in the
[Generator Matrix workflow](.github/workflows/generator-matrix.yml) regenerates all three on a
weekly cadence and before every pre-release, and fails the build on any drift, so these
directories can't go stale. See
[`examples/README.md`](examples/README.md) for how to regenerate them yourself and for the
hand-written walkthroughs covering the other archetypes (frontend-spa, backend-web-db, cli,
data-pipeline).

---

## What gets generated

| Path                           | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `AGENTS.md`                    | Canonical governance doc every AI tool reads  |
| `.claude/` / `.agents/`        | Tool-specific hooks, rules, and pointer files |
| `.github/workflows/ci.yml`     | CI gate mirroring the local check             |
| `scripts/check-all.mjs`        | The local gate runner (`L1`/`L2`/`L3`/`L4`)   |
| `SECURITY.md`, `.editorconfig` | Baseline repo hygiene files                   |

Everything arbiter generates is a normal, version-controlled file. Uninstalling
is a file operation, not a service to tear down:

```bash
rm -rf .claude/ .agents/ scripts/check-all.mjs AGENTS.md
git checkout -- .github/   # or remove hand-picked generated workflow files
```

See [docs/QUICKSTART.md](docs/QUICKSTART.md#4-uninstall) for the full uninstall
walkthrough, including restoring backed-up files.

The public CLI surface is 15 commands: `init`, `update`, `diff`, `configure`,
`doctor`, `validate`, `task`, `ship`, `note`, `gold-audit`, `worktree`,
`gate-exec`, `review`, `explain`, `obsidian`.
Experimental commands are hidden from default `--help` but stay fully
functional — list them with `arbiter help --all`. See the
[CLI Reference](website/reference/cli.md) for full option documentation.

---

## Privacy

**No telemetry.** Arbiter collects zero usage data and makes zero unsolicited
network calls. See [PRIVACY.md](PRIVACY.md).

### How it compares

| Capability                      | arbiter | BMAD | GSD2 | claude-flow | spec-kit |
| ------------------------------- | ------- | ---- | ---- | ----------- | -------- |
| Canonical governance file       | ✓       | —    | —    | —           | —        |
| Evidence-gated completion       | ✓       | —    | —    | —           | —        |
| Idempotent, re-runnable install | ✓       | —    | —    | —           | —        |
| Zero telemetry                  | ✓       | —    | —    | —           | —        |
| Specialized sub-agents¹         | ✓       | ✓    | ✓    | ✓           | —        |

> ¹ Provided by arbiter's **optional orchestration layer** (`/ship`, `/drain`, and
> sub-agents) — distinct from the installer **core** (rows above), which is
> usable on its own. [Full comparison →](website/comparisons/index.md)

---

## Status

Beta. TypeScript, Java, Go, Python, and Rust are supported; Kotlin is
experimental (see [Stack support](#stack-support) for the tier rule). Issues and PRs welcome — no SLA.

---

## Learn more

- [docs/QUICKSTART.md](docs/QUICKSTART.md) — the full ten-minute path
- [docs/CONCEPTS.md](docs/CONCEPTS.md) — the three ideas, in depth
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — contributing to arbiter itself
- [SECURITY.md](SECURITY.md) — reporting a vulnerability

---

## Sponsoring

arbiter is maintained by volunteers. If you find it useful, consider [sponsoring via GitHub Sponsors](https://github.com/sponsors/LucaDominici).
