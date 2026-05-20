---
title: 'Perfect Tiered CI/CD — Design Spec for arbiter (all stacks, GitHub Actions)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method']
related: []
---

# Perfect Tiered CI/CD — Design Spec for arbiter (all stacks, GitHub Actions)

> **Status**: approved design — 2026-05-17  
> **Author**: arbiter team  
> **Implements**: epic to be decomposed via `/epic-decompose`

## Context

**Why now.** arbiter today emits a 2-tier CI for generated projects: `ci.yml` (PR-fast) + `nightly.yml` + `drift-shadow.yml`. The hand-crafted Java/Spring reference demonstrates a 5-workflow + heartbeat model (PR-fast / PR-extended / release / nightly / weekly / heartbeat) that maps cleanly to the modern Fowler-Farley-DORA-SLSA consensus for small polyglot teams (≤10 people). arbiter's mission is "max any agentic-development tool can offer" — the current 2-tier output undersells that bar.

**Goal.** arbiter generates, for **every** supported stack (Java, Go, Python, Node/TS, Rust) on **GitHub Actions**, a 6-tier CI pipeline that matches or exceeds the Java reference, parametrised on `governanceLevel ∈ {L1, L2, L3}` (thresholds tighten with level — tier set is constant) and `archetype ∈ {lib, service, cli, batch}` (release-tier content varies, everything else uniform).

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
6. **license-scan** — `license-maven-plugin` / `go-licenses` / `pip-licenses` / `license-checker` / `cargo-deny licenses`.
7. **behavioral-tests** — `@integration`-tagged tests.

Same concurrency group; required when triggered.

### T3 — Release (`05-release.yml`)

Triggers: `pull_request` on `main` (dry-run), `push` to `main` (publish), `tag v*` (formal release).

Shared jobs (every archetype):

1. **build-superset** — full T1 + T2 superset; all langs build to artifact.
2. **mutation-blocking** — PITest 80/85 (Java); Stryker 80/60/50 (TS); mutmut threshold (Python); cargo-mutants threshold (Rust). Go skipped (matrix `unsafe`). HARD-fail at L2+; informational at L1.
3. **secret-scan-history** — gitleaks full history.
4. **sbom** — CycloneDX per language; Go via syft (closes existing gap).
5. **cosign-sign** — keyless sign-blob via Sigstore; OIDC token bound to `release.yml`.
6. **slsa-provenance** — `slsa-framework/slsa-github-generator` reusable workflow → L2 default, L3 at L3 governance (hermetic `_generic_slsa3` builder).
7. **attest-build-provenance** — GitHub native `actions/attest-build-provenance` for redundancy.

Archetype-specific publish jobs (branched via EJS):

- **lib** → `mvn deploy` / `npm publish --provenance` / `cargo publish` / `twine upload` + cosign `sign-blob` over distribution.
- **service** → `docker buildx build` → push to registry (`REGISTRY` var) → `cosign sign` (image digest) → Trivy image rescan blocking → SBOM attest via `cosign attest --predicate sbom.spdx`.
- **cli** → matrix build `{linux,macos,windows} × {amd64,arm64}` via `goreleaser` (Go) / `cargo-dist` (Rust) / `pyinstaller` (Python) / GraalVM `native-image` (Java) / `@vercel/ncc` (Node). Cosign `sign-blob` per binary + checksum file. SLSA provenance per artifact.
- **batch** → artifact tarball + manifest + cosign `sign-blob` + SBOM + provenance.

### T4 — Nightly (`06-nightly.yml`)

Cron `0 2 * * *` + `workflow_dispatch`.

1. **mutation-deep** — full mutation suite (not just changed classes); thresholds tracked as trend.
2. **dast-full** — OWASP ZAP full scan against staging-equivalent local stack.
3. **dep-cve-refresh** — OWASP Dep-Check / govulncheck / pip-audit / npm-audit / cargo-audit with fresh advisory DB. CVSS gate per §6.
4. **fuzz** — `go-fuzz`/`cargo-fuzz`/`atheris` (Python)/`jqwik` (Java)/`fast-check` (TS). Time budget 30 min/lang.
5. **soak-e2e** — Newman / Cypress / Playwright full suite (60 min budget).
6. **toxiproxy-resilience** — DB stall + network partition tests (service archetype only).
7. **gitleaks-history** — full git history.
8. **evidence-collect** — GH artifact store, 90-day retention.

All informational; failure → GH issue auto-filed with `nightly-regression` label.

