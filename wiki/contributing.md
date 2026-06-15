---
generated: true
source: 'docs/CONTRIBUTING.md'
source_sha: '50c57fa6a7973fe512b2aac0679b7caa4575676b'
last_updated: '2026-06-15'
---

# Contributing to arbiter

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md)

# Contributing to arbiter

Consolidated contributor guide: quickstart, repo setup, Windows/WSL2 install, coding standards, the getting-started development walkthrough, and contributor conventions. Sections below were previously separate files.

---

## arbiter — Quickstart

Five-minute install + first command + first gate run.

## 1. Install

```sh
npm install -g @arbiter/cli
# or run without installing
npx @arbiter/cli init
```

Requirements: Node.js ≥ 22, git ≥ 2.40.

## 2. Initialize a project

In a project directory:

```sh
arbiter init
```

`init` detects your stack (TypeScript / Python / Rust / Go / Java) and
governance level (L1 / L2 / L3 / L4), then materializes:

- `AGENTS.md` — invariant catalog
- `.claude/` or equivalent agent config
- `.githooks/` — pre-commit / pre-push hooks
- `.github/workflows/` — tiered CI workflows
- `scripts/check-all.mjs` — local gate orchestrator
- `arbiter.json` — project configuration

## 3. Run the gate

```sh
node scripts/check-all.mjs L1   # fast: lint + format + unit tests
node scripts/check-all.mjs L2   # full: L1 + coverage + integration
```

L1 must pass before commit, L2 before push. The `.githooks/` scripts enforce
both automatically once the git hook path is configured.

## 4. Verify hooks

```sh
git config core.hooksPath
# expected: .githooks
```

If empty, run `git config core.hooksPath .githooks` once.

## 5. Open a task

```sh
/ship #NNN                      # in Claude Code (orchestration entrypoint)
arbiter ship #NNN --tier Standard   # equivalent CLI
```

`/ship` is the single orchestration entrypoint — it auto-sequences an issue through
plan → red-team → TDD impl → review → gate → merge. Use `/task` subcommands only
for low-level engine control or recovery (`arbiter task advance`, `record-red`, etc.).

## Common next reads

- [`README.md`](../README.md) — feature overview
- [`SETUP.md`](./SETUP.md) — extended install + per-stack notes
- [`GOVERNANCE.md`](./GOVERNANCE.md) — invariants + ADRs
- [`architecture/README.md`](./architecture/README.md) — system internals
- [`api/README.md`](./api/README.md) — public API surface
- [`OBSIDIAN.md`](../OBSIDIAN.md) — open this repo as an Obsidian vault

## When something fails

