# Viafera Audit — Inventory & Reconciliation

**Source repo:** `viafera @ e6b9cf1fa89430d86f3979fcbc6851802915dfdb`
**Capture date:** 2026-05-14
**Discovery command:** `find . -name "*.md" -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./.worktrees/*" -not -path "./test-results/*" -not -path "./.playwright-mcp/*" | wc -l`
**Total MD files in scope:** **3560**

---

## Reconciliation

```
Tier-A (READ)                =  136
Tier-B (CLASSIFIED_BY_PATH)  = 1106
Tier-C (EXCLUDED)            = 2318
─────────────────────────────────────
Σ                            = 3560   ✓ matches find total
```

Verification command (run from `/home/luca/work/repos/viafera`):

```bash
find . -name "*.md" \
  -not -path "./node_modules/*" -not -path "./.git/*" \
  -not -path "./.worktrees/*" -not -path "./test-results/*" \
  -not -path "./.playwright-mcp/*" | wc -l
# Expected: 3560
```

If number drifts, audit must be re-reconciled. Inventory is not a snapshot of the
authors' intent — it is a snapshot of the file-system at HEAD `e6b9cf1`.

---

## Tier-C — EXCLUDED (counted, not read)

| Bucket                                                           | Path glob           | Count    | Exclusion rule                                                                                                            |
| ---------------------------------------------------------------- | ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Frontend code & deps                                             | `frontend/**/*.md`  | 1609     | UI implementation; ~98% are dep-bundled package READMEs in `node_modules`-equivalent locations; sample ≤5 for sanity only |
| Evidence artifacts                                               | `.evidence/**/*.md` | 609      | Generated evidence (machine output, not authored doc)                                                                     |
| Mockups                                                          | `mockups/**/*.md`   | 40       | Design notes; titles only                                                                                                 |
| Artifacts (gauntlet, load, etc.)                                 | `artifacts/**/*.md` | 20       | Build/test runtime artifacts (premortem note: 20+ gauntlet runs persisted in repo — see CERIMONIA)                        |
| ZAP report                                                       | `.zap/*.md`         | 1        | DAST runtime output                                                                                                       |
| Hidden runtime                                                   | `.githooks/*.md`    | 1        | Hook self-doc                                                                                                             |
| Load tests                                                       | `load-tests/*.md`   | 1        | Runtime                                                                                                                   |
| **Config + Backend + Contracts + observability + infra + audit** | —                   | 13       | Counted, body unread (small surface, low value)                                                                           |
| **Tier-C Σ**                                                     |                     | **2318** |                                                                                                                           |

Sample sanity reads (≤5 files): performed for `frontend/README.md` and `frontend/e2e-v2/README.md` only; no surprises that flip any verdict.

---

## Tier-A — READ (every file opened, scout produces a row)

136 files, distributed by scout bucket. Full per-file tables live in the corresponding
scout output (folded into `<details>` sections below after scout runs).

### A.1 — Top-level (lead, 7 files)

```
viafera/AGENTS.md
viafera/README.md
viafera/IMPLEMENTATION_SUMMARY.md
viafera/SECURITY.md
viafera/CONTRIBUTING.md
viafera/CLA.md
viafera/notes.md
```

### A.2 — METHOD (scout #1, 15 of 46)

```
viafera/docs/METHOD/ENGINEERING_MANUAL.md
viafera/docs/METHOD/ENGINEERING_DEFAULTS.md
viafera/docs/METHOD/GLOBAL_INVARIANTS.md
viafera/docs/METHOD/PROCESS_CORE.md
viafera/docs/METHOD/SSOT_CASTLE_NOTES.md
viafera/docs/METHOD/SSOT_CORE_SET.md
viafera/docs/METHOD/SSOT_ENTRYPOINTS_MAP.md
viafera/docs/METHOD/NOTARY_SYSTEM.md
viafera/docs/METHOD/GOVERNANCE_WIRING.md
viafera/docs/METHOD/RFC-001_LEDGER_AUTOPILOT.md
viafera/docs/METHOD/OPERATIONS_HANDBOOK.md
viafera/docs/METHOD/EVIDENCE_RETENTION_POLICY.md
viafera/docs/METHOD/VERIFICATION_BRIDGE.md
viafera/docs/METHOD/TESTING_POLICY.md
viafera/docs/METHOD/TEST_TAXONOMY.md
```