### T5 — Weekly (`07-weekly.yml`)

Cron `0 4 * * 0` + `workflow_dispatch`.

1. **cross-db-matrix** — Postgres × MySQL × MSSQL × MariaDB × SQLite via testcontainers. INV-32 twin-test enforcement.
2. **cross-os-matrix** — Ubuntu × macOS × Windows × {amd64, arm64} for CLI archetype.
3. **dep-freshness** — reports `dependency_age_days` per package.
4. **perf-trend** — k6 vs 7-day baseline; regression tracking, no auto-fail.
5. **secret-rotation-drill** — round-trip rotation of dummy secret against staging credentials.
6. **action-version-audit** — stale SHA pins flagged if >180 d old.

### T5b — Monthly (`08-monthly.yml`)

Cron `0 4 1 * *` (04:00 UTC on day 1 of each month) + `workflow_dispatch`. Up to 4 h.

Long-horizon hygiene tasks too slow or low-signal for weekly cadence:

1. **dep-age-audit** — flag direct deps unchanged >180 days (`npm-check-updates`, `gradle dependencyUpdates`, `mvn versions:display-dependency-updates`, `go list -u -m all`, `pip list --outdated`, `cargo outdated`). Report artifact, 365-day retention.
2. **license-full-audit** — full per-language license report (`license-checker`, `gradle licenseReport`, `mvn license:aggregate-third-party-report`, `go-licenses report`, `pip-licenses`, `cargo-deny check licenses`). Artifact retained 365 days.
3. **action-pins-stale-audit** — flag GitHub Actions SHA pins >180 days old. Walks `.github/workflows/`, resolves each SHA against `gh api repos/$REPO/commits/$SHA`, emits `::warning::` per stale pin. Informational; pairs with T5 weekly action-version-audit (90d threshold).
4. **sbom-archive** — full CycloneDX SBOM snapshot (`npm sbom`, `gradle cyclonedxBom`, `mvn cyclonedx-maven-plugin`, `syft`, `cyclonedx-py`, `cargo-cyclonedx`). Artifact retained 365 days for long-horizon diff.
5. **evidence-collect** — monthly summary artifact, 365-day retention.
6. **monthly-required** — gate job: `failure` if any hard-failure job failed; auto-files `[monthly] regression detected` issue labelled `monthly-regression`.

All jobs informational; failure → GH issue auto-filed (dedup by label).

### T6 — Heartbeat (`09-heartbeat.yml`)

Cron `0 6 * * *`. <2 min.

1. Assert `06-nightly.yml` last run ≤ 26 h ago.
2. Assert `07-weekly.yml` last run ≤ 8 d ago.
3. Assert `08-monthly.yml` last run ≤ 35 d ago.
4. Failure → file/update GH issue `[heartbeat] <tier> missed` (one label per tier: `heartbeat-nightly-missed`, `heartbeat-weekly-missed`, `heartbeat-monthly-missed`); auto-close on next success.

### Cross-cutting — Human approval (`03-human-approval.yml`)

Trigger: `pull_request_review` (submitted + approved).

Triple-check (INV-73):

1. `review.user.login != pull_request.user.login` — actor ≠ author.
2. `review.user.type != 'Bot'` — no bot approvals.
3. `review.state == 'approved'` — formal review.

All pass → apply label `approved-by-human`. T1's `human-approval-required` job re-checks label and becomes green. Listed as required check in branch protection.

---

## 4. Per-Stack Toolchain Matrix

Extend `src/compatibility/cross-language-matrix.json` with new capabilities:

