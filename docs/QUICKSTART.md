---
title: 'Quickstart — arbiter'
doc_version: '1.1.0'
status: active
last_review: '2026-08-03'
owner: ''
canonical_id: ''
tags: ['audience/user', 'kind/reference']
related: ['docs/CONCEPTS.md', 'docs/CONTRIBUTING.md']
---

# Quickstart

Ten minutes from `npx` to your first gated task. This page covers install, what
lands in your repo, running one task through the gate, and how to remove it all
if arbiter isn't for you.

---

## 1. Install

```bash
# Interactive wizard — recommended for a first run
npx @arbiter/cli init

# Non-interactive (CI / scripted setup)
npx @arbiter/cli init --yes

# Pick tools and a governance level explicitly
npx @arbiter/cli init --yes --tools claude,codex --level L2
```

Requires Node.js ≥ 22 and the `gh` CLI authenticated (`gh auth login`) if you want
GitHub integration (labels, PR templates, issue templates).

The wizard detects your stack (TypeScript, Java, Rust, Go, Python) and asks which
AI tools you use (Claude Code, Codex) and which governance level to start at.
When in doubt, start at **L2** — see [CONCEPTS.md](CONCEPTS.md#gate-blocked-task-lifecycle)
for what each level gates.

### What init detects before it writes

`init` verifies the local toolchain **before creating or changing any file**. A failed
verification therefore leaves the target untouched; fix the reported tool issue and re-run,
or explicitly use `--no-verify` when that is appropriate for your setup.

For TypeScript projects, init also resolves the package manager from `package.json`'s
`packageManager` field first, then from lockfiles (`pnpm-lock.yaml`, `bun.lock`/`bun.lockb`,
`yarn.lock`, `package-lock.json`), falling back to npm. Generated build, test, lint, and
format gate commands invoke that detected manager rather than assuming `npm`.

Framework detection reads root-level dependency signals. React, Vue, Angular, Svelte, Solid,
Preact, Vite, and Tauri map to the `frontend-spa` archetype; Next, Astro, Nuxt, SvelteKit,
Express, and Fastify map to `backend-web-db`. The archetype in turn selects the applicable
generators and gate families (for example SPA render-smoke/i18n checks versus public-API checks).

## 2. What gets generated

| Path                           | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `AGENTS.md`                    | Canonical governance doc every AI tool reads  |
| `.claude/` / `.agents/`        | Tool-specific hooks, rules, and pointer files |
| `<project>/.github/workflows/ci.yml`     | CI gate mirroring the local check             |
| `scripts/check-all.mjs`        | The local gate runner (`L1`/`L2`/`L3`/`L4`)   |
| `SECURITY.md`, `.editorconfig` | Baseline repo hygiene files                   |

Re-running `arbiter init` on an already-initialized repo is safe: `AGENTS.md` and
pointer files are refreshed (with a `.arbiter-backup`), `settings.json` is
deep-merged, and any hooks/rules/templates you've customized are left alone.

Init also recognizes a brownfield project from existing tests, CI workflows, or lint
configuration. If it finds one without `--brownfield`, it says so and proposes the explicit
baseline route instead of silently treating the repository as greenfield. For debt-enabled
JavaScript/TypeScript projects without `node_modules`, baseline capture is deliberately deferred:
run the detected manager's install command, then `node scripts/capture-debt-baseline.mjs`.
This is distinct from debt collection: an unavailable optional collector is a loud soft-skip,
while a collector that runs but cannot produce a trustworthy result is fail-closed.

## 3. Run your first gated task

Every change flows through the same local gate before it can be committed:

```bash
node scripts/check-all.mjs L1   # lint + format + unit tests — fast, pre-commit
node scripts/check-all.mjs L2   # L1 + integration tests + coverage + debt gates
```

A typical first task:

1. Create a branch (arbiter blocks direct edits on `main`).
2. Make your change with a failing test first (TDD is enforced, not suggested).
3. Run `node scripts/check-all.mjs L1` — fix anything red at the root cause, not
   by suppressing the check.
4. Commit. The pre-commit hook re-runs `L1`; pre-push runs `L2`.

If you're using Claude Code or Codex, the installed hooks and rules drive this
same flow automatically — see `.claude/CLAUDE.md` or `.agents/CODEX.md` in your
generated repo for the tool-specific entry points.

## 4. Uninstall

arbiter has no daemon, no background service, and no telemetry — removing it is
a file operation:

```bash
# Restore the pre-arbiter versions of overwritten files
mv AGENTS.md.arbiter-backup AGENTS.md   # if a backup was created

# Remove generated directories and files
rm -rf .claude/ .agents/ scripts/check-all.mjs AGENTS.md
git checkout -- .github/   # or remove hand-picked generated workflow files
```

Since everything arbiter generates is committed to your repo like any other
source file, `git status` before and after `init` shows exactly what changed —
review it and revert what you don't want with normal `git` commands.

## Next

- [CONCEPTS.md](CONCEPTS.md) — the three ideas arbiter is built on
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributing to arbiter itself
