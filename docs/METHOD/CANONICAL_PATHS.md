---
title: 'Canonical Paths — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/ssot']
related: []
---

# Canonical Paths — arbiter

**Purpose:** Aliasing registry for documents that have moved or been renamed. Before reporting a broken link, check this file for a redirect.
**Location:** `docs/METHOD/CANONICAL_PATHS.md`

---

## Aliases

| Old Path                                        | Current Path                                             | Moved Date |
| ----------------------------------------------- | -------------------------------------------------------- | ---------- |
| `docs/ARCHITECTURE/CANONICAL-SOURCE-MODEL.md`   | `docs/architecture/ARCHITECTURE.md`                      | 2026-05-19 |
| `docs/ARCHITECTURE/CONFLICT-RESOLUTION.md`      | `docs/architecture/ARCHITECTURE.md`                      | 2026-05-19 |
| `docs/ARCHITECTURE/OVERVIEW.md`                 | `docs/architecture/ARCHITECTURE.md`                      | 2026-05-19 |
| `docs/ARCHITECTURE/TEMPLATE-SYSTEM.md`          | `docs/architecture/ARCHITECTURE.md`                      | 2026-05-19 |
| `docs/AUDIT/compat-fixes-854-855-2026-05-18.md` | `docs/audits/compat-fixes-854-855-2026-05-18.md`         | 2026-05-19 |
| `docs/RECIPES/B10-debug-mode.md`                | `docs/REFERENCE/recipes/B10-debug-mode.md`               | 2026-06-01 |
| `docs/RECIPES/perf-debugging.md`                | `docs/REFERENCE/recipes/perf-debugging.md`               | 2026-06-01 |
| `docs/RECIPES/sibling-worktree.md`              | `docs/REFERENCE/recipes/sibling-worktree.md`             | 2026-06-01 |
| `docs/RECIPES/cost-optimized-phase-handoff.md`  | `docs/REFERENCE/recipes/cost-optimized-phase-handoff.md` | 2026-06-01 |
| `docs/architecture/OVERVIEW.md`                 | `docs/architecture/ARCHITECTURE.md`                      | 2026-06-08 |
| `docs/architecture/CANONICAL-SOURCE-MODEL.md`   | `docs/architecture/ARCHITECTURE.md`                      | 2026-06-08 |
| `docs/architecture/TEMPLATE-SYSTEM.md`          | `docs/architecture/ARCHITECTURE.md`                      | 2026-06-08 |
| `docs/architecture/CONFLICT-RESOLUTION.md`      | `docs/architecture/ARCHITECTURE.md`                      | 2026-06-08 |
| `docs/architecture/dual-track-contract.md`      | `docs/architecture/ARCHITECTURE.md`                      | 2026-06-08 |
| `docs/architecture/evidence-bundle.md`          | `docs/architecture/ARCHITECTURE.md`                      | 2026-06-08 |
| `docs/architecture/skeleton-governance.md`      | `docs/architecture/ARCHITECTURE.md`                      | 2026-06-08 |
| `docs/architecture/README.md`                   | `docs/architecture/ARCHITECTURE.md`                      | 2026-06-08 |
| `docs/SYSTEM/detector-error-policy.md`          | `docs/METHOD/ENGINEERING_DEFAULTS.md`                    | 2026-06-08 |
| `docs/SYSTEM/FAIL_CLOSED.md`                    | `docs/METHOD/ENGINEERING_DEFAULTS.md`                    | 2026-06-08 |
| `docs/METHOD/TRACK_MODEL.md`                    | `docs/METHOD/PROCESS.md`                                 | 2026-06-08 |
| `docs/SYSTEM/POST_COMMIT_TRACKS.md`             | `docs/METHOD/PROCESS.md`                                 | 2026-06-08 |
| `docs/METHOD/DOC_SEMVER.md`                     | `docs/METHOD/PROCESS.md`                                 | 2026-06-08 |
| `docs/rfc/README.md`                            | `docs/METHOD/PROCESS.md`                                 | 2026-06-08 |
| `docs/TESTING_POLICY.md`                        | `docs/METHOD/TESTING.md`                                 | 2026-06-08 |
| `docs/MASTER_TEST_PLAN.md`                      | `docs/METHOD/TESTING.md`                                 | 2026-06-08 |
| `docs/TEST_TAXONOMY.md`                         | `docs/METHOD/TESTING.md`                                 | 2026-06-08 |
| `docs/METHOD/SELF_VALIDATION_PROTOCOL.md`       | `docs/METHOD/TESTING.md`                                 | 2026-06-08 |
| `docs/SYSTEM/E2E-RUNTIMES.md`                   | `docs/METHOD/TESTING.md`                                 | 2026-06-08 |
| `docs/GOVERNANCE/index.md`                      | `docs/GOVERNANCE.md`                                     | 2026-06-08 |
| `docs/GOVERNANCE/RACI.md`                       | `docs/GOVERNANCE.md`                                     | 2026-06-08 |
| `docs/SYSTEM/ID-STABILITY.md`                   | `docs/GOVERNANCE.md`                                     | 2026-06-08 |
| `docs/METHOD/TAG_TAXONOMY.md`                   | `docs/GOVERNANCE.md`                                     | 2026-06-08 |
| `docs/GOVERNANCE/GOOD-FIRST-ISSUE-POLICY.md`    | `docs/GOVERNANCE.md`                                     | 2026-06-08 |
| `docs/QUICKSTART.md`                            | `docs/CONTRIBUTING.md`                                   | 2026-06-08 |
| `docs/SETUP.md`                                 | `docs/CONTRIBUTING.md`                                   | 2026-06-08 |
| `docs/install/windows.md`                       | `docs/CONTRIBUTING.md`                                   | 2026-06-08 |
| `docs/CODING_STANDARDS.md`                      | `docs/CONTRIBUTING.md`                                   | 2026-06-08 |
| `docs/DEVELOPMENT/GETTING-STARTED.md`           | `docs/CONTRIBUTING.md`                                   | 2026-06-08 |
| `docs/DEVELOPMENT/CONVENTIONS.md`               | `docs/CONTRIBUTING.md`                                   | 2026-06-08 |

---

## Usage

When a document is moved or renamed:

1. Add a row to the Aliases table above: `| \`old/path.md\` | \`new/path.md\` | YYYY-MM-DD |`
2. The `check-doc-links.mjs` gate will follow this redirect instead of reporting a broken link.
3. Do not remove old alias entries — they provide a permanent redirect trail.
4. Run `node scripts/check-canonical-paths.mjs` to verify all redirect targets exist.