| Capability     | Java                                   | Go                        | Python                         | Node/TS                         | Rust                                               |
| -------------- | -------------------------------------- | ------------------------- | ------------------------------ | ------------------------------- | -------------------------------------------------- |
| format         | Spotless (AOSP)                        | gofmt + gofumpt           | Ruff format                    | Biome                           | cargo fmt                                          |
| lint           | Checkstyle+PMD+SpotBugs                | golangci-lint v2          | Ruff                           | ESLint + Biome                  | clippy `-D warnings`                               |
| type           | javac                                  | (builtin)                 | mypy `--strict`                | tsc `--noEmit`                  | (builtin)                                          |
| unit           | JUnit 5                                | go test + gotestsum       | pytest                         | Vitest                          | cargo test + nextest                               |
| coverage       | JaCoCo                                 | go test -cover            | coverage.py                    | c8/v8                           | cargo-llvm-cov                                     |
| mutation       | **PITest**                             | skipped (matrix `unsafe`) | mutmut                         | **Stryker**                     | cargo-mutants                                      |
| arch-test      | **ArchUnit**                           | go-arch-lint + arch-go    | import-linter + ArchUnitPython | dependency-cruiser + ArchUnitTS | clippy `disallowed_*` + cargo-deny + cargo-modules |
| SAST           | SpotBugs+FindSecBugs / CodeQL          | gosec / CodeQL            | bandit / CodeQL                | CodeQL / Semgrep                | clippy security lints                              |
| dep-CVE        | OWASP Dep-Check                        | govulncheck               | pip-audit                      | npm audit + osv-scanner         | cargo-audit + cargo-deny                           |
| secret scan    | Gitleaks                               | Gitleaks                  | Gitleaks                       | Gitleaks                        | Gitleaks                                           |
| container scan | Trivy                                  | Trivy                     | Trivy                          | Trivy                           | Trivy                                              |
| contract       | swagger-request-validator              | Pact-go                   | schemathesis                   | Pact-js                         | Pact-rust / dropshot                               |
| load smoke     | k6                                     | k6                        | k6                             | k6                              | k6                                                 |
| DAST           | OWASP ZAP                              | OWASP ZAP                 | OWASP ZAP                      | OWASP ZAP                       | OWASP ZAP                                          |
| fuzz           | jqwik                                  | go-fuzz / native fuzz     | atheris                        | fast-check                      | cargo-fuzz                                         |
| license        | license-maven-plugin                   | go-licenses               | pip-licenses                   | license-checker                 | cargo-deny licenses                                |
| SBOM           | CycloneDX-maven                        | syft (**gap closed**)     | cyclonedx-py                   | npm sbom                        | cargo-cyclonedx                                    |
| binary signing | cosign sign-blob                       | cosign sign-blob          | cosign sign-blob               | cosign sign-blob                | cosign sign-blob                                   |
| provenance     | actions/attest + slsa-github-generator | same                      | same                           | same                            | same                                               |

**Rust arch-test gap**: accepted. Compose `cargo-deny [bans]` + `clippy.toml disallowed_*` + `cargo-modules` graph diff into single `check-boundaries-rust.mjs` gate. Limitation documented in generated CONTRIBUTING.md.

---

## 5. Archetype-Aware Release Differences (T3 only)

`src/templates/github/workflows/05-release.yml.ejs` branches on `archetype`:

```ejs
<% if (archetype === 'lib') { %>  publish-package  <% } %>
<% if (archetype === 'service') { %>  build-and-sign-container  <% } %>
<% if (archetype === 'cli') { %>  build-binaries-matrix  <% } %>
<% if (archetype === 'batch') { %>  bundle-artifact  <% } %>
```

All four converge on shared composite action `.github/actions/sign-and-attest/action.yml` (cosign + SBOM + SLSA + attest).

---

## 6. Governance Threshold Matrix

Tier set is constant across L1/L2/L3. Only thresholds differ:

| Threshold           | L1 (lenient)    | L2 (standard)          | L3 (elite)                   |
| ------------------- | --------------- | ---------------------- | ---------------------------- |
| Coverage line       | ≥70%            | ≥80%                   | ≥85%                         |
| Coverage branch     | ≥60%            | ≥70%                   | ≥80%                         |
| Mutation threshold  | informational   | ≥75% blocking          | ≥80% blocking                |
| CVSS gate (dep-CVE) | ≥9.0 fails      | ≥7.0 fails             | ≥4.0 fails                   |
| Container severity  | warn            | HIGH+CRITICAL fail     | MEDIUM+ fail                 |
| SAST severity       | warn            | HIGH+ fail             | MEDIUM+ fail                 |
| SLSA target         | L1 (provenance) | L2 (signed provenance) | L3 (hermetic builder)        |
| Lint warnings       | warn            | zero-tolerance         | zero + pedantic ruleset      |
| `cross-stack-guard` | warn            | HARD-fail              | HARD-fail + `--strict`       |
| `debt-ratchet`      | track           | track + warn           | `--require-improvement`      |
| Action pinning      | tag OK          | SHA required           | SHA required + Renovate gate |
| Human-approval gate | **required**    | **required**           | **required** + CODEOWNER     |

Single source: `src/config/thresholds-l1-l2-l3.ts` (new) → imported by all generators.

---

## 7. Local Runner — `check-all.mjs` Subcommand Model

Replace positional `L1|L2|L3` with subcommand + `--level` flag. Back-compat aliases retained for one release.

