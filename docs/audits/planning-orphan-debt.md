---
title: Planning Orphan and Debt Audit
type: audit
status: ACTIVE
date: 2026-05-19
issue: '#876'
---

# Planning Orphan and Debt Audit

> Orphan, duplicate, documented-but-missing, CI-only, local-only, and drift findings
> from the planning-main skeleton scan. Each item scored for portability to arbiter.
> Purpose: know what NOT to carry forward, and why.

---

## Scoring Key

| Score           | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `skip`          | Do not port — planning-specific infra, app code, or structurally irrelevant |
| `note`          | Port the lesson (pattern, insight) but not the artifact itself              |
| `template-only` | Port as EJS framework template; never apply to arbiter-self                 |
| `port`          | Port to arbiter-self AND framework                                          |
| `done`          | Ported and verified — artifact shipped and gate-validated in arbiter        |

---

## 1. Orphan Artifacts

Files that exist in planning but have no known callers in CI, `run.sh`, or Makefile.

| Artifact                                     | Type        | Orphan reason                                                                       | Score           | Rationale                                                                         |
| -------------------------------------------- | ----------- | ----------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `scripts/ci-runner-cleanup.sh`               | CI infra    | Called only from planning's self-hosted Mac runner maintenance; no workflow trigger | `skip`          | Planning-specific Mac runner management; not a framework pattern                  |
| `scripts/mac-setup.sh`                       | CI infra    | Provisioning script for planning's physical Mac CI runner                           | `skip`          | Hardware-specific; arbiter uses GitHub-hosted + docker-ci-build                   |
| `scripts/preflight-develop.sh`               | bootstrap   | Referenced in old doc; workflow replaced by `run.sh gate`                           | `note`          | Preflight pattern is useful; implement as `scripts/setup-repo.sh` extension in W3 |
| `scripts/preflight-test5.sh`                 | bootstrap   | Same as above, test5-env flavor                                                     | `skip`          | Env-specific; arbiter has no multi-env local setup                                |
| `infra/azure/containerapp.tpl.yaml`          | infra       | Not called from any workflow; deploy uses CLI elsewhere                             | `template-only` | Good Azure ContainerApp pattern; port as EJS template in F11                      |
| `docs/security/crypto-guidelines.md`         | docs        | Referenced in AGENTS.md but no validator checks for its presence                    | `template-only` | Security doc scaffold pattern; port as F12 docs template                          |
| `docs/runbooks/nightly-cron-resurrection.md` | docs        | Referenced in `08-heartbeat.yml` failure comment; content is stub with TBDs         | `template-only` | Runbook scaffold pattern with correct stub content; port as F12 docs template     |
| `.github/workflows/zz-release-openapi.yml`   | ci-workflow | Only triggers on release; no local equivalent; OpenAPI publish may be stale         | `note`          | OpenAPI asset publication pattern is useful; evaluate for F10/F12                 |

---

## 2. Duplicate Patterns

Pairs of artifacts doing the same thing in planning.

| Pair                                                                             | Overlap                              | Score  | Arbiter lesson                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `08-heartbeat.yml` (Mac runner) vs `09-heartbeat-external.yml` (ubuntu-latest)   | Both verify nightly freshness <26h   | `port` | Dual-heartbeat pattern (primary + backup) is deliberate. Arbiter has no Mac runner so the ubuntu-only variant (`09`) is the Track A file; the Mac variant becomes the B1 template for repos that have self-hosted runners. Port both in W4/W10. |
| `run.sh gate` vs `01-pr-fast.yml`                                                | Same checks; parity enforced by test | `port` | This IS the parity contract, not a duplicate. The overlapping content is the point; the divergence is the bug. Port as INV-87 + `check-local-ci-parity.mjs`.                                                                                    |
| `check-drift.py` (original) + `check-drift.mjs` (JS port)                        | Python original vs JS port           | `port` | Port only the JS version as `scripts/check-drift.mjs` in W6 (N-04). Python original = source of truth for algorithm; JS = arbiter implementation.                                                                                               |
| `scripts/verify-spotbugs.sh` + SpotBugs in `05-release.yml`                      | Both run SpotBugs                    | `skip` | Java-specific. F2-java adapter ledger.                                                                                                                                                                                                          |
| `SECURE_CODING_CHECKLIST.md` (root) + `docs/security/SECURE_CODING_CHECKLIST.md` | Same file, two paths                 | `note` | For generated projects: pick one canonical location. Arbiter uses `docs/security/` convention. Port to F12 at single path only.                                                                                                                 |

