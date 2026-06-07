---
generated: true
source: 'docs/SYSTEM/CI-TIER-MODEL.md'
source_sha: 'b82cf70d8c2829a7ee4d0347d917b24fe10c6bb5'
last_updated: '2026-06-07'
---

# Perfect Tiered CI/CD — Design Spec for arbiter (all stacks, GitHub Actions)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/SYSTEM/CI-TIER-MODEL.md](../docs/SYSTEM/CI-TIER-MODEL.md)

# Perfect Tiered CI/CD — Design Spec for arbiter (all stacks, GitHub Actions)

> **Status**: approved design — 2026-05-17; updated 2026-05-23 (archetype-driven model)
> **Author**: arbiter team  
> **Implements**: epic to be decomposed via `/epic-decompose`
>
> **ADR-050**: Pipeline shape now derives from project archetype (primary axis) with governance
> enforcing hard minimums (floor axis). See `docs/ADR/050-pipeline-complexity-tiers.md` for the
> full rationale and rejected alternatives. The archetype-default model supersedes the earlier
> "tier set is constant, only thresholds vary" framing in §Context below.

## Context

**Why now.** arbiter today emits a 2-tier CI for generated projects: `ci.yml` (PR-fast) + `nightly.yml` + `drift-shadow.yml`. The hand-crafted Java/Spring reference demonstrates a 5-workflow + heartbeat model (PR-fast / PR-extended / release / nightly / weekly / heartbeat) that maps cleanly to the modern Fowler-Farley-DORA-SLSA consensus for small polyglot teams (≤10 people). arbiter's mission is "max any agentic-development tool can offer" — the current 2-tier output undersells that bar.

**Goal.** arbiter generates, for **every** supported stack (Java, Go, Python, Node/TS, Rust) on **GitHub Actions**, a 6-tier CI pipeline that matches or exceeds the Java reference, parametrised on `governanceLevel ∈ {L1, L2, L3, L4}` (thresholds tighten with level — tier set is constant) and `archetype ∈ {lib, service, cli, batch}` (release-tier content varies, everything else uniform).

**Out of scope (v1).** GitLab CI / Jenkins / CircleCI generators. Self-hosted runner provisioning (only label parametrisation). Production deploy targets (T3 stops at signed artifact, not deploy). Per-cloud variants (no GCP/AWS/Azure forks).

---

## 1. CI Tier Model

| Tier | Name           | Trigger              | Wall-clock target | Gating                      | Rationale                                                                 |
| ---- | -------------- | -------------------- | ----------------- | --------------------------- | ------------------------------------------------------------------------- |
| T0   | local pre-push | dev machine          | <30 s             | dev-side hook               | Format + cheap lint. Husky/lefthook generated.                            |
| T1   | PR-fast        | PR open/sync         | <5 min, ceil 10   | **blocking**                | Farley "Feedback in Five Minutes" + Fowler ten-minute build.              |
| T2   | PR-extended    | path/size/label      | <20 min           | **blocking when triggered** | DSOMM L2: SCA + DAST baseline + integration + contract.                   |
| T3   | release        | PR→main merge / tag  | <40 min           | **blocking**                | SLSA L2 table-stakes, L3 realistic via slsa-github-generator.             |
| T4   | nightly        | cron 02:00 UTC       | up to 4 h         | informational + alert       | Mutation, full DAST, fuzz, soak, gitleaks-history belong here, not on PR. |
| T5   | weekly         | cron Sun 04:00 UTC   | up to 8 h         | informational + alert       | Cross-DB/OS matrix, dep-freshness, perf trend, secret-rotation drill.     |
| T5b  | monthly        | cron 04:00 UTC day 1 | up to 4 h         | informational + alert       | Long-horizon: dep-age (>180d), license audit, action-pin staleness, SBOM. |
| T6   | heartbeat      | cron 06:00 UTC       | <2 min            | alert-only                  | Dead-man's-switch: asserts T4 ≤26 h, T5 ≤8 d, T5b ≤35 d.                  |

**Constants across stacks**: tier presence, trigger semantics, gating posture, workflow filenames.  
**Variables across stacks**: tool selection per tier.  
**Variable across governance**: thresholds only (§6).  
**Variable across archetype**: T3 release-job content only (§5).

---

## 2. Generated Workflow File Map

Every project gets exactly these files under `.github/workflows/` (numbered for GH sidebar order):

