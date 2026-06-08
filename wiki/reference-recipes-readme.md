---
generated: true
source: 'docs/REFERENCE/recipes/README.md'
source_sha: '51db2b501c629f3e3e50a335a7be7fb9c67f71f7'
last_updated: '2026-06-08'
---

# arbiter Recipes

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/recipes/README.md](../docs/REFERENCE/recipes/README.md)

# arbiter Recipes

Practical, step-by-step guides for common arbiter adoption scenarios. This is the
**internal / contributor** recipe home; the public, adopter-facing recipe hub is the
VitePress site under `website/recipes/`. The two are complementary — see the note below.

| Recipe                                                               | Description                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------- |
| [tdd-enforcement.md](./tdd-enforcement.md)                           | Wire TDD red/green/refactor phase enforcement           |
| [compose-with-frontend-design.md](./compose-with-frontend-design.md) | Combine arbiter with frontend-design plugin             |
| [migrate-from-spec-kit.md](./migrate-from-spec-kit.md)               | Migrate from Microsoft Spec Kit                         |
| [migrate-from-bmad.md](./migrate-from-bmad.md)                       | Map BMAD-METHOD constructs to arbiter equivalents       |
| [monorepo-adoption.md](./monorepo-adoption.md)                       | Adopt arbiter in turborepo / nx / pnpm workspaces       |
| [custom-invariant-advanced.md](./custom-invariant-advanced.md)       | Cross-file, AST-based, and language-specific invariants |
| [custom-ai-tool-target.md](./custom-ai-tool-target.md)               | Add a custom AI tool target via the plugin route        |
| [customize-wizard.md](./customize-wizard.md)                         | Pre-fill, extend, and skip wizard prompts               |
| [brownfield-existing-ci.md](./brownfield-existing-ci.md)             | Add arbiter gates to an existing CI/CD pipeline         |
| [recover-from-update-failure.md](./recover-from-update-failure.md)   | Recover when `arbiter update` fails mid-flight          |
| [B10-debug-mode.md](./B10-debug-mode.md)                             | Debug an arbiter command (`--debug` / `--log-format`)   |
| [perf-debugging.md](./perf-debugging.md)                             | Profile a slow command (`--profile`, `.cpuprofile`)     |
| [sibling-worktree.md](./sibling-worktree.md)                         | Work in an isolated sibling git worktree                |
| [cost-optimized-phase-handoff.md](./cost-optimized-phase-handoff.md) | Phase 3.5 cost-optimized handoff across `/clear`        |

> **Internal vs public:** `brownfield-existing-ci.md` and `custom-invariant-advanced.md` are
> contributor deep-dives that complement the public intros at `website/recipes/brownfield.md`
> and `website/recipes/custom-invariant.md`. The four operational playbooks at the bottom
> (debug, perf, worktree, phase-handoff) were consolidated here from the former `docs/RECIPES/`
> home (#1100) — see `docs/METHOD/CANONICAL_PATHS.md` for the redirects.