---

## 3. Documented-But-Missing

Docs reference files that do not exist in the planning tree (or exist as empty stubs).

| Doc reference                                                               | Missing file                                    | Score  | Arbiter lesson                                                                                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` cites `scripts/validate-*.sh` family                            | Only 4 of 8 cited validators exist              | `note` | Never document an invariant without a validator. Arbiter enforces this via CANON-08/09: no invariant entry without a matching gate script.    |
| `docs/ci/README.md §3b parity table`                                        | References `run.sh simulate release` subcommand | `note` | Subcommand was removed but doc not updated. Arbiter: `check-local-ci-parity.mjs` machine-verifies parity and catches this immediately.        |
| `06-nightly.yml` comments reference `runbooks/nightly-cron-resurrection.md` | File exists but content is TBD stubs            | `note` | Runbooks cited in error conditions must have actionable content before shipping. Arbiter: runbook path is validated by `check-doc-links.mjs`. |
| `05-release.yml` references `CHANGELOG.md` for release notes                | No `CHANGELOG.md` exists                        | `skip` | Planning uses GitHub releases; CHANGELOG absent is intentional. Arbiter has its own release notes approach.                                   |

---

## 4. CI-Only Patterns

Run in CI but have no documented local equivalent (violates planning's own parity contract).

| Artifact                                             | CI tier           | Missing local equivalent                    | Score           | Arbiter decision                                                                                                                                                                          |
| ---------------------------------------------------- | ----------------- | ------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PITest mutation (in `05-release` + `06-nightly`)     | Release + Nightly | No local `./run.sh full-mutation`           | `skip`          | Java bytecode mutation analysis; no TS equivalent. F2-java adapter ledger. The pattern (mutation test in release) is sound; arbiter's TS adapter uses vitest coverage thresholds instead. |
| Toxiproxy chaos tests (in `06-nightly`)              | Nightly           | No local Toxiproxy setup                    | `skip`          | Chaos testing requires running DB containers (Java/Spring). Not applicable to arbiter-self or TS adapter.                                                                                 |
| OWASP Dependency Check (in `06-nightly`)             | Nightly           | No local equivalent                         | `note`          | OWASP DC is Java-Maven-specific. TS equivalent: `npm audit --audit-level=high`. Port pattern to TS adapter nightly (W10).                                                                 |
| ZAP DAST (in `06-nightly`)                           | Nightly           | Requires running deployed service           | `template-only` | Can only run against a deployed endpoint. F8 template only; never arbiter-self.                                                                                                           |
| `validate-liquibase-naming.sh` (in `02-pr-extended`) | PR extended       | No pre-push equivalent                      | `skip`          | Java/Liquibase-specific. F2-java adapter ledger.                                                                                                                                          |
| Trivy strict scan (in `05-release`)                  | Release           | `trivy fs --exit-code 1 .` runnable locally | `port`          | Port as `scripts/check-supply-chain.mjs` (W9) + add `make trivy` target in local wrapper.                                                                                                 |

---

## 5. Local-Only Patterns

Exist in `run.sh` subcommands but not reflected in CI.

| Local command               | CI equivalent                  | Gap                                        | Score           | Arbiter decision                                                                                                                                                 |
| --------------------------- | ------------------------------ | ------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./run.sh audit-toolchain`  | None in CI                     | Deliberate: forensic-only, exits 0 always  | `done`          | Ported as `scripts/audit-toolchain.mjs` in W11 (#887, N-05). 10/10 checks pass on arbiter-self. EJS template in `src/templates/scripts/audit-toolchain.mjs.ejs`. |
| `./run.sh dev-reset`        | None in CI                     | Dev environment teardown; not a CI concern | `skip`          | Planning-specific dev environment with Docker Compose + DB. Arbiter has no equivalent.                                                                           |
| `./run.sh quality-check`    | Partial: parts in `01-pr-fast` | Runs SpotBugs manually outside CI tier     | `skip`          | Java-specific quality check wrapper.                                                                                                                             |
| `./run.sh inject-test-data` | None in CI                     | Seed data injection for manual testing     | `template-only` | Seed data pattern useful for M2+ projects; port as optional template subcommand in F6/F7.                                                                        |

---

## 6. Drift Findings

Declared in spec/doc but implementation differs.

| Spec claim                                                          | Actual implementation                                                                                                         | Drift severity | Score  | Arbiter rule                                                                                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| "All validators support `--help`" (AGENTS.md §Validators)           | `validate-mybatis-xml-crud.sh --help` exits 0 but prints nothing                                                              | Low            | `note` | Arbiter INV-89: every validator must print useful help text on `--help`. `check-validator-helptext.mjs` validates this. Empty help text = gate fail.  |
| "No suppression without rationale + expiry" (AGENTS.md §Invariants) | `suppressions.toml` has 3 entries with rationale but no expiry date field                                                     | Medium         | `port` | Arbiter W6: `check-suppression-expiry.mjs` enforces expiry field exists AND is a future date. Missing expiry = gate fail.                             |
| "`06-nightly.yml` comment: runs gitleaks on full history"           | Gitleaks runs with `--since-commit HEAD~50` (not full history)                                                                | Low            | `note` | Deliberate optimization for large repos. Arbiter: document the `--since-commit` behavior in `.gitleaks.toml` with a rationale comment.                |
| "`run.sh simulate nightly` is equivalent to CI nightly"             | Toxiproxy tests skipped in simulate (requires live containers)                                                                | Medium         | `note` | Parity contract allows `allowed-skips` for env-dependent steps. Arbiter: document allowed-skips in the parity validator config.                       |
| "`05-release.yml`: Sigstore signs every release"                    | Sigstore outage fallback: `_sigstore-retry-sign.yml` exists but the `Sigstore-Bypass:` commit footer protocol is undocumented | Medium         | `port` | Port the bypass protocol to arbiter W9: `_sigstore-retry-sign.yml` + documented `Sigstore-Bypass:` footer policy in `docs/REFERENCE/supply-chain.md`. |
| "`labels.yml` declares `approved-by-human` label from day 1"        | Label existed for 3 months before `_label-on-approve.yml` was written; label was applied manually in the interim              | Low            | `port` | Port labels.yml (W4) and `_label-on-approve.yml` (W8) in the same wave. Avoid partial state.                                                          |

---

## 7. Planning-Specific Rejects

Patterns that are valid in planning but structurally inappropriate for arbiter or any generated project.

| Pattern                                                            | Reason for rejection                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `ci-runner-cleanup.sh` — self-hosted Mac runner garbage collection | Planning operates physical Mac CI runners; arbiter uses GitHub-hosted + docker-ci-build                  |
| `mac-setup.sh` — Mac runner provisioning                           | Same: arbiter has no self-hosted Mac runner                                                              |
| PITest mutation configuration (56+ mutator knobs)                  | Java bytecode analysis; no TS equivalent; F2-java adapter ledger only                                    |
| ArchUnit R-01..R-34 rules (except R-35..R-39 pharma)               | Java-specific import/annotation/class-hierarchy enforcement; TS uses ESLint equivalents in stack adapter |
| Liquibase / MyBatis validation scripts                             | Java DB migration stack; no TS equivalent; F2-java adapter ledger                                        |
| Toxiproxy chaos scenarios                                          | Requires running Docker network with DB; Java/Spring application testing; not framework-level            |
| `jasypt-check.sh`                                                  | Jasypt is a Java encryption library; no TS equivalent                                                    |
| Test class count gap (358 Java tests vs 33)                        | Business code quality metric; not a framework pattern                                                    |

---

## Summary Statistics

| Finding type              | Count | Score distribution                      |
| ------------------------- | ----- | --------------------------------------- |
| Orphan artifacts          | 8     | 4 skip, 2 note, 2 template-only         |
| Duplicate patterns        | 5     | 3 port, 1 skip, 1 note                  |
| Documented-but-missing    | 4     | 0 port, 4 note                          |
| CI-only patterns          | 6     | 2 skip, 1 note, 2 template-only, 1 port |
| Local-only patterns       | 4     | 2 skip, 1 port, 1 template-only         |
| Drift findings            | 6     | 2 note, 4 port                          |
| Planning-specific rejects | 8     | 8 skip                                  |

**Patterns to port to arbiter-self or framework:** 8
**Template-only (generated projects only):** 5
**Skip or reject:** 15
**Note (pattern ported, not artifact):** 9

---

## References

- `docs/audits/planning-skeleton-inventory.json` — full 123-item artifact inventory with dispositions
- `docs/audits/kit-canonical-mapping.json` — KIT dim citations per artifact
- `docs/audits/arbiter-skeleton-gap-analysis.md` — severity-rated gap matrix by HarnessCategory
- `docs/REFERENCE/external-kit-sources.md` — planning repo pointer for re-reads