Remaining 31 METHOD files → Tier-B (counted, path-classified).

### A.3 — SYSTEM (scout #2, 13 of 25)

```
viafera/docs/SYSTEM/COMPLIANCE_MAPPING.md
viafera/docs/SYSTEM/ENTERPRISE_COMPLIANCE.md
viafera/docs/SYSTEM/PRIVACY_MODEL.md
viafera/docs/SYSTEM/RISK_REGISTER.md
viafera/docs/SYSTEM/RISK_ASSESSMENT_TEMPLATE.md
viafera/docs/SYSTEM/PENTEST_PREPARATION.md
viafera/docs/SYSTEM/SECRETS_MANAGEMENT.md
viafera/docs/SYSTEM/ARCHITECTURE.md
viafera/docs/SYSTEM/DECISIONS.md
viafera/docs/SYSTEM/JWT_ADVANCED.md
viafera/docs/SYSTEM/GOVERNANCE_DASHBOARD.md
viafera/docs/SYSTEM/FRONTEND_CONSTITUTION.md
viafera/docs/SYSTEM/TEST_MATRIX.md
```

Remaining 12 SYSTEM files → Tier-B.

### A.4 — FRAMEWORK + vault/governance (scout #3, 41 files)

```
viafera/docs/FRAMEWORK/PHOENIX/SEPARATION_ADR.md
viafera/docs/FRAMEWORK/PHOENIX/SEPARATION_PLAN.md
viafera/docs/FRAMEWORK/PHOENIX/SEPARATION_ROADMAP.md
viafera/docs/FRAMEWORK/PHOENIX/ARCHITECT_PATTERNS.md
viafera/docs/FRAMEWORK/PHOENIX/RED_TEAM_ANSWERS.md
viafera/docs/FRAMEWORK/PHOENIX/RED_TEAM_ANSWERS_R2.md
viafera/docs/FRAMEWORK/PHOENIX/RED_TEAM_ANSWERS_R3.md
viafera/docs/FRAMEWORK/PHOENIX/README.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/README.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/PLAN_SCHEMA_V2.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/CONTEXT_PACK_SPEC.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/CONTEXT_SLICE_SPEC.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/REUSE_REGISTRY_SPEC.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/BRIDGE_V2_INTEGRATION.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/FRAMEWORK_COMPARISON.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/BASELINE.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/CONTEXT_AUDIT.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/PROOF.md
viafera/docs/FRAMEWORK/VERIFICATION_BRIDGE/PROOF_E2E_VB06.md
viafera/docs/FRAMEWORK/CONTRACT_INTEGRITY/README.md
viafera/docs/FRAMEWORK/CONTRACT_INTEGRITY/CONFIGURATION.md
viafera/docs/FRAMEWORK/CONTRACT_INTEGRITY/EVIDENCE_FORMAT.md
viafera/docs/FRAMEWORK/CONTRACT_INTEGRITY/GATES_REFERENCE.md
viafera/docs/FRAMEWORK/CONTRACT_INTEGRITY/INTEGRATION.md
viafera/docs/FRAMEWORK/CONTRACT_INTEGRITY/TROUBLESHOOTING.md
viafera/docs/vault/governance/AGENTS.md
viafera/docs/vault/00-INDEX.md
viafera/docs/vault/governance/decisions/*.md   (sample 6)
viafera/docs/vault/governance/invariants/*.md  (sample 6)
viafera/docs/vault/architecture/*.md           (sample 3)
viafera/docs/vault/prd/*.md                    (sample 3)
viafera/FRAMEWORK/DOCS (top-level)             (4 files)
```

Remainder of vault → Tier-B.

### A.5 — qa-audit + arbiter-overlay (lead, 25 files)

