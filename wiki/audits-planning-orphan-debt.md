---
generated: true
source: 'docs/audits/planning-orphan-debt.md'
source_sha: '2bb2e0ac034e10e68cb421a4959764c62b45ee8e'
last_updated: '2026-06-07'
---

# Planning Orphan and Debt Audit

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/audits/planning-orphan-debt.md](../docs/audits/planning-orphan-debt.md)

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
| `05-release.yml` references `CHANGELOG.md` for release notes                | No `CHANGELOG.md` exists                        | `skip` | Planning uses GitHub                                                                                                                          |

_[content truncated — see source for full text]_