```
.github/workflows/
  01-pr-fast.yml          # T1 — required check, blocks merge
  02-pr-extended.yml      # T2 — conditional, blocks merge when triggered
  03-human-approval.yml   # cross-cutting — applies approved-by-human label on review
  04-deploy-test.yml      # deploy T4 — push to TEST on develop; opt-in (enableDeployWorkflows)
  05-release.yml          # T3 — PR→main + tag triggers
  06-nightly.yml          # T4 — cron 02:00 UTC + manual dispatch
  07-weekly.yml           # T5 — cron Sun 04:00 UTC + manual dispatch
  08-monthly.yml          # T5b — cron 04:00 UTC day 1 + manual dispatch
  09-heartbeat.yml        # T6 — cron 06:00 UTC, asserts T4+T5+T5b ran
  10-deploy-prod.yml      # deploy PROD — release:published, env-gated; opt-in (enableDeployWorkflows)
```

Slots 04 and 10 are opt-in via `enableDeployWorkflows: true` in project config.
Deploy workflows are downstream-project concerns — arbiter (npm package) does not apply them to itself.
Implemented in feat(#899) F10.

---

## 3. Tier-by-Tier Content

### T0 — Local pre-push (generated dev hooks)

- **husky** (Node/TS) or **lefthook** (Go/Rust/Python/Java polyglot).
- Runs: format check + lint only (no test execution).
- Bypass via `--no-verify` explicitly prohibited in generated CONTRIBUTING.md.

### T1 — PR-fast (`01-pr-fast.yml`)

Jobs (sequential dependency: classify → fast-lane → required):

1. **classify-changes** — detect changed paths, set outputs (`needs_extended`, `langs_touched`, `is_release_path`). Reused across T2.
2. **security-early-fail** — gitleaks (diff-only) + PII-scan + OSSF token-permissions verify. Fails in <30 s.
3. **per-language fast-lane** matrix (`langs_touched` from classify):
   - **Java**: Spotless check + Checkstyle + SpotBugs (low/medium effort) + PMD + `mvn -T 2C test -Dgroups='!slow'` + ArchUnit (47 rules) + JaCoCo coverage (line/branch threshold per L) + javadoc dry-run.
   - **Go**: `gofmt -l` + `golangci-lint v2 run --max-issues-per-linter 0 --max-same-issues 0` + `go vet` + `go test -short -race -cover ./...` + `go-arch-lint check`.
   - **Python**: `ruff check` + `ruff format --check` + `mypy --strict` + `pytest -m 'not slow' --cov` + `import-linter` + `pip-audit`.
   - **Node/TS**: `biome check` + `tsc --noEmit` + `vitest run --coverage` + `dependency-cruiser --validate` + `npm audit --omit=dev --audit-level=high`.
   - **Rust**: `cargo fmt -- --check` + `cargo clippy -- -D warnings` + `cargo test --workspace` + `cargo-deny check` + `cargo-llvm-cov`.
4. **contract-fast** — Pact/swagger-request-validator/schemathesis when `openapi/` or `pact/` paths touched.
5. **docs-check** — markdown lint + link check + SSOT parity (INV-28).
6. **cross-stack-guard** — INV-59 local-CI parity hash; HARD-fail at L3.
7. **human-approval-required** — sentinel job; requires `approved-by-human` label (applied by `03-human-approval.yml`).
8. **ci-required** — aggregator green-light; the single required check on branch protection.

**Concurrency**: `group: pr-fast-${{ github.head_ref }}`, `cancel-in-progress: true`.  
**Permissions**: top-level `contents: read`; job-scoped writes only.  
**Action pinning**: SHA-pinned; tag refs forbidden by template lint (INV-75).

### T2 — PR-extended (`02-pr-extended.yml`)

Trigger conditions (any true):

- Sensitive paths changed: `migrations/`, `auth*`, `infra/`, `Dockerfile*`, lockfiles, `openapi/`, `schemas/`.
- PR ≥ 100 LOC changed.
- Label `extended-ci` present.
- PR transitioned `draft → ready_for_review`.

Jobs:

1. **integration-tests** (per-lang matrix) — testcontainers/ephemeral DB; Toxiproxy stall test for `service` archetype.
2. **contract-extended** — Pact-broker `can-i-deploy`, Swagger Request Validator runtime.
3. **container-scan** — Trivy `--severity HIGH,CRITICAL --exit-code 1` when Dockerfile changed.
4. **dast-baseline** — OWASP ZAP baseline (~5 min fast variant) against ephemeral container.
5. **load-smoke** — k6 1-min smoke (RPS plateau, p95 latency).
6. **license-scan** — `license-maven-plugin` / `go-licenses` / `pip-licenses

_[content truncated — see source for full text]_
