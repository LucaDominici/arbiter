# Enterprise Compliance Baseline (M-03) — Port Notes

**Date:** 2026-05-17
**Origin:** #711 — "M-03 — Enterprise compliance baseline template"

## What landed

`src/templates/governance/enterprise-compliance-baseline.md.ejs` — structural skeleton ported from `reference-impl/docs/SYSTEM/ENTERPRISE_COMPLIANCE.md` (6308 LOC).

The template ports the **structure only**, not the 6308-LOC content. Each section has `[FILL: ...]` markers describing what per-project evidence belongs there. Empty markers fail the L2 compliance gate.

## Sections

| Section | Purpose                                                              |
| ------- | -------------------------------------------------------------------- |
| 1.1     | GDPR Art.6 legal-basis register                                      |
| 1.2     | GDPR Art.17 erasure cascade (cross-references M-05 #713 once landed) |
| 1.3     | GDPR Art.32 security-of-processing                                   |
| 1.4     | GDPR Art.15 data-subject access SLA                                  |
| 2.1     | NIS2 supply-chain register                                           |
| 2.2     | NIS2 24h incident reporting timeline                                 |
| 2.3     | NIS2 risk-management framework reference                             |
| 3.1     | ISO 27001 Annex A controls in scope                                  |
| 3.2     | ISO 27001 Statement of Applicability                                 |
| 4       | OWASP Top 10 mitigation matrix (A01–A10)                             |
| 5       | Review cadence (per trigger + annual)                                |

## What this port does NOT include

- **Vendor lock-in advice.** Per never-import policy NI-4, the template avoids prescribing specific vendors. Reference any-vendor patterns; pick your own KMS / SIEM / etc.
- **Country-specific data residency.** The reference-impl is EU-centric. Projects shipping in additional jurisdictions extend §1.\* with the additional regimes (CCPA, LGPD) — append, do not edit the file's structure.
- **Per-control implementation evidence.** Evidence belongs in `.evidence/compliance/` with SHA pins; this baseline is the index, not the artifact store.

## CANON references

- **CANON-04** (every .ejs has a render test): satisfied — `__tests__/templates/governance-render.test.ts` asserts no EJS leaks, projectName interpolation, GDPR Art refs, NIS2 timing, ISO ref, OWASP rows, `[FILL]` markers, and the opt-in flag doc.

## Opt-in flag

```jsonc
{
  "compliance": {
    "enterprise_baseline": true,
  },
}
```

When set, arbiter init writes the baseline to the target project at `governance/enterprise-compliance-baseline.md`.

## Follow-ups (not opened tonight)

- Auto-validator that flags `[FILL]` markers as failures at L2 (currently the gate is documented but not yet enforced by a script). Track if/when a downstream project asks.
- Cross-link from generated AGENTS.md mentioning this baseline when the opt-in flag is set.
