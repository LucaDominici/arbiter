# arbiter Roadmap

**Issue:** #566

> Roadmap items are not commitments; priorities adjust based on community feedback and maintainer bandwidth.

---

## Shipped (v0.x)

- Multi-language project detection (TypeScript, Java, Rust, Go, Python, multi)
- Framework detection (Next.js, Express, Spring Boot, Quarkus, Tauri, and combos)
- Archetype-based invariant catalog with 50+ invariants
- Governance level system (L1 / L2 / L3 / L4) with tier filtering
- Generated AGENTS.md + GLOBAL_INVARIANTS.md for target projects
- Claude Code hook suite (15+ enforcement hooks)
- Multi-layer gate system (L1 fast / L2 full / L3 e2e+mutation / L4 evidence)
- Plugin architecture
- selfOnly invariant filtering (arbiter-internal rules excluded from target projects)
- Shared `readFileSafe` / `readPackageJsonSafe` helpers with ENOENT discrimination
- UserFacingError class with clean CLI error output
- Composite framework archetype detection (e.g., `express+spring-boot`)
- Anti-telemetry CI assertion
- Update channel infrastructure — `--channel latest|beta|canary` global flag, arbiter.json channel field, downgrade warnings in `doctor health`
- TDD workflow integration — gate-blocked phase machine (`arbiter task advance`, `task record-red --test-path`), `verify tdd` replay audit, stop-evidence-guard evidence gate (INV-114)

## Now (Current Quarter)

- Docs site MVP (issue #575)
- README rewrite + positioning (issue #577)
- Failure-mode hardening — SIGTERM/disk-full/git-state detection (issue #624)
- API stability + semver policy (issue #623)
- DX polish — polished error messages, NO-telemetry banner (issue #578)
- Observability — structured logging, debug mode, trace ID (issue #668)

## Next (Next 6 Months)

- Workflow maturity port from internal tooling — plan context blocks, session recovery, red-team review (issue #704)
- i18n scaffolding — string extraction to `src/i18n/en.json`, locale detection (issue #671)
- Extended cookbook and migration recipes (issue #669)
- Self-hosting demo — arbiter applied to arbiter, public evidence trail (issue #670)

## Later (> 6 Months)

- Extended invariants port — 22 governance mechanisms from a production reference implementation (issue #737)
- Community infrastructure — RFC process, Discord/Matrix, plugin registry (issue #580)
- Anti-overclaim positioning layer — honest framing tooling (issue #673)

---

_Last updated: 2026-05-16. For internal milestone detail, see `docs/PRODUCT/MILESTONES.md`._