```
node scripts/check-all.mjs check                 # T0+T1, ~2 min
node scripts/check-all.mjs gate                  # T0+T1+T2, ~10 min
node scripts/check-all.mjs full                  # +T3 dry-run, ~35 min
node scripts/check-all.mjs simulate-nightly      # T4 full suite
node scripts/check-all.mjs simulate-weekly       # T5 full suite

# Modifiers
  --level L1|L2|L3          # threshold pack (default L2)
  --lang java,go            # language subset (default: all touched)
  --no-mutation             # skip mutation in full for quick smoke
  --report json             # machine-readable JSON to stdout

# Back-compat aliases
node scripts/check-all.mjs L1   # → check --level L1
node scripts/check-all.mjs L2   # → gate --level L2
node scripts/check-all.mjs L3   # → gate --level L3
```

INV-59 tier-hash extended: each subcommand publishes a hash; GH Actions workflows assert hash match.

---

## 8. New Invariants (INV-72 … INV-82)

| INV    | Title                                            | Enforcement                                     |
| ------ | ------------------------------------------------ | ----------------------------------------------- |
| INV-72 | All 8 workflow files present                     | `scripts/check-ci-tiers.mjs` (L1 gate)          |
| INV-73 | Anti-bot human-approval required check           | Generator emits + branch-protection apply       |
| INV-74 | Heartbeat asserts T4 ≤26 h, T5 ≤8 d, T5b ≤35 d   | `09-heartbeat.yml` content + assertion test     |
| INV-75 | SHA-pinned actions only (OSSF)                   | `check-action-pins.mjs` post-edit hook          |
| INV-76 | Top-level workflow `permissions: contents: read` | `check-workflow-perms.mjs` post-edit hook       |
| INV-77 | SLSA provenance at T3                            | Release workflow contains slsa-github-generator |
| INV-78 | Cosign sign-blob per release artifact            | Release workflow contains cosign per archetype  |
| INV-79 | No `continue-on-error: true` on test/build steps | Extend existing `workflow-integrity` hook       |
| INV-80 | Tier-hash local↔CI parity                        | Extend INV-59 to T1..T5b hashes                 |
| INV-82 | Monthly (T5b) workflow present + heartbeat ≤32d  | `scripts/check-monthly-freshness.mjs` (L1 gate) |

---

## 9. New CANON Rules (CANON-17 … CANON-19)

| CANON    | Triggered when…                                                 |
| -------- | --------------------------------------------------------------- |
| CANON-17 | Adding/modifying any `src/templates/github/workflows/*.ejs`     |
| CANON-18 | Adding/modifying any `.github/actions/sign-and-attest/*`        |
| CANON-19 | Changing governance threshold table in `thresholds-l1-l2-l3.ts` |

---

## 10. Files to Create / Modify

### Create (new)

```
src/templates/github/workflows/
  01-pr-fast.yml.ejs            # rename from ci.yml.ejs
  02-pr-extended.yml.ejs
  03-human-approval.yml.ejs
  05-release.yml.ejs            # archetype-branched
  06-nightly.yml.ejs            # rename from nightly.yml.ejs
  07-weekly.yml.ejs
  08-monthly.yml.ejs            # T5b long-horizon
  09-heartbeat.yml.ejs

src/templates/github/actions/sign-and-attest/
  action.yml.ejs                # shared composite: cosign + SBOM + SLSA + attest

src/templates/scripts/
  apply-branch-protection.mjs.ejs
  check-ci-tiers.mjs.ejs
  check-action-pins.mjs.ejs
  check-workflow-perms.mjs.ejs

src/generators/
  ci-tier.ts                    # orchestrator for all workflow ejs
  release-archetype.ts          # lib/service/cli/batch branching helper

src/config/
  thresholds-l1-l2-l3.ts        # §6 threshold matrix, single export

docs/SYSTEM/
  CI-TIER-MODEL.md              # this file
```

### Modify (extend, not replace)

```
src/templates/scripts/check-all.mjs.ejs      # subcommand router + back-compat
src/generators/github.ts                     # extend with ci-tier.ts orchestration
src/wizard/types.ts                          # archetype enum; thresholds wiring
src/wizard/index.ts                          # archetype question + tier acknowledgement
src/invariants/catalog.ts                    # add INV-72..INV-80
src/compatibility/cross-language-matrix.json # new capabilities per §4
.claude/rules/30-canon-enforcement.md        # CANON-17/18/19 rows
docs/SYSTEM/CANON.md                         # CANON-17/18/19 entries
AGENTS.md                                    # §Invariants: INV-72..80
```

