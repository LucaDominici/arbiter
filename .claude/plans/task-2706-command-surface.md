---
task: '#2706'
title: Atomic cut of the public and emitted command surface
base_sha: 149851f1775237c2a41d8c10ceec83b8eab17650
status: approved-for-implementation
---

# Outcome

Ship one incompatible command vocabulary across the installed CLI, generated consumers, slash commands, examples, and documentation. Old spellings must be absent and rejected. Existing handlers remain the implementation authority; this task only moves their public routes and deletes superseded wrappers.

# Frozen surface

Daily roots:

```text
init  configure  update  ship  status  explain
```

Advanced roots:

```text
lifecycle  check  audit  finding  docs  graph  worktree  review
```

No aliases or hidden legacy roots remain.

## Capability map

| Retired route | Canonical route | Decision |
|---|---|---|
| `note` | `finding add` | Reuse the current spool writer. |
| `finding list/triage/promote` | unchanged beneath `finding` | Make the existing namespace public. |
| `task init` | `lifecycle start` | Avoid collision with project `init`. |
| `task get` | `lifecycle get` | Preserve shell-consumer field access. |
| `task resume/advance/recover/host-preflight/record-red/record-tech-debt` | `lifecycle resume/advance/recover/preflight/record-red/record-debt` | Route to existing handlers without renaming internals. |
| `mark` | `lifecycle checkpoint` | Preserve cold-resume cursor state. |
| `validate` / `verify` | `check environment` | Remove the alias pair. |
| `validate evidence/plan/tdd` | `check evidence/plan/tdd` | Preserve existing verification handlers. |
| `validate graph` | `graph check` | Graph-specific operation belongs with graph. |
| `gate-exec` | `check run` | Preserve mutex and child exit propagation. |
| `doctor tool-pins/fail-open-census` | `check tool-pins/fail-open` | Deterministic checks join the check namespace. |
| `gold-audit` | `audit readiness` | Preserve gold/readiness engine and flags. |
| `doc-set` audit modes | `audit docs` | Presence, strict, freshness, and arc42 are audits. |
| feature-matrix product audit | `audit product` | Use the existing #2414 checker through one packaged handler; no duplicate evidence store. |
| `doc-set` write modes | `docs scaffold` | `--generate`, `--plan`, `--apply`, and safe refresh remain available. |
| `obsidian` | `docs vault` | Preserve sync/validate behavior under the docs namespace. |
| `review graph build` | `graph build` | Remove the stale hidden nesting. |
| `review diff` | `graph diff` | It compares graph snapshots. |
| `review cross-model` | unchanged beneath `review` | The only distinct read-only review operation. |
| `settings` | `configure show` | Preserve declared/effective/source catalog output. |
| `method [status]` | `configure method` | Preserve the feature lens and interactive path. |
| `upgrade-level` | `configure level` | Preserve grace-period behavior. |
| `ignore add/remove` | `configure ignore add/remove` | It changes update ownership configuration. |
| `plugin add/list` | `configure plugin add/list` | Plugins are configured product extensions. |
| `diff` | `update --dry-run` | Fold preview, `--withheld`, and `--governance` into update. |
| `doctor health` / bare `doctor` | `status health` | Preserve health, repair option, interactive mode, and gate proof. |
| `doctor repair-state/recover-lock/clean` | `lifecycle repair-state/recover-lock/clean` | Recovery mutates Arbiter lifecycle state. |
| `worktree adopt/relink/list` | `worktree prepare/relink/check` | Native host creates and removes checkouts; Arbiter prepares links and reports integrity. `prepare` reuses adopt. `check` reuses the existing inventory/validation path. |
| `worktree open/close/prune`, alias `wt` | removed | Superseded by native host ownership; no parallel worktree manager remains. |

The root spellings `note`, `task`, `mark`, `validate`, `verify`, `gate-exec`, `gold-audit`, `doc-set`, `settings`, `method`, `upgrade-level`, `diff`, `doctor`, `ignore`, `plugin`, `obsidian`, and `wt` must fail as unknown commands. Internal filenames may retain legacy names where they do not leak into the user contract.

# Three deliverables

## D1 — Executable CLI contract

Owner paths: `src/cli.ts`, only the existing command modules needed to expose a real packaged product-audit handler, and focused CLI tests.

1. Write RED contract tests that assert the exact 14-root surface, representative success and malformed input for every registered leaf, explicit rejection of every retired spelling, and PASS=0 / FAIL=1 / ERROR=2 where the underlying handler distinguishes them.
2. Re-parent existing Commander registrations and reuse existing handlers. Add no router, registry, alias layer, evidence store, or migration framework.
3. Give `audit product` a real packaged implementation by extracting/reusing the smallest product-completeness core already owned by `check-feature-matrix`; the script and CLI must call the same core.
4. Replace `diff` with update preview flags and preserve read-only behavior.

Verification: focused command tests plus an installed CLI invocation proves canonical success, malformed input, legacy rejection, and child exit propagation.

## D2 — Emitted surface and brownfield migration

Owner paths: `.claude/commands/`, `src/templates/claude/commands/`, `src/generators/claude.ts`, existing retirement lists/manifests, and their tests.

1. Emit exactly `/ship`, `/drain`, `/impact`, `/review`, `/audit`, `/tabletop`.
2. Update those six owners and templates to call canonical CLI routes.
3. Remove obsolete wrappers (`task`, `status`, `replay`, `wt-*`, `gold-audit`, `review-code`, and any other non-canonical slash entry) from generator ownership and record them as retired managed artifacts.
4. Reuse `planRetirement` / `applyRetirement`: delete pristine retired files atomically; preserve modified retired files and print an actionable incompatibility diagnostic before other writes.

Verification: clean consumer migration, modified-retired-file preservation, no partial write on incompatible migration, and generator/render parity.

## D3 — Distribution and contract propagation

Owner paths: the source-owned CLI reference/catalog, package `files` only if the shared audit core requires it, active EJS/templates/examples/docs, generated snapshots/manifests, and focused packaging tests.

1. Replace active legacy command examples and references with canonical routes; historical changelog/ADR records remain historical unless they are executable instructions.
2. Regenerate derived artifacts from owners; do not hand-edit generated masters independently.
3. Pack with `npm pack`, install in a temporary consumer, and exercise at least `init`, `configure show`, `check environment`, `audit product`, and legacy rejection.
4. Search committed output for the prohibited external benchmark repository identities and paths.

Verification: source/help/templates/generator/examples/docs parity and tarball consumer proof.

# TDD and landing protocol

1. Commit failing contract tests (RED).
2. Implement D1, D2, and D3 in that order; each must leave its focused suite green before proceeding.
3. Reconcile all findings from a review round in one fix batch.
4. Run L1. Complete all fixes, then freeze candidate HEAD and base SHA.
5. Run one independent final review and acceptance-fit review on that exact SHA using shared test evidence.
6. Any rework creates one fix commit, a new frozen SHA, and invalidates prior review evidence.
7. Run one final L2 on the accepted SHA, push once, create the PR, babysit CI, merge, and verify issue closure.

# Explicit non-goals

- No compatibility/deprecation period: Luca is the sole user and approved the atomic cut.
- No cosmetic renaming of internal modules.
- No new orchestrator, command registry, evidence store, worktree manager, or general migration framework.
- No changes to product behavior behind handlers except the minimum shared extraction required for a real `audit product` route.
- No new metrics or blocking bureaucracy.

# Done

`#2706` is done only when the PR is merged, CI is green, the issue is closed, the installed tarball exposes exactly the frozen surface, and a brownfield consumer has proven safe retirement behavior.