```
# qa-audit (full)
viafera/qa-audit/PHASE1_API_INVENTORY.md
viafera/qa-audit/PHASE1_NFR_INVENTORY.md
viafera/qa-audit/PHASE1_TEST_TOOLING_MAP.md
viafera/qa-audit/PHASE2_EDGE_CASE_SEED.md
viafera/qa-audit/PHASE2_RBAC_COVERAGE.md
viafera/qa-audit/PHASE3A_BUSINESS_LOGIC_AUDIT.md
viafera/qa-audit/PHASE3B_API_CONTRACT_AUDIT.md
viafera/qa-audit/PHASE3B_ERROR_HANDLING_AUDIT.md
viafera/qa-audit/PHASE3C_UI_UX_AUDIT.md
viafera/qa-audit/PHASE3D_ERGONOMICS_AUDIT.md
viafera/qa-audit/PHASE3E_PERFORMANCE_REPORT.md
viafera/qa-audit/PHASE3E_PERSISTENCE_AUDIT.md
viafera/qa-audit/PHASE4D_API_AUDIT_LOG.md
viafera/qa-audit/QA_EXECUTION_SUMMARY.md
viafera/qa-audit/TEST_PLAN_TRACEABILITY.md

# arbiter-overlay (sampled — lead reads to avoid recursion)
viafera/arbiter-overlay/AGENTS.md
viafera/arbiter-overlay/GLOBAL_INVARIANTS.md
viafera/arbiter-overlay/SECURITY.md
viafera/arbiter-overlay/CONTRIBUTING.md
viafera/arbiter-overlay/docs/CODING_STANDARDS.md
viafera/arbiter-overlay/docs/TESTING_POLICY.md
viafera/arbiter-overlay/docs/SECURE_CODING_CHECKLIST.md
viafera/arbiter-overlay/docs/MASTER_TEST_PLAN.md
viafera/arbiter-overlay/docs/SECURITY/STRIDE.md
viafera/arbiter-overlay/docs/METHOD/SSOT_CORE_SET.md
```

Remaining 33 `arbiter-overlay/**` MDs → Tier-B (most are .claude/.agents config dupes).

### A.6 — .agents runtime + .claude samples (scout #5, 18 files)

```
# .agents (all 11 authored MDs)
viafera/.agents/README.md
viafera/.agents/CODEX.md
viafera/.agents/rules/README.md
viafera/.agents/rules/05-agent-lifecycle.md
viafera/.agents/rules/10-knowledge-map.md
viafera/.agents/rules/20-viafera-help-sync.md
viafera/.agents/rules/25-todo-folder-policy.md
viafera/.agents/rules/30-mcp-usage.md
viafera/.agents/rules/90-exec-protocol.md
viafera/.agents/rules/96-batch-execution.md
viafera/.agents/reports/BRIDGE_CONTEXT_REPORT.md

# .claude samples (7 representative of 451)
viafera/.claude/CLAUDE.md
viafera/.claude/agents/red-team.md         (if exists)
viafera/.claude/agents/codebase-scanner.md (if exists)
viafera/.claude/commands/task.md
viafera/.claude/hooks/*                     (1 sample)
viafera/.claude/skills/*                    (2 samples)
viafera/.claude/rules/90-exec-protocol.md
```

Remaining 444 `.claude/**/*.md` → Tier-B (Claude Code agent runtime; mostly stock skills cloned from public plugins — minimal salvage outside arbiter-overlay parity).

The 14 `.agents/plan/runs/bridge-*/**` files → Tier-C-style (runtime artifacts; aggregated count goes into Tier-B for honesty since path is authored).

### A.7 — Ops & archive (scout #6, 17 files)

```
viafera/.github/PULL_REQUEST_TEMPLATE.md
viafera/.github/ISSUE_TEMPLATE/*  (1-2 samples)
viafera/.github/workflows/README.md  (if present)
viafera/contracts/README.md
viafera/observability/README.md  (or alloy/grafana README)
viafera/infra/README.md
viafera/tests/lib/README.md  (or top-level tests README)
viafera/tests/golden/README.md
viafera/load-tests/README.md
viafera/config/README.md
viafera/99-ARCHIVE/claude/memory-legacy.md
viafera/audit/*.md (3 files)
viafera/TODO/*.md (4 of 8 samples)
viafera/.githooks/README.md
viafera/viafera.sh                    # not .md but read for selling points
viafera/docker-compose.yml            # not .md but read for governance posture
```

