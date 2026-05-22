---
title: 'Release v1 (Public OSS Launch) — Issue Tracking'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

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

| ID  | Issue                                                      | Title                                                                              |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A1  | [#505](https://github.com/LucaDominici/arbiter/issues/505) | Add LICENSE (Apache 2.0) + SPDX headers                                            |
| A2  | [#506](https://github.com/LucaDominici/arbiter/issues/506) | Replace SECURITY.md placeholder email + add PGP key + private vuln-report workflow |
| A3  | [#507](https://github.com/LucaDominici/arbiter/issues/507) | Add CODE_OF_CONDUCT.md (Contributor Covenant 2.1) + enforcement runbook            |
| A4  | [#508](https://github.com/LucaDominici/arbiter/issues/508) | Add NOTICE + auto-generated THIRD_PARTY_LICENSES via CI                            |
| A5  | [#509](https://github.com/LucaDominici/arbiter/issues/509) | Add CHANGELOG.md + adopt changesets                                                |
| A6  | [#510](https://github.com/LucaDominici/arbiter/issues/510) | npm-publish CI workflow (tag-triggered) + dry-run on every PR                      |
| A7  | [#511](https://github.com/LucaDominici/arbiter/issues/511) | Audit package.json files/exports + add .npmignore + size budget                    |
| A8  | [#512](https://github.com/LucaDominici/arbiter/issues/512) | Add .github/FUNDING.yml (GitHub Sponsors stub)                                     |
| A9  | [#513](https://github.com/LucaDominici/arbiter/issues/513) | Configure DCO bot for sign-off on all commits                                      |
| A10 | [#514](https://github.com/LucaDominici/arbiter/issues/514) | Lock npm namespace + squat protection                                              |
| A11 | [#515](https://github.com/LucaDominici/arbiter/issues/515) | Add PRIVACY.md documenting NO telemetry stance                                     |

### EPIC-B — Docs Site MVP · Umbrella: [#576](https://github.com/LucaDominici/arbiter/issues/576)

| ID  | Issue                                                      | Title                                                                             |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| B1  | [#516](https://github.com/LucaDominici/arbiter/issues/516) | Scaffold VitePress site under website/                                            |
| B2  | [#517](https://github.com/LucaDominici/arbiter/issues/517) | Docs site Information Architecture (IA)                                           |
| B3  | [#518](https://github.com/LucaDominici/arbiter/issues/518) | Cloudflare Pages auto-deploy on main + PR preview deploys                         |
| B4  | [#519](https://github.com/LucaDominici/arbiter/issues/519) | Migrate docs/REFERENCE/\* to docs site                                            |
| B5  | [#520](https://github.com/LucaDominici/arbiter/issues/520) | Public comparisons page (Spec Kit / BMAD / GSD2 / claude-flow / SuperClaude)      |
| B6  | [#521](https://github.com/LucaDominici/arbiter/issues/521) | 60-second Quickstart page with asciinema embed                                    |
| B7  | [#522](https://github.com/LucaDominici/arbiter/issues/522) | Algolia DocSearch application + fallback built-in search                          |
| B8  | [#523](https://github.com/LucaDominici/arbiter/issues/523) | Versioned docs (latest + next) with version switcher                              |
| B9  | [#524](https://github.com/LucaDominici/arbiter/issues/524) | Custom 404 + edit-this-page links + last-updated timestamps                       |
| B10 | [#525](https://github.com/LucaDominici/arbiter/issues/525) | Recipes/Cookbook section (custom invariant, custom generator, plugin, brownfield) |
| B11 | [#526](https://github.com/LucaDominici/arbiter/issues/526) | Light/dark theme + design tokens                                                  |

### EPIC-G — Pre-Release QA & Validation · Umbrella: [#622](https://github.com/LucaDominici/arbiter/issues/622)

| ID  | Issue                                                      | Tier | Title                                                                             |
| --- | ---------------------------------------------------------- | ---- | --------------------------------------------------------------------------------- |
| G1  | [#583](https://github.com/LucaDominici/arbiter/issues/583) | 1    | Full matrix smoke harness (archetype × language × tool × governance)              |
| G2  | [#584](https://github.com/LucaDominici/arbiter/issues/584) | 1    | Real-project brownfield matrix — clone real public OSS repos per language         |
| G3  | [#585](https://github.com/LucaDominici/arbiter/issues/585) | 1    | Generated tool-config validation — every emitted config parses with target tool   |
| G4  | [#586](https://github.com/LucaDominici/arbiter/issues/586) | 2    | Documentation code-block CI — every fenced block in README + docs site runs       |
| G5  | [#587](https://github.com/LucaDominici/arbiter/issues/587) | 1    | Hook regression suite — each hook fired against good + bad fixtures               |
| G6  | [#588](https://github.com/LucaDominici/arbiter/issues/588) | 2    | Performance budgets enforced — init / hook / gate timings                         |
| G7  | [#589](https://github.com/LucaDominici/arbiter/issues/589) | 2    | Migration test harness — v0.x config → current arbiter must read clean            |
| G8  | [#590](https://github.com/LucaDominici/arbiter/issues/590) | 1    | Security pre-release scan — gitleaks + socket.dev + npm audit + attestation       |
| G9  | [#591](https://github.com/LucaDominici/arbiter/issues/591) | 2    | Docs site a11y + responsive audit (axe-core + mobile checklist)                   |
| G10 | [#592](https://github.com/LucaDominici/arbiter/issues/592) | 1    | Cross-OS CLI E2E — ubuntu + macos + windows-wsl2 actual CLI run                   |
| G11 | [#593](https://github.com/LucaDominici/arbiter/issues/593) | 2    | Release rehearsal protocol — RC → alpha → smoke → promote                         |
| G12 | [#594](https://github.com/LucaDominici/arbiter/issues/594) | 2    | Beta tester program — recruit 20, structured feedback, 1:1 onboarding for first 5 |
| G13 | [#595](https://github.com/LucaDominici/arbiter/issues/595) | 3    | Mutation testing of arbiter own code (stryker)                                    |
| G14 | [#596](https://github.com/LucaDominici/arbiter/issues/596) | 3    | Long-running soak test — simulate 30d activity + weekly update cycles             |
| G15 | [#597](https://github.com/LucaDominici/arbiter/issues/597) | 2    | Pre-launch manual QA checklist — signed-off, repeatable                           |

### EPIC-K — API Stability + Semver + Deprecation · Umbrella: [#623](https://github.com/LucaDominici/arbiter/issues/623)

| ID  | Issue                                                      | Tier | Title                                                                     |
| --- | ---------------------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| K1  | [#598](https://github.com/LucaDominici/arbiter/issues/598) | 1    | Declare public surface — package.json exports + audited                   |
| K2  | [#599](https://github.com/LucaDominici/arbiter/issues/599) | 1    | Semver policy doc + what-counts-as-breaking matrix                        |
| K3  | [#600](https://github.com/LucaDominici/arbiter/issues/600) | 2    | Deprecation pipeline — N-release window, runtime warnings, doc badges     |
| K4  | [#601](https://github.com/LucaDominici/arbiter/issues/601) | 2    | Experimental feature flag system — --experimental.<feature>               |
| K5  | [#602](https://github.com/LucaDominici/arbiter/issues/602) | 1    | Public TS API snapshot tests (api-extractor / typedoc-snapshot)           |
| K6  | [#603](https://github.com/LucaDominici/arbiter/issues/603) | 1    | Plugin API stability marker (apiVersion) — bumped only on breaking change |
| K7  | [#605](https://github.com/LucaDominici/arbiter/issues/605) | 1    | arbiter.json config schema versioning + migration registry                |
| K8  | [#606](https://github.com/LucaDominici/arbiter/issues/606) | 2    | CLI flag deprecation lifecycle — warn → hide → remove                     |
| K9  | [#607](https://github.com/LucaDominici/arbiter/issues/607) | 1    | .arbiter-generated.json schema versioned + migration                      |
| K10 | [#608](https://github.com/LucaDominici/arbiter/issues/608) | 2    | Backward-compat test harness — v0.x fixtures readable by current arbiter  |
| K11 | [#609](https://github.com/LucaDominici/arbiter/issues/609) | 1    | Generated file format stability map — mark stable vs evolving             |
| K12 | [#610](https://github.com/LucaDominici/arbiter/issues/610) | 1    | INV-NN / CANON-NN ID stability policy — never reuse, redirects on rename  |

### EPIC-L — Failure-Mode Hardening · Umbrella: [#624](https://github.com/LucaDominici/arbiter/issues/624)

| ID  | Issue                                                      | Tier | Title                                                                                    |
| --- | ---------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| L1  | [#611](https://github.com/LucaDominici/arbiter/issues/611) | 1    | Disk-full simulation during init / update — graceful failure + cleanup                   |
| L2  | [#612](https://github.com/LucaDominici/arbiter/issues/612) | 2    | Network failure during plugin add — explicit error, no partial state                     |
| L3  | [#613](https://github.com/LucaDominici/arbiter/issues/613) | 1    | Interrupted operation (SIGTERM / SIGINT / Ctrl-C) — transactional writes + atomic rename |
| L4  | [#614](https://github.com/LucaDominici/arbiter/issues/614) | 2    | Concurrent invocation safety — file lock + refuse second instance                        |
| L5  | [#615](https://github.com/LucaDominici/arbiter/issues/615) | 2    | Hook race conditions — deterministic ordering on rapid edits                             |
| L6  | [#616](https://github.com/LucaDominici/arbiter/issues/616) | 2    | Filesystem permission errors — diagnostic message, not stack trace                       |
| L7  | [#617](https://github.com/LucaDominici/arbiter/issues/617) | 1    | Adverse git state detection — detached HEAD / rebase / merge / dirty tree                |
| L8  | [#618](https://github.com/LucaDominici/arbiter/issues/618) | 2    | Stale lockfile detection + recovery — PID-based orphan reaper                            |
| L9  | [#619](https://github.com/LucaDominici/arbiter/issues/619) | 1    | Corrupted .arbiter-generated.json handling — checksum + repair                           |
| L10 | [#620](https://github.com/LucaDominici/arbiter/issues/620) | 3    | Plugin error containment — per-plugin timeout + memory limit                             |
| L11 | [#621](https://github.com/LucaDominici/arbiter/issues/621) | 2    | Wizard mid-flow abort handling — partial state cleanup on Ctrl-C                         |

### EPIC-M — Observability without telemetry · Umbrella: [#668](https://github.com/LucaDominici/arbiter/issues/668)

| ID  | Issue                                                      | Tier | Title                                                                                 |
| --- | ---------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------- |
| M1  | [#635](https://github.com/LucaDominici/arbiter/issues/635) | 2    | Structured CLI logging — log levels + JSON output mode                                |
| M2  | [#636](https://github.com/LucaDominici/arbiter/issues/636) | 2    | Debug mode — arbiter --debug shows internal state transitions                         |
| M3  | [#637](https://github.com/LucaDominici/arbiter/issues/637) | 2    | Deterministic seed support — arbiter init --seed for reproducible generation          |
| M4  | [#638](https://github.com/LucaDominici/arbiter/issues/638) | 2    | Replay log capture — ~/.arbiter/logs/<runId>/ with redacted command + state diffs     |
| M5  | [#639](https://github.com/LucaDominici/arbiter/issues/639) | 2    | arbiter report — bundle logs + state for bug report (user reviews before sharing)     |
| M6  | [#640](https://github.com/LucaDominici/arbiter/issues/640) | 3    | Performance profiling mode — arbiter --profile emits .cpuprofile                      |
| M7  | [#641](https://github.com/LucaDominici/arbiter/issues/641) | 2    | Trace ID per arbiter run — included in error messages + logs for correlation          |
| M8  | [#642](https://github.com/LucaDominici/arbiter/issues/642) | 1    | Anti-telemetry CI assertion — grep ensures no network/analytics calls in shipped code |

### EPIC-Q — Update-channel infrastructure · Umbrella: [#672](https://github.com/LucaDominici/arbiter/issues/672)

| ID  | Issue                                                      | Tier | Title                                               |
| --- | ---------------------------------------------------------- | ---- | --------------------------------------------------- |
| Q1  | [#660](https://github.com/LucaDominici/arbiter/issues/660) | 1    | npm dist-tags strategy + initial publish convention |
| Q2  | [#661](https://github.com/LucaDominici/arbiter/issues/661) | 2    | CI publishes canary on every main merge             |
| Q3  | [#662](https://github.com/LucaDominici/arbiter/issues/662) | 2    | arbiter --channel flag for update opt-in            |
| Q4  | [#663](https://github.com/LucaDominici/arbiter/issues/663) | 2    | Channel switching doc + rollback path               |
| Q5  | [#664](https://github.com/LucaDominici/arbiter/issues/664) | 2    | Per-channel changelog generation                    |

### EPIC-S — Workflow Maturity Port (from personal-config + prior-art baseline) · Umbrella: [#704](https://github.com/LucaDominici/arbiter/issues/704)

Ported from two production-validated sources: user's personal Claude config (`/auto` skill evolution) + prior-art baseline. All ports are arbiter-authored re-implementations per the DETECT-REFERENCE legal posture.

| ID  | Issue                                                      | Tier | Title                                                                                  |
| --- | ---------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| S1  | [#689](https://github.com/LucaDominici/arbiter/issues/689) | 1    | Plan Context Block — self-contained recovery anchor in every plan                      |
| S2  | [#690](https://github.com/LucaDominici/arbiter/issues/690) | 1    | status.json atomic session bridge + Recovery table per phase                           |
| S3  | [#691](https://github.com/LucaDominici/arbiter/issues/691) | 1    | Phase 2.7 Red-Team adversarial review pre-implementation                               |
| S4  | [#692](https://github.com/LucaDominici/arbiter/issues/692) | 2    | Intelligent auditor routing for review-code (tag + critical-path + skip-aware scoring) |
| S5  | [#693](https://github.com/LucaDominici/arbiter/issues/693) | 1    | PreToolUse gate-marker hook (.arbiter/gate-pass.json SHA-pinned to HEAD)               |
| S6  | [#694](https://github.com/LucaDominici/arbiter/issues/694) | 1    | Context-rot management 3-layer recovery (BACKLOG.md + MCP checkpoints + git log)       |
| S7  | [#695](https://github.com/LucaDominici/arbiter/issues/695) | 1    | Plan Reviewer with tier-based passes count + max 2 revise                              |
| S8  | [#696](https://github.com/LucaDominici/arbiter/issues/696) | 2    | Agent Registry doc with effort + model + interaction chains                            |
| S9  | [#697](https://github.com/LucaDominici/arbiter/issues/697) | 2    | Glob-triggered memory loading (memory-impl pattern)                                    |
| S10 | [#698](https://github.com/LucaDominici/arbiter/issues/698) | 2    | Worktree --sibling opt-in flag + auto-symlinks                                         |
| S11 | [#699](https://github.com/LucaDominici/arbiter/issues/699) | 2    | Brainstorming terminal state at GH issue (no auto-implement)                           |
| S12 | [#700](https://github.com/LucaDominici/arbiter/issues/700) | 2    | Visual verification skill — 5-way DOM Playwright across 3 viewports                    |
| S13 | [#701](https://github.com/LucaDominici/arbiter/issues/701) | 2    | SSOT navigation skill — codified decision hierarchy                                    |
| S14 | [#702](https://github.com/LucaDominici/arbiter/issues/702) | 2    | Tech-debt → separate GH issue protocol during TDD                                      |
| S15 | [#703](https://github.com/LucaDominici/arbiter/issues/703) | 1    | Phase 3.5 full hard model-switch handoff **(size/XL, 1–2 weeks)**                      |

**Extension comments posted on existing issues:**

- [comment](https://github.com/LucaDominici/arbiter/issues/549#issuecomment-4445800479) on #549 (E1 — split implementation phase) — Phase 2.7 red-team + Phase 3.5 handoff coordination
- [comment](https://github.com/LucaDominici/arbiter/issues/550#issuecomment-4445801116) on #550 (E2 — TDD skill) — Plan Context Block integration
- [comment](https://github.com/LucaDominici/arbiter/issues/587#issuecomment-4445801636) on #587 (G5 — hook regression suite) — gate-marker hook coverage
- [comment](https://github.com/LucaDominici/arbiter/issues/617#issuecomment-4445802070) on #617 (L7 — adverse git state) — gate marker invalidation coordination
- [comment](https://github.com/LucaDominici/arbiter/issues/569#issuecomment-4445802600) on #569 (F6 — maintainer SLA) — Agent Registry interaction chains
- [comment](https://github.com/LucaDominici/arbiter/issues/668#issuecomment-4445803060) on #668 (M umbrella — observability) — trace-ID + status.json runId
- [comment](https://github.com/LucaDominici/arbiter/issues/560#issuecomment-4445803571) on #560 (E12 — frontend-design detection) — visual verification cross-link

## Tier 2 — Launch-Driver

### EPIC-C — README + Positioning + Marketing Surface · Umbrella: [#577](https://github.com/LucaDominici/arbiter/issues/577)

| ID  | Issue                                                      | Title                                                           |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| C1  | [#527](https://github.com/LucaDominici/arbiter/issues/527) | README rewrite: hero + asciinema + install + badges             |
| C2  | [#528](https://github.com/LucaDominici/arbiter/issues/528) | README in-line comparison table vs competitors                  |
| C3  | [#529](https://github.com/LucaDominici/arbiter/issues/529) | README "Why arbiter?" narrative + sharp tagline                 |
| C4  | [#530](https://github.com/LucaDominici/arbiter/issues/530) | Record asciinema cast of arbiter init (≤90s) + MP4 fallback     |
| C5  | [#531](https://github.com/LucaDominici/arbiter/issues/531) | Social preview asset (og:image 1200×630 + twitter:card meta)    |
| C6  | [#532](https://github.com/LucaDominici/arbiter/issues/532) | Logo + wordmark (SVG + PNG, light/dark) + favicon set           |
| C7  | [#533](https://github.com/LucaDominici/arbiter/issues/533) | FAQ doc (top 20 questions)                                      |
| C8  | [#534](https://github.com/LucaDominici/arbiter/issues/534) | Launch coordination tracking issue (HN/Reddit/Twitter/Lobsters) |
| C9  | [#535](https://github.com/LucaDominici/arbiter/issues/535) | showcase.md — early adopter list with logos                     |
| C10 | [#536](https://github.com/LucaDominici/arbiter/issues/536) | Press kit page (logos, screenshots, one-liner, maintainer bio)  |
| C11 | [#537](https://github.com/LucaDominici/arbiter/issues/537) | Demo video script (2-min) + YouTube unlisted upload pre-launch  |

### EPIC-D — Onboarding & DX Polish · Umbrella: [#578](https://github.com/LucaDominici/arbiter/issues/578)

| ID  | Issue                                                      | Title                                                                 |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------- |
| D1  | [#538](https://github.com/LucaDominici/arbiter/issues/538) | Wizard refresh: migrate inquirer → @clack/prompts                     |
| D2  | [#539](https://github.com/LucaDominici/arbiter/issues/539) | arbiter doctor command — env + health check                           |
| D3  | [#540](https://github.com/LucaDominici/arbiter/issues/540) | Brownfield safety: dry-run, conflict report, rollback                 |
| D4  | [#541](https://github.com/LucaDominici/arbiter/issues/541) | Codespaces config + arbiter-starter sample repo                       |
| D5  | [#542](https://github.com/LucaDominici/arbiter/issues/542) | Examples gallery: 5 fully-generated example repos (one per archetype) |
| D6  | [#543](https://github.com/LucaDominici/arbiter/issues/543) | Windows = WSL2 lane: CI job + install doc + win32 warning             |
| D7  | [#544](https://github.com/LucaDominici/arbiter/issues/544) | Hook latency benchmark: arbiter benchmark hooks                       |
| D8  | [#545](https://github.com/LucaDominici/arbiter/issues/545) | arbiter explain <INV-NN> + <CANON-NN> didactic CLI                    |
| D9  | [#546](https://github.com/LucaDominici/arbiter/issues/546) | Wizard --recipe <url                                                  | path> flag for JSON-driven scaffold |
| D10 | [#547](https://github.com/LucaDominici/arbiter/issues/547) | Polished error messages with recovery hint + doc link                 |
| D11 | [#548](https://github.com/LucaDominici/arbiter/issues/548) | NO-telemetry banner on first arbiter init run                         |

### EPIC-N — Extended Cookbook + Migration Recipes · Umbrella: [#669](https://github.com/LucaDominici/arbiter/issues/669)

| ID  | Issue                                                      | Tier | Title                                                             |
| --- | ---------------------------------------------------------- | ---- | ----------------------------------------------------------------- |
| N1  | [#643](https://github.com/LucaDominici/arbiter/issues/643) | 2    | Recipe: Switching from Spec Kit to arbiter                        |
| N2  | [#644](https://github.com/LucaDominici/arbiter/issues/644) | 2    | Recipe: Switching from BMAD-METHOD to arbiter                     |
| N3  | [#645](https://github.com/LucaDominici/arbiter/issues/645) | 3    | Recipe: Adopting in a monorepo (turborepo / nx / pnpm workspaces) |
| N4  | [#646](https://github.com/LucaDominici/arbiter/issues/646) | 3    | Recipe: Custom invariant — advanced patterns                      |
| N5  | [#647](https://github.com/LucaDominici/arbiter/issues/647) | 3    | Recipe: Adding a custom AI tool target (third-party)              |
| N6  | [#648](https://github.com/LucaDominici/arbiter/issues/648) | 3    | Recipe: Customizing the wizard                                    |
| N7  | [#649](https://github.com/LucaDominici/arbiter/issues/649) | 2    | Recipe: Brownfield onboarding for existing CI/CD                  |
| N8  | [#650](https://github.com/LucaDominici/arbiter/issues/650) | 2    | Recipe: Recovering from arbiter update failure                    |

### EPIC-O — Self-Hosting Demo · Umbrella: [#670](https://github.com/LucaDominici/arbiter/issues/670)

| ID  | Issue                                                      | Tier | Title                                                            |
| --- | ---------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| O1  | [#651](https://github.com/LucaDominici/arbiter/issues/651) | 2    | "arbiter dogfoods arbiter" docs page — recursive use case study  |
| O2  | [#652](https://github.com/LucaDominici/arbiter/issues/652) | 2    | Public AGENTS.md + decisions browse link from home               |
| O3  | [#653](https://github.com/LucaDominici/arbiter/issues/653) | 3    | Public evidence trail / knowledge map snapshot                   |
| O4  | [#654](https://github.com/LucaDominici/arbiter/issues/654) | 3    | Nightly canary: arbiter regenerates own config + diffs published |
| O5  | [#655](https://github.com/LucaDominici/arbiter/issues/655) | 3    | "How arbiter caught X" case-study posts (3–5 real incidents)     |

### EPIC-R — Anti-overclaim Positioning · Umbrella: [#673](https://github.com/LucaDominici/arbiter/issues/673)

| ID  | Issue                                                      | Tier | Title                                                       |
| --- | ---------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| R1  | [#665](https://github.com/LucaDominici/arbiter/issues/665) | 2    | docs/POSITIONING.md — explicit no-ROI-claims statement      |
| R2  | [#666](https://github.com/LucaDominici/arbiter/issues/666) | 3    | "How to measure arbiter value yourself" — methodology guide |
| R3  | [#667](https://github.com/LucaDominici/arbiter/issues/667) | 2    | "What arbiter is NOT" — anti-overclaim honest doc           |

## Tier 3 — Growth (post-launch)

### EPIC-E — TDD Workflow + Skill Integration · Umbrella: [#579](https://github.com/LucaDominici/arbiter/issues/579)

| ID  | Issue                                                      | Title                                                                                |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| E1  | [#549](https://github.com/LucaDominici/arbiter/issues/549) | Split implementation phase into red/green/refactor sub-phases                        |
| E2  | [#550](https://github.com/LucaDominici/arbiter/issues/550) | Generate arbiter-authored TDD skill (skip if superpowers detected)                   |
| E3  | [#551](https://github.com/LucaDominici/arbiter/issues/551) | red → green transition evidence gate                                                 |
| E4  | [#552](https://github.com/LucaDominici/arbiter/issues/552) | Extend guard-task-completion.mjs for TDD evidence audit                              |
| E5  | [#553](https://github.com/LucaDominici/arbiter/issues/553) | arbiter verify tdd <task-id> command for replayable audit                            |
| E6  | [#554](https://github.com/LucaDominici/arbiter/issues/554) | Promote INV-26 to gate-enforced for L2+                                              |
| E7  | [#555](https://github.com/LucaDominici/arbiter/issues/555) | Record TDD W4 demo screencast (90s)                                                  |
| E8  | [#556](https://github.com/LucaDominici/arbiter/issues/556) | Add src/integrations/skill-detector.ts                                               |
| E9  | [#557](https://github.com/LucaDominici/arbiter/issues/557) | Add src/compatibility/skills-matrix.json (schema + validator)                        |
| E10 | [#558](https://github.com/LucaDominici/arbiter/issues/558) | Seed skills-matrix with curated entries                                              |
| E11 | [#559](https://github.com/LucaDominici/arbiter/issues/559) | Skip arbiter TDD skill when superpowers TDD detected; emit AGENTS.md integration ref |
| E12 | [#560](https://github.com/LucaDominici/arbiter/issues/560) | frontend-design detection for frontend-spa archetype                                 |
| E13 | [#561](https://github.com/LucaDominici/arbiter/issues/561) | arbiter integrations list CLI                                                        |
| E14 | [#562](https://github.com/LucaDominici/arbiter/issues/562) | docs/INTEGRATIONS.md — legal stance + attribution rules                              |
| E15 | [#563](https://github.com/LucaDominici/arbiter/issues/563) | CI parity lane: arbiter init with + without superpowers installed                    |

### EPIC-F — Community Infrastructure · Umbrella: [#580](https://github.com/LucaDominici/arbiter/issues/580)

| ID  | Issue                                                      | Title                                                                                 |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| F1  | [#564](https://github.com/LucaDominici/arbiter/issues/564) | Good first issue label policy + curate 10 launch-ready tasks                          |
| F2  | [#565](https://github.com/LucaDominici/arbiter/issues/565) | Enable GitHub Discussions + seed categories                                           |
| F3  | [#566](https://github.com/LucaDominici/arbiter/issues/566) | Public ROADMAP.md — strip internal jargon, mirror M22–M32                             |
| F4  | [#567](https://github.com/LucaDominici/arbiter/issues/567) | RFC process + 0000 template + first example RFC                                       |
| F5  | [#568](https://github.com/LucaDominici/arbiter/issues/568) | Decide + provision Discord (or Matrix) + bridge to Discussions                        |
| F6  | [#569](https://github.com/LucaDominici/arbiter/issues/569) | Maintainer SLA + time-zone notice in CONTRIBUTING.md                                  |
| F7  | [#570](https://github.com/LucaDominici/arbiter/issues/570) | Plugin registry foundations: npm tag + listing page                                   |
| F8  | [#571](https://github.com/LucaDominici/arbiter/issues/571) | Issue triage automation: stale-bot, action-labeler, auto-assign                       |
| F9  | [#572](https://github.com/LucaDominici/arbiter/issues/572) | Release notes blog channel (GH Discussions Announcements) auto-posted from changesets |
| F10 | [#573](https://github.com/LucaDominici/arbiter/issues/573) | CoC enforcement runbook (private maintainer doc)                                      |
| F11 | [#574](https://github.com/LucaDominici/arbiter/issues/574) | Sponsor one-pager + maintainer funding policy                                         |

### EPIC-P — i18n scaffolding · Umbrella: [#671](https://github.com/LucaDominici/arbiter/issues/671)

| ID  | Issue                                                      | Tier | Title                                               |
| --- | ---------------------------------------------------------- | ---- | --------------------------------------------------- |
| P1  | [#656](https://github.com/LucaDominici/arbiter/issues/656) | 3    | Extract CLI strings to src/i18n/en.json             |
| P2  | [#657](https://github.com/LucaDominici/arbiter/issues/657) | 3    | Locale detection via $LANG; default en if not found |
| P3  | [#658](https://github.com/LucaDominici/arbiter/issues/658) | 3    | Locale-aware error helper — D10 wraps i18n          |
| P4  | [#659](https://github.com/LucaDominici/arbiter/issues/659) | 3    | Translation contribution doc                        |

## Three-Ring Pre-Release QA Pattern (EPIC-G)

Per the v1 hardening philosophy:

1. **Ring 1 — Automated continuous** (G1, G2, G3, G5, G6, G8, G10): runs every PR + nightly. Blocks merges on failure. Safety net.
2. **Ring 2 — Release-gated** (G4, G7, G9, G11, G15): runs before tags become public releases. Manual or scripted but explicit. Launch readiness.
3. **Ring 3 — Continuous monitoring** (G12, G13, G14): feedback loops over time, not before a single release. Trust capital.

## Honest Scope Framing

- **Engineering closes the gap to a credible, complete, discoverable OSS framework.** Reach / virality is out of scope for v1 — that is narrative work owned by EPIC-C.
- **Scope discipline (do NOT add in v1):** VS Code extension, MCP server, additional languages beyond current 6, additional AI tools beyond current 8. Surface is already large. Polish + ship + expand on usage signals.

## Filters

- All v1 issues: [`label:release/v1-public`](https://github.com/LucaDominici/arbiter/issues?q=is%3Aissue+is%3Aopen+label%3Arelease%2Fv1-public)
- Tier 1 only: [`label:tier/1-blocker`](https://github.com/LucaDominici/arbiter/issues?q=is%3Aissue+is%3Aopen+label%3Arelease%2Fv1-public+label%3Atier%2F1-blocker)
- Tier 2 only: [`label:tier/2-launch`](https://github.com/LucaDominici/arbiter/issues?q=is%3Aissue+is%3Aopen+label%3Arelease%2Fv1-public+label%3Atier%2F2-launch)
- Tier 3 only: [`label:tier/3-growth`](https://github.com/LucaDominici/arbiter/issues?q=is%3Aissue+is%3Aopen+label%3Arelease%2Fv1-public+label%3Atier%2F3-growth)
- Epics only: [`label:epic`](https://github.com/LucaDominici/arbiter/issues?q=is%3Aissue+is%3Aopen+label%3Arelease%2Fv1-public+label%3Aepic)
- Tests only: [`label:test`](https://github.com/LucaDominici/arbiter/issues?q=is%3Aissue+is%3Aopen+label%3Arelease%2Fv1-public+label%3Atest)
- CI only: [`label:ci`](https://github.com/LucaDominici/arbiter/issues?q=is%3Aissue+is%3Aopen+label%3Arelease%2Fv1-public+label%3Aci)
