---
title: 'Problems Solved & How'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Problems Solved & How

Each page states a concrete problem, the **exact arbiter mechanism** that addresses it — the
invariant, the generated hook or gate, the activation level — and **how to verify it yourself**.

If arbiter cannot enforce something mechanically, it is not listed here. The boundaries are
explicit on every page and collected under [What arbiter is NOT](/governance/).

| Problem                                                                  | Mechanism (what `arbiter init` generates)                           | Verify                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Agents drift from our conventions](/problems/agents-drift)              | Edit-time Claude hooks + L1 gate (INV-04, INV-21)                   | inspect `.claude/hooks/`; `check-all.mjs L1`                                 |
| [Standards documented but not enforced](/problems/enforced-not-advisory) | Every chosen rule is a HARD gate — no advisory tier                 | `check-all.mjs L2` against a violation                                       |
| [Secrets / PII slip into commits](/problems/secrets-pii)                 | gitleaks + PII scan, HARD at L2 (INV-11, INV-12)                    | `check-all.mjs L2`; `pii-scan.mjs`                                           |
| [Vulnerable dependencies reach prod](/problems/vulnerable-deps)          | Dependency audit, CVSS ≥ 7.0 fails the build (INV-13, L2)           | the generated dep-audit step                                                 |
| [Suppressions become permanent](/problems/suppression-expiry)            | Mandatory expiry; a past-due waiver blocks L1 (INV-31)              | expired waiver → `check-all.mjs L1`                                          |
| [Direct pushes / bot self-approval](/problems/branch-protection)         | Branch protection + human-approval workflow (INV-23, INV-74/91)     | inspect generated `.github/workflows/`                                       |
| [Tests written after the fact](/problems/tdd-evidence)                   | TDD red-evidence + mutation/real-DB at L2 (INV-26, INV-30/34)       | `arbiter verify tdd`                                                         |
| [Can I trust the tool itself?](/problems/dogfooding-trust)               | arbiter governs arbiter at L2; public evidence trail                | browse the repo; `arbiter verify evidence` (L4)                              |
| [A second AI tool drifts to weaker governance](/problems/codex-parity)   | Derive-from-Claude + parity gate, 100% classified surface (ADR-106) | `check-codex-parity.mjs` + `check-codex-self-parity.mjs`; inject drift → red |

## What's deliberately not here

arbiter makes **no ROI claims** (no "fewer bugs", no "faster") — see [Positioning](/governance/). It is
**not a compliance certification** and **not a replacement for engineering judgment**. Those boundaries
appear as a _Limits_ section on every page below.
