---
generated: true
source: 'docs/REFERENCE/supply-chain.md'
source_sha: '574f702edecc18e08abf429d472f98cb0c2a130c'
last_updated: '2026-07-02'
---

# Supply Chain Security Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/supply-chain.md](../docs/REFERENCE/supply-chain.md)

# Supply Chain Security Reference

> **INV-92** — Supply chain: keyless signing, SBOM attestation, Trivy CRITICAL block
> **W9** of the Planning Skeleton Migration (#875)

## Overview

Arbiter enforces a four-stage supply chain pipeline for every release artifact:

```
Build → Trivy CRITICAL scan → cosign sign-blob → SBOM attest → GitHub release
```

All stages are declared in `src/templates/github/workflows/05-release.yml.ejs` and emitted when
`ciTierMode` is not `'baseline'` (i.e., `full` mode, which is the default).

## Components

### 1. Trivy Filesystem Scan (`trivy-fs-scan` job)

- **Tool:** `aquasecurity/trivy-action`
- **Scope:** filesystem scan (`scan-type: fs`) of the checked-out source tree
- **Blocking threshold:** `CRITICAL` severity, `exit-code: 1`
- **HIGH-severity:** reported but does not block — target projects may have legacy transitive deps
- **Suppression:** via `.trivyignore` (INV-31: must include rationale + expiry date per entry)
- **Gate position:** runs before `cosign-sign`; signing cannot proceed if CRITICAL CVEs are found

### 2. Cosign Keyless Signing (`cosign-sign` job)

- **Tool:** `sigstore/cosign-installer` + `cosign sign-blob --yes`
- **Method:** OIDC keyless signing via GitHub Actions OIDC token → Fulcio CA → Rekor transparency log
- **No private keys required** — identity is bound to the GitHub Actions OIDC claim
- **Output:** `release-artifact.zip.bundle` (uploaded as artifact, attached to GitHub release)
- **Related:** INV-79 — cosign sign-blob required for every release artifact

### 3. SBOM Generation and Attestation (`sbom` + `sbom-attest` jobs)

- **Format:** CycloneDX JSON (`sbom.cdx.json`)
- **Per-stack tooling:**
  | Stack | Tool |
  |------------|-----------------------------------------|
  | TypeScript | `npm sbom --sbom-format cyclonedx` |
  | Java/Gradle| `./gradlew cyclonedxBom` |
  | Java/Maven | `mvn cyclonedx:makeAggregateBom` |
  | Go | `anchore/sbom-action` (syft) |
  | Python | `cyclonedx-bom` (`cyclonedx_py auto`) |
  | Rust | `cargo-cyclonedx` |
- **Attestation:** `cosign attest --predicate sbom.cdx.json --type cyclonedx` (keyless OIDC)
- **Retention:** 90 days as GitHub Actions artifact

### 4. Sigstore Retry Wrapper (`_sigstore-retry-sign.yml`)

A reusable workflow (`workflow_call`) that wraps cosign sign-blob with exponential back-off
retry logic. Sigstore's Fulcio/Rekor endpoints are occasionally flaky under load.

- **Max attempts:** configurable input (default 3)
- **Back-off:** starts at 10s, doubles each attempt
- **Usage:** `uses: ./.github/workflows/_sigstore-retry-sign.yml` with `inputs.artifact-path`

### 5. SLSA Provenance (`slsa-provenance` job)

- **Tool:** `slsa-framework/slsa-github-generator`
- **L2 governance:** SLSA Build Level 2 (signed provenance)
- **L3 governance:** SLSA Build Level 3 (hermetic builder)
- **Related:** INV-78 — SLSA provenance required at T3 for L2+ governance

## Composite Action: sign-and-attest

The composite action at `.github/actions/sign-and-attest/action.yml` (generated from
`src/templates/github/actions/sign-and-attest/action.yml.ejs`) encapsulates:

1. `cosign sign-blob --yes` (keyless OIDC)
2. `cosign attest --predicate` (CycloneDX SBOM, when `sbom-path` input is provided)
3. `actions/attest-build-provenance` (GitHub native provenance attestation)
4. Signature bundle upload

At **L3 governance**, an additional `cosign verify-blob` step validates the freshly-created
signature bundle before proceeding.

## .trivyignore Policy

All vulnerability suppressions in `.trivyignore` MUST include:

- A rationale comment on the line above: `# CVE-YYYY-NNNNN: <why safe to ignore>`
- An expiry date on the CVE line: `CVE-YYYY-NNNNN exp:YYYY-MM-DD`
- Review within 90 days (INV-31)

Suppressions without expiry dates fail the `check-suppression-expiry.mjs` gate (INV-89).

## INV-92 Invariant

```
id: INV-92
tier: security
title: Supply chain — keyless signing, SBOM attestation, and Trivy CRITICAL block
enforcement: generated 05-release.yml (trivy-fs-scan + cosign-sign + sbom-attest jobs)
minGovernanceLevel: L2
```

## Related Invariants

| Invariant | Description                                          |
| --------- | ---------------------------------------------------- |
| INV-78    | SLSA provenance required at T3 (L2+ governance)      |
| INV-79    | Cosign sign-blob required for every release artifact |
| INV-31    | Suppressions must have mandatory expiry              |
| INV-13    | Dependencies scanned for known vulnerabilities       |

## See Also

- `docs/REFERENCE/ci-tier-workflows.md` — full CI tier workflow reference
- `docs/SYSTEM/CI-TIER-MODEL.md` — CI tier architecture specification
- `src/templates/github/workflows/05-release.yml.ejs` — release workflow template
- `src/templates/github/workflows/_sigstore-retry-sign.yml.ejs` — retry wrapper template
- `src/templates/github/actions/sign-and-attest/action.yml.ejs` — composite action template
