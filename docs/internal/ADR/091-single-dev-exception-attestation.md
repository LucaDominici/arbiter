---
title: 'ADR-091: Single-Developer Exception Attestation (§11.10(k))'
doc_version: '1.0.0'
status: active
last_review: '2026-06-07'
owner: ''
canonical_id: '091'
tags: ['audience/dev', 'kind/adr', 'governance', 'regulated', 'trunk-solo', 'attestation']
related: ['051-trunk-solo-collaboration-mode', '050-pipeline-complexity-tiers']
---

# ADR-091: Single-Developer Exception Attestation (§11.10(k))

## Status

Accepted

## Context

Regulated software development frameworks (21 CFR Part 11, EU MDR, ISO 13485) permit a
single-developer exception under §11.10(k) when identity control, audit trail, and automated
rigor are demonstrably maintained. The arbiter trunk-solo collaboration mode provides the
technical controls, but previously lacked:

1. A generated attestation document declaring the exception formally
2. A per-run validation-evidence template for regulatory evidence packages
3. A human-readable pipeline mental model for auditors and developers
4. An automated reactivation trigger when team composition changes

The coherence matrix (`src/commands/wizard/coherence.ts`) already identified trunk-solo+L3
as a valid-but-warned cell. This ADR codifies the resolution: the single-developer exception
is acceptable _when the generated artifacts are present and the reactivation trigger is active_.

## Decision

For projects with `collaborationMode: 'trunk-solo'` at `governanceLevel ∈ {L3, L4}`,
arbiter generates a regulated mono-dev pack comprising three deliverables:

### Deliverable 1: Single-Dev Exception Attestation (`SOLO_DEV_EXCEPTION.md`)

A declaration document that:

- References §11.10(k) as the regulatory basis
- States that the arbiter review pipeline serves as the rigor-equivalent reviewer
- Lists the reactivation trigger conditions
- Provides a signature slot for the developer to attest the controls

### Deliverable 2: Validation-Evidence Template (`VALIDATION_EVIDENCE_TEMPLATE.md`)

A per-run template for capturing:

- Gate status (L1/L2/L3 measured results)
- Real-run metrics (coverage %, mutation score, CVE count)
- SHA-pinned evidence artifact inventory
- Cosign/GPG signature slot
- Reactivation check result

### Deliverable 3: CI Pipeline Mental Model (`CI_MENTAL_MODEL.md`)

A generated doc explaining the five pipeline stages (T0–T4) at the project's governance level:

- What gates run at each stage
- Which gates are blocking vs informational
- Wall-clock targets
- For trunk-solo: where the reactivation check runs (nightly, T4)

### Reactivation Trigger

A script (`scripts/check-solo-reactivation.mjs`) that runs nightly and:

- Counts distinct author emails in the trailing 30-day git log (case-insensitive)
- Exits with code 1 (blocking nightly) when ≥3 distinct authors are detected
- Exits with code 1 when `EXTERNAL_AUDIT=true` environment variable is set
- Prints clear remediation instructions on trigger

**Design choice: detect-and-block, not silent auto-switch.** The script does not mutate
branch protection or CODEOWNERS files. Automated reconfiguration of security controls is
too risky for a nightly job (no human approval, potential CI race). The script fails loudly
and provides the exact commands the developer must run manually.

## Evidence Retention

Evidence packages must be retained per `docs/METHOD/EVIDENCE_RETENTION.md`:

- **Minimum retention:** 2 years for contexts requiring §11.10 compliance
- **Rotation:** `scripts/evidence-rotate.mjs` enforces the configured last-N policy
- Evidence is the combination of: this attestation doc + signed validation-evidence template + CI gate artifacts

## Consequences

### Positive

- trunk-solo+L3 is now a first-class supported configuration with regulatory backing
- The coherence.ts WARN message now references the resolution (rather than an unaddressed gap)
- Auditors receive a complete evidence package: attestation + per-run metrics + pipeline mental model
- The reactivation trigger prevents the exception from silently persisting after team growth

### Negative

- Solo developers at L3 must periodically fill in and sign the validation-evidence template
- The nightly CI fails if the reactivation check triggers — requires manual remediation
- L4 + trunk-solo remains a CRITICAL coherence violation (ADR-050 requires human attestation at L4)

## Alternatives Considered

### Silent auto-switch to CODEOWNERS on trigger

Rejected: mutating branch protection rules from a nightly job bypasses the human review
that §11.10(k) requires at the moment of the transition. The developer must consciously
switch modes.

### Require peer-review for all L3+ projects

Rejected: legitimate solo maintainers with strong automation deserve first-class support.
The exception pattern (widely used in small-team regulated contexts) is a proven approach.

## References

- Issue #1250 — CICD-Parity 2/6: regulated mono-dev pack
- Issue #1248 — UMBRELLA: CI/CD & Compliance Parity
- ADR-051 — trunk-solo collaboration mode design
- ADR-050 — pipeline complexity tiers
- `src/commands/wizard/coherence.ts` — trunk-solo+L3 WARN cell
- `src/generators/solo-exception.ts` — generator implementation