### Delete after rename

```
src/templates/github/workflows/ci.yml.ejs      # → 01-pr-fast.yml.ejs
src/templates/github/workflows/nightly.yml.ejs # → 06-nightly.yml.ejs
```

### Reuse (do NOT duplicate)

All existing sub-generators (`mutation.ts`, `security.ts`, `archunit.ts`, `contract-testing.ts`, `coverage.ts`, `debt-gates.ts`, `debt-ratchet.ts`, `evidence-retention.ts`, `observability.ts`, `stride-enforcement.ts`, `compliance.ts`, `behavioral-tests.ts`, `integration-testing.ts`, `boundaries.ts`, `go-boundaries.ts`, `python-boundaries.ts`, `rust-boundaries.ts`) — wired via new `ci-tier.ts`, not rewritten.

---

## 11. Anti-Patterns Explicitly Banned

| Anti-pattern                                  | Source         | Enforcement                                     |
| --------------------------------------------- | -------------- | ----------------------------------------------- |
| `continue-on-error: true` on test/build steps | Fowler         | INV-79 + `workflow-integrity` hook              |
| Ratcheting coverage/mutation down             | DORA           | `debt-ratchet.ts` `--require-improvement` at L3 |
| `--no-verify` / `--no-gpg-sign`               | AGENTS.md      | Already enforced; reaffirmed in CONTRIBUTING.md |
| Tag-pinned third-party actions                | OSSF Scorecard | INV-75 `check-action-pins.mjs`                  |
| Top-level `permissions: write`                | OSSF Scorecard | INV-76 `check-workflow-perms.mjs`               |
| Mutation/DAST on every PR                     | PITest docs    | Templates only emit these in T4                 |
| Permanent test quarantine                     | Farley         | `quarantine/` entries require linked issue ID   |
| Bot-approval satisfies code review            | OSSF           | INV-73 triple-check                             |

---

## 12. Verification

**Unit**: All 60 combinations (5 langs × 4 archetypes × 3 governance levels) compile EJS without error; subcommand router covered by Vitest.

**Generator E2E**: `arbiter init` against each combination → assert 8 workflow files present + `actionlint` passes.

**Real-project gate**: one fixture per stack → apply workflows on fork → no-op PR triggers green required checks.

**Invariant gate**: `check-ci-tiers.mjs` reports all 8 files present; `check-all.mjs gate` passes on arbiter-self.

**Dogfood**: arbiter repo migrates to generated tier set; `09-heartbeat.yml` tested by artificially aging nightly, weekly, and monthly.

**Acceptance**: Java-reference parity audit ≥ 95% feature coverage. Known gaps (Postman/Newman, MyBatis, Liquibase) explicitly deferred to stack-extra modules v2.

---

## Sources

- Fowler — [Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) + [Deployment Pipeline](https://martinfowler.com/bliki/DeploymentPipeline.html)
- Farley — [davefarley.net](https://www.davefarley.net/) "Feedback in Five Minutes"
- Hammant — [Trunk-Based Development](https://trunkbaseddevelopment.com/)
- [SLSA v1.0 levels](https://slsa.dev/spec/v1.0/levels) + [slsa-github-generator](https://github.com/slsa-framework/slsa-github-generator)
- [GitHub blog — SLSA 3 with GitHub Actions](https://github.blog/security/supply-chain-security/slsa-3-compliance-with-github-actions/)
- [GitHub blog Oct 2025 — agent PRs everywhere](https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/)
- [OSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md)
- [OWASP DSOMM](https://owasp.org/www-project-devsecops-maturity-model/)
- [PITest threshold guidance](https://pitest.org/quickstart/mutation_threshold/) + [Stryker docs](https://stryker-mutator.io/)
- [golangci-lint v2](https://golangci-lint.run/) + [go-arch-lint](https://github.com/fe3dback/go-arch-lint) + [arch-go](https://github.com/arch-go/arch-go)
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) + [ArchUnitTS](https://lukasniessen.github.io/ArchUnitTS/) + [ArchUnitPython](https://github.com/LukasNiessen/ArchUnitPython)
- [DORA 2024 — RedMonk recap](https://redmonk.com/rstephens/2024/11/26/dora2024/)
- [Better Stack — heartbeat monitoring](https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/)
- User-supplied Java/Spring reference: 16-microservice system, 6-workflow CI architecture, 47 ArchUnit rules.
