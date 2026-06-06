---
generated: true
source: 'docs/PRODUCT/RELEASE-V1-TRACKING.md'
source_sha: 'cf83feaa8a930ede720c67fa72092536c233696c'
last_updated: '2026-06-06'
---

# Release v1 (Public OSS Launch) — Issue Tracking

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/RELEASE-V1-TRACKING.md](../docs/PRODUCT/RELEASE-V1-TRACKING.md)

# Release v1 (Public OSS Launch) — Issue Tracking

> **Tracking label:** [`release/v1-public`](https://github.com/LucaDominici/arbiter/labels/release%2Fv1-public)
> **Created:** 2026-05-13
> **Total issues:** 172 (156 children + 16 umbrellas), plus 7 extension comments on existing issues
> **State file:** `/tmp/release-v1-state.json`

## Locked Decisions

| Decision              | Value                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| License               | Apache 2.0                                                                                                                                                                                                                             |
| TDD enforcement       | W4 hybrid — skill + phase-split (red/green/refactor) + verification evidence                                                                                                                                                           |
| Skill integration     | Detect + adapt + curated `skills-matrix.json` (DETECT-REFERENCE only, never copy)                                                                                                                                                      |
| Windows support       | WSL2 documented + tested CI lane                                                                                                                                                                                                       |
| Telemetry             | NONE, documented in PRIVACY.md                                                                                                                                                                                                         |
| Stability posture     | Explicit semver + deprecation pipeline + experimental flag system (EPIC-K)                                                                                                                                                             |
| QA posture            | 3-ring pre-release pattern: automated continuous + release-gated + continuous monitoring (EPIC-G)                                                                                                                                      |
| Failure-mode posture  | Atomic-rename transactional writes + signal handlers + lock files + checksum-verified state (EPIC-L)                                                                                                                                   |
| Observability posture | Local-only structured logging, replay logs, trace IDs — never network (EPIC-M)                                                                                                                                                         |
| Distribution channels | Three npm dist-tags — `latest` (stable) / `beta` (RC) / `canary` (every main merge) (EPIC-Q)                                                                                                                                           |
| Positioning           | No quantitative ROI claims; honest counter-marketing (EPIC-R)                                                                                                                                                                          |
| i18n                  | Scaffolded in v1 (en only); contribution path documented; translations community-driven post-v1 (EPIC-P)                                                                                                                               |
| Workflow maturity     | Production-tested patterns ported from personal Claude config (`/auto` skill) + prior-art baseline (`context-rot-management`, `plan-reviewer`, `AGENT_REGISTRY`) — DETECT-REFERENCE only, arbiter-authored re-implementations (EPIC-S) |
| Phase 3.5 handoff     | Full port: Opus planning → /clear → Sonnet implementation with host-capability detection + cost monitor (EPIC-S.S15, size/XL)                                                                                                          |
| Worktree placement    | Default `.git/worktrees/` preserved; `--sibling` opt-in flag with auto-symlinks (EPIC-S.S10)                                                                                                                                           |

## Epic Index

| Epic | Title                                                         | Tier | Umbrella                                                   |
| ---- | ------------------------------------------------------------- | ---- | ---------------------------------------------------------- |
| A    | Legal & Repo Hygiene                                          | 1    | [#575](https://github.com/LucaDominici/arbiter/issues/575) |
| B    | Docs Site MVP                                                 | 1    | [#576](https://github.com/LucaDominici/arbiter/issues/576) |
| C    | README + Positioning + Marketing Surface                      | 2    | [#577](https://github.com/LucaDominici/arbiter/issues/577) |
| D    | Onboarding & DX Polish                                        | 2    | [#578](https://github.com/LucaDominici/arbiter/issues/578) |
| E    | TDD Workflow + Skill Integration                              | 3    | [#579](https://github.com/LucaDominici/arbiter/issues/579) |
| F    | Community Infrastructure                                      | 3    | [#580](https://github.com/LucaDominici/arbiter/issues/580) |
| G    | Pre-Release QA & Validation                                   | 1    | [#622](https://github.com/LucaDominici/arbiter/issues/622) |
| K    | API Stability + Semver + Deprecation                          | 1    | [#623](https://github.com/LucaDominici/arbiter/issues/623) |
| L    | Failure-Mode Hardening                                        | 1    | [#624](https://github.com/LucaDominici/arbiter/issues/624) |
| M    | Observability without telemetry                               | 1    | [#668](https://github.com/LucaDominici/arbiter/issues/668) |
| N    | Extended Cookbook + Migration Recipes                         | 2    | [#669](https://github.com/LucaDominici/arbiter/issues/669) |
| O    | Self-Hosting Demo (arbiter applied to arbiter)                | 2    | [#670](https://github.com/LucaDominici/arbiter/issues/670) |
| P    | i18n scaffolding                                              | 3    | [#671](https://github.com/LucaDominici/arbiter/issues/671) |
| Q    | Update-channel infrastructure                                 | 1    | [#672](https://github.com/LucaDominici/arbiter/issues/672) |
| R    | Anti-overclaim positioning                                    | 2    | [#673](https://github.com/LucaDominici/arbiter/issues/673) |
| S    | Workflow Maturity Port (personal-config + prior-art baseline) | 1    | [#704](https://github.com/LucaDominici/arbiter/issues/704) |

## Tier 1 — Release-Blocker

### EPIC-A — Legal & Repo Hygiene · Umbrella: [#575](https://github.com/LucaDominici/arbiter/issues/575)

| ID  | Issue                                                      | Title                                   |
| --- | ---------------------------------------------------------- | --------------------------------------- |
| A1  | [#505](https://github.com/LucaDominici/arbiter/issues/505) | Add LICENSE (Apache 2.0) + SPDX headers |
| A2  | [#506](https://github.com/LucaDominici/arbiter/issues/506) | Replace SECURITY.m                      |

_[content truncated — see source for full text]_