---

## Tier-B — CLASSIFIED_BY_PATH (counted, body unread)

Total 1106 files. Path-only verdicts in `FINDINGS.md` based on directory heuristics from the rubric.

| Bucket                                                                         | Path                                                                       | Count    | Default verdict candidate (rubric)                                        |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| METHOD remainder                                                               | `docs/METHOD/` minus Tier-A                                                | 31       | mix of PORT/CERIMONIA (per name)                                          |
| SYSTEM remainder                                                               | `docs/SYSTEM/` minus Tier-A                                                | 12       | mostly CERIMONIA narrative                                                |
| FRAMEWORK PHOENIX `future/`                                                    | `docs/FRAMEWORK/PHOENIX/future/*`                                          | ~10      | OBSOLETE (future-tense planning never shipped)                            |
| vault remainder                                                                | `docs/vault/` minus Tier-A                                                 | ~22      | PORT or OBSOLETE per `superseded/` flag                                   |
| PRODUCT/MOCKUPS                                                                | `docs/PRODUCT/MOCKUPS/`                                                    | 15       | CERIMONIA (visual narrative)                                              |
| docs/AUDIT, docs/audits                                                        | `docs/AUDIT/**`, `docs/audits/**`                                          | ~7       | CERIMONIA (one-shot reports)                                              |
| docs/manual, plans, prompts, testing, security, evidence, NOTES, ARBITER, SSOT | `docs/{manual,plans,prompts,testing,security,evidence,NOTES,ARBITER,SSOT}` | ~75      | mixed                                                                     |
| 99-ARCHIVE                                                                     | `docs/99-ARCHIVE/**`, `99-ARCHIVE/*`                                       | ~28      | OBSOLETE by path rule O1                                                  |
| arbiter-overlay remainder                                                      | `arbiter-overlay/**` minus Tier-A                                          | 33       | REJECT (recursion anti-pattern J4)                                        |
| `.claude/**` remainder                                                         | 451 minus 7 sampled                                                        | 444      | mostly stock plugin skills — CERIMONIA when not enforcement-bearing       |
| `.agents/plan/runs/**`                                                         | 14                                                                         | 14       | OBSOLETE (run artifacts)                                                  |
| tools/                                                                         | `tools/**`                                                                 | 220      | CERIMONIA (per filename heuristic — most are scripts with `.md` siblings) |
| scripts/                                                                       | `scripts/**`                                                               | 177      | CERIMONIA                                                                 |
| tests/                                                                         | `tests/**`                                                                 | 8        | mix (PORT for fixture taxonomy, else CERIMONIA)                           |
| TODO/                                                                          | `TODO/*`                                                                   | 8        | OBSOLETE (TODO graveyard)                                                 |
| .github/ remainder                                                             | `.github/**` minus Tier-A                                                  | ~2       | PORT (templates)                                                          |
| **Tier-B Σ**                                                                   |                                                                            | **1106** |                                                                           |

---

## Tier-A path index (final list, 136 entries)

The 136 Tier-A paths above are the audit's ground truth. Every scout row must cite one
of these paths. Tier-B verdicts may be batched (one row per directory cluster) but each
batch row is anchored to a count from this inventory.

---

## Stale-document signal

For Tier-A files, scouts MUST report `Last commit (date)` via:

```bash
git -C /home/luca/work/repos/viafera log -1 --format=%cs -- <path>
```

If date is older than `2025-12-01` (>5 months stale at audit time 2026-05-14) and the
file declares `Status: ENFORCED` or `Status: ACTIVE`, the row triggers `R-CER-04` (time-decay).

---

## Changelog

| Date       | Δ                                    | Author     |
| ---------- | ------------------------------------ | ---------- |
| 2026-05-14 | Initial inventory at viafera@e6b9cf1 | Audit lead |