- Gate red on lint/format → `npm run format && npm run lint --fix`
- Gate red on tests → run the failing test in isolation; do not bypass with `--no-verify`
- Gate red on TDD evidence (#NNN.json missing) → `arbiter task record-red --test-path <file>`
- Self-hosted CI runner offline → set repo variable `CI_BUILD_RUNNER_LABEL=ubuntu-latest` (default already ubuntu-latest as of #959)

---

## Repository Setup (CANON-01)

Arbiter generates `scripts/setup-repo.sh` for target projects. This document covers the equivalent steps for the **arbiter repo itself**.

## One-time GitHub setup

These steps are idempotent — safe to re-run.

### Prerequisites

- `gh` CLI installed and authenticated (`gh auth login`)
- Admin access to the `arbiter` repository

### Labels

```bash
gh label create "task"        --color "0075ca" --description "Tracked work item"      --force
gh label create "bug"         --color "d73a4a" --description "Something isn't working" --force
gh label create "enhancement" --color "a2eeef" --description "New feature or request"  --force
gh label create "docs"        --color "0052cc" --description "Documentation only"      --force
gh label create "in-progress" --color "fbca04" --description "Work in progress"        --force
gh label create "in-review"   --color "e4e669" --description "Under review"            --force
```

### Branch protection

```bash
gh api \
  --method PUT \
  "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/branches/main/protection" \
  --field "required_status_checks[strict]=true" \
  --field "required_status_checks[contexts][]=ci" \
  --field "enforce_admins=false" \
  --field "required_pull_request_reviews[required_approving_review_count]=1" \
  --field "restrictions=null" \
  --field "allow_force_pushes=false" \
  --field "allow_deletions=false"
```

### CI runner

The self-hosted runner `docker-ci-build` must be registered and online for CI jobs to run (see INV-13 in `AGENTS.md`).

---

## Windows Setup (WSL2)

**Issue:** #543

arbiter does not support native Win32. Use WSL2 (Windows Subsystem for Linux).

---

## Requirements

- Windows 10 version 2004+ or Windows 11
- WSL2 enabled (not WSL1)
- Ubuntu 22.04 or later distribution recommended

---

## Step 1: Enable WSL2

Open PowerShell as Administrator:

```powershell
wsl --install
```

This installs WSL2 + Ubuntu by default. Restart when prompted.

Verify WSL2 is the default version:

```powershell
wsl --set-default-version 2
```

---

## Step 2: Install Node.js inside WSL2

Open the Ubuntu terminal and run:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # should print v22.x.x
```

---

## Step 3: Install arbiter

```bash
npm install -g @arbiter/cli
arbiter --version
```

---

## Step 4: Verify your environment

```bash
arbiter doctor
```

All checks should PASS. If `git` is missing:

```bash
sudo apt-get install -y git
```

---

## Step 5: Initialize a project

```bash
cd /path/to/your/project
arbiter init
```

Your Windows filesystem is mounted at `/mnt/c/`. Example:

```bash
cd /mnt/c/Users/YourName/projects/my-app
arbiter init
```

---

## Troubleshooting

| Symptom                      | Fix                                                       |
| ---------------------------- | --------------------------------------------------------- |
| `arbiter: command not found` | Check `npm bin -g` is in `$PATH`                          |
| `git not found`              | `sudo apt-get install git`                                |
| Slow filesystem on `/mnt/c/` | Clone repos inside `/home/<user>/` for better performance |
| WSL1 detected                | `wsl --set-version Ubuntu 2`                              |

---

## Decision Record

arbiter supports WSL2 only (not native Win32) — see locked decision in `docs/PRODUCT/DECISIONS.md` (C7). The rationale: bash-based hooks and shell scripts require a POSIX environment. WSL2 provides this without significant friction for Windows developers.

---

## Coding Standards

_Generated by arbiter. Update to match your team's conventions._

## General

- Prefer immutable variables (const/val/final)
- Functions should have a single responsibility
- No magic numbers — use named constants
- Maximum cyclomatic complexity: 15

## TypeScript

- `strict: true` in tsconfig — mandatory
- No `any` type — use `unknown` and narrow, or create proper types
- Named exports preferred over default exports
- File naming: kebab-case.ts
- Linting: ESLint with `@typescript-eslint` ruleset
- Dead code: Knip (zero unused exports)
- Coverage threshold: 80% lines

## L3 Governance

- All public APIs must have OpenAPI/Swagger documentation
- Breaking changes require an ADR
- Architectural decision records: `docs/ADR/`
- Security review required for any auth, crypto, or external boundary changes

---

## Getting Started — Development Guide

This guide covers how to set up a local development environment, run the test suite, and extend arbiter with a new language detector or generator.

---

## Prerequisites

- **Node.js >= 20** — arbiter uses the native `node:fs`, `node:path`, and `node:child_process` APIs available since Node 18, but Node 20 is the minimum because `tsx` requires it.
- **npm >= 10** — comes bundled with Node 20.
- **gh CLI (optional)** — required only for running tests that exercise GitHub provisioning. See [ADR-003](ADR/003-gh-cli-required.md).
- **Git** — must be on `PATH` for detector tests that call `git` CLI.

---

## Setup

```bash
git clone https://github.com/LucaDominici/arbiter.git
cd arbiter
npm ci
```

`npm ci` installs exact versions from `package-lock.json`. Do not use `npm install` in development — it can mutate the lockfile.

---

## Running Tests

```bash
npm test         

*[content truncated — see source for full text]*
