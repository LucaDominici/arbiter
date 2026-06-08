---
generated: true
source: 'docs/REFERENCE/compliance-menu.md'
source_sha: '3204fd9fc74b56b9aeaac8d0396b5d98e0ad9652'
last_updated: '2026-06-08'
---

# Compliance & Collaboration Menu — Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/compliance-menu.md](../docs/REFERENCE/compliance-menu.md)

# Compliance & Collaboration Menu — Reference

**Feature:** (team × compliance) product menu | **Issue:** #1254 | **Umbrella:** #1248 (CI/CD & Compliance Parity) | **Language:** any (language-neutral)

## Overview

arbiter declines three orthogonal axes onto every project: **who merges**
(`collaborationMode`), **how strict the gates are** (`governanceLevel`), and
**which compliance overlay** scaffolds domain controls (`industryOverlay`). This
feature makes that decision surface an explicit product menu instead of buried
configuration. It surfaces in three places:

1. **Wizard** — `arbiter init` prompts for the overlay and prints the resulting
   `(team × compliance)` cell (branching strategy, gate level, overlay artefacts)
   plus an advisory when the overlay's weight outpaces the governance level.
2. **`arbiter doctor`** — a new `overlay-coherence` health check flags incoherent
   `(industryOverlay × governanceLevel)` cells (advisory `WARN`, never `FAIL`).
3. **Generated doc** — `docs/COMPLIANCE_MENU.md` presents every cell with rationale.

## The generated menu

`arbiter init` (any stack) emits `docs/COMPLIANCE_MENU.md` unconditionally — it is
an onboarding aid, not gated on an overlay being selected. The generator is
`src/generators/compliance-menu.ts`; the template is
`src/templates/compliance/compliance-menu.md.ejs`. The doc uses `skipIfExists`, so
brownfield re-init never overwrites a customised copy.

It is distinct from `docs/COMPLIANCE_MAPPING.md` (the `compliance` generator), which
is a controls→gates traceability table gated on the `enable*Mapping` booleans. The
menu is always-on and spans every overlay; the mapping doc is overlay-specific.

## The two axes

### Axis 1 — Team (`collaborationMode`)

| Mode           | Branching                  | Merge ceremony                               |
| -------------- | -------------------------- | -------------------------------------------- |
| `trunk-solo`   | `trunk-direct`             | direct push or opt-in PR fast-forward        |
| `peer-review`  | `github-flow`              | mandatory PR, ff-only merge                  |
| `gated-review` | `github-flow-with-develop` | required approvals, merge queue, attestation |

### Axis 2 — Compliance (`industryOverlay`)

| Overlay    | Weight | Emits                                            |
| ---------- | ------ | ------------------------------------------------ |
| `none`     | —      | nothing                                          |
| `generic`  | light  | language-neutral audit-trail policy + gate rules |
| `sox`      | medium | SOX audit-trail docs + gate rules                |
| `gdpr`     | medium | GDPR controls→gates traceability                 |
| `iso9001`  | medium | quality-process RTM + doc-control + CAPA + gate  |
| `iso27001` | heavy  | ISO 27001:2022 Annex-A security controls→gates   |
| `pharma`   | heavy  | 21 CFR Part 11 audit-trail overlay               |

## Coherence rules (`overlay × governanceLevel`)

Extends ADR-051's coherence machinery
(`src/commands/wizard/coherence.ts`, `validateOverlayCoherence`). Heavy overlays
expect L3+ rigour; medium overlays expect L2+. The check returns `WARN` (advisory)
or `OK`, never `CRITICAL`: an overlay never structurally breaks generation.

| Overlay weight                    | L1   | L2   | L3  | L4  |
| --------------------------------- | ---- | ---- | --- | --- |
| light (`generic`)                 | OK   | OK   | OK  | OK  |
| medium (`sox`, `gdpr`, `iso9001`) | WARN | OK   | OK  | OK  |
| heavy (`iso27001`, `pharma`)      | WARN | WARN | OK  | OK  |

`arbiter doctor` surfaces the `WARN` for the configured cell; the wizard surfaces it
inline after the overlay prompt. Neither blocks — the user chooses to proceed or
raise the governance level.

## End-to-end

A chosen cell flows: wizard prompt → `WizardAnswers.industryOverlay` →
`buildConfigFromAnswers` → `ProjectConfig.industryOverlay` → the registry overlay
spec (`gdpr` / `iso27001` / `iso9001` / `pharma`) → generated compliance artefacts.
The menu doc and the coherence check are generated/run regardless of the choice.
