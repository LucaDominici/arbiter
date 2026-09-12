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
npx @getarbiter/cli init

# Non-interactive (CI / scripted setup)
npx @getarbiter/cli init --yes

# Pick tools and a governance level explicitly
npx @getarbiter/cli init --yes --tools claude,codex --level L2
```

Requires Node.js ≥ 22 and the `gh` CLI authenticated (`gh auth login`) if you want
GitHub integration (labels, PR templates, issue templates).

The wizard detects your stack (TypeScript, Java, Rust, Go, Python) and asks which
AI tools you use (Claude Code, Codex) and which governance level to start at.
When in doubt, start at **L2** — see [CONCEPTS.md](CONCEPTS.md#gate-blocked-task-lifecycle)
for what each level gates.

### Git-pinned installs with Bun

When installing an immutable Arbiter Git revision with Bun, trust only
`@getarbiter/cli` so its prepare lifecycle can build the local CLI. If the package
has neither `dist/cli.js` nor a local TypeScript compiler, prepare runs
`npm ci --include=dev --ignore-scripts` against Arbiter's committed lockfile,
then runs its build. This requires npm and registry access; bootstrap scripts
are disabled to prevent recursion, while the explicit build remains enabled.
Ordinary contributor installs still leave building to the contributor.

### What init detects before it writes

`init` verifies the local toolchain **before creating or changing any file**. A failed
verification therefore leaves the target untouched; fix the reported tool issue and re-run,
or explicitly use `--no-verify` when that is appropriate for your setup.

For TypeScript projects, init also resolves the package manager from `package.json`'s
`packageManager` field first, then from lockfiles (`pnpm-lock.yaml`, `bun.lock`/`bun.lockb`,
`yarn.lock`, `package-lock.json`), falling back to npm. Generated build, test, lint, and
format gate commands invoke that detected manager rather than assuming `npm`.

### Before running generated document runners

The generated document, freshness, arc42, and gold-audit runners use the root-local
`@getarbiter/cli`; init never installs it. Choose an immutable package spec outside init, then
use the project’s existing manager and lockfile:

```bash
arbiter_spec='@getarbiter/cli@<EXACT_VERSION>'
# Or: arbiter_spec='github:LucaDominici/arbiter#<FULL_40_HEX_SHA>'

npm install --save-dev --save-exact "$arbiter_spec"
# pnpm: pnpm add --save-dev --save-exact "$arbiter_spec"
# yarn: yarn add --dev --exact "$arbiter_spec"
# bun (POSIX shells): COREPACK_ENABLE_PROJECT_SPEC=0 bun add --dev --exact --trust "$arbiter_spec"
```

The Bun command scopes the Corepack override to that one install and trusts only
`@getarbiter/cli`, so its Git dependency prepare step can build the local checker.
Use it in a POSIX shell (for example sh, bash, or zsh); Windows shell syntax is
not covered by this command.

For Go, Python, and JVM projects this stays root-local governance tooling; it does not
migrate application dependencies or native commands.

Framework detection reads root-level dependency signals. React, Vue, Angular, Svelte, Solid,
Preact, Vite, and Tauri map to the `frontend-spa` archetype; Next, Astro, Nuxt, SvelteKit,
Express, and Fastify map to `backend-web-db`. The archetype in turn selects the applicable
generators and gate families (for example SPA render-smoke/i18n checks versus public-API checks).

## 2. What gets generated

Two lists, because two things decide what lands. Everything in the first table is
written by every `init`. Everything in the second is written only when GitHub is
permitted — `arbiter init --github` (or `permitGitHub: true` in `arbiter.json`);
without it no `.github/` directory is created at all.

### Always generated

| Path                    | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `AGENTS.md`             | Canonical governance doc every AI tool reads                  |
| `arbiter.json`          | The stored config every later `update`/`diff` reads           |
| `.claude/` / `.agents/` | Tool-specific hooks, rules, and pointer files (per `--tools`) |
| `scripts/check-all.mjs` | The local gate runner (`L1`/`L2`/`L3`/`L4`)                   |
| `.githooks/`            | pre-commit (`L1`), pre-push (`L2`), commit-msg                |
| `SECURITY.md`           | Vulnerability-reporting policy                                |
| `CONTRIBUTING.md`       | Contribution + gate expectations for the repo                 |
| `.editorconfig`         | Baseline whitespace/charset hygiene                           |
| `.nvmrc`                | Node version the emitted governance tooling runs on           |
| `commitlint.config.js`  | Conventional-commit config the `commit-msg` hook reads        |

### Generated only with `--github`

| Path                                   | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `.github/workflows/01-pr-fast.yml`     | The PR gate mirroring the local `L1` check                     |
| `.github/workflows/02-pr-extended.yml` | The extended lane mirroring `L2` (more lanes at higher levels) |
| `.github/PULL_REQUEST_TEMPLATE.md`     | PR template                                                    |
| `.github/ISSUE_TEMPLATE/`              | Bug / feature / task-brief / epic forms                        |
| `.github/labels.yml`                   | Label set the workflows apply                                  |
| `.github/dependabot.yml`               | Dependency update schedule                                     |
| `.github/CODEOWNERS`                   | Review routing — only when a GitHub owner is detected          |

`examples/ts-library/` is a materialized `init` without `--github`: every row of the
first table is in it, and none of the second.

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

### Preview before anything is written

Every "what would this do to my repo?" question has exactly one read-only answer, and none
of them writes a byte:

- **Before adoption** — `npx @getarbiter/cli init --yes --dry-run` names every file `init`
  would create and every existing file it would keep untouched. The preview is the real
  generator plan executed in dry mode, not a separately maintained summary, so what it lists
  is what the run without `--dry-run` does.
- **After adoption** — `arbiter diff` is the whole-run preview of `arbiter update` (`update`
  with the writes elided); `arbiter diff --withheld` narrows it to the template fixes held
  back from files you have edited; `arbiter update --adopt-plan` previews exactly which of
  those adoption would overwrite. See
  [REFERENCE/file-stability.md](REFERENCE/file-stability.md).

There is no `update --dry-run`. `diff` already is the whole-run preview of `update`, and a
second spelling of it would be one more surface that can drift away from the run it claims
to describe.

## 3. Run your first gated task

On a JavaScript/TypeScript project, install first. `init` adds the toolchain its gate
invokes (`typescript`, `@types/node`, `eslint`, `@eslint/js`, `typescript-eslint`,
`prettier`, `vitest`) to your `devDependencies`, but it never runs a package manager on
your behalf — so the gate cannot resolve any of them until you do. `init` prints this
step before the gate command; run them in that order:

```bash
npm install                     # or pnpm/yarn/bun — whatever init detected
```

Every change then flows through the same local gate before it can be committed:

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
