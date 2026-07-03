// SPDX-License-Identifier: Apache-2.0
// #1678: the L3 maturity gate must be driven by the ACTUAL emission plan (the enabled
// registry specs), not a hard-coded 2-feature list. These tests exercise the pure
// derivation (deriveL3MaturityChecks) against the REAL registry + REAL matrix — no mocks
// — so a still-ungated emitted cell is now consulted, and an unmodeled language×dim is
// NOT falsely blocked (the #1606 pattern, generalised).
import { describe, it, expect } from 'vitest'
import {
  deriveL3MaturityChecks,
  deriveWorkflowCapabilities,
  type L3MaturityCapability,
} from '../../src/commands/init.js'
import { buildRegistry } from '../../src/generators/registry.js'
import { isL3Allowed } from '../../src/utils/maturity-check.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

function checksFor(overrides: Partial<ProjectConfig>): L3MaturityCapability[] {
  const config = makeConfig('/tmp/maturity-emission', {
    governanceLevel: 'L3',
    enableMutationTesting: true,
    enableContractTesting: true,
    ...overrides,
  })
  return deriveL3MaturityChecks(config, buildRegistry(config))
}

function blockedFeatures(checks: L3MaturityCapability[]): string[] {
  return checks
    .filter((c) => !isL3Allowed(c.language, c.feature, false).allowed)
    .map((c) => c.feature)
}

describe('deriveL3MaturityChecks — emission-plan-driven L3 gate (#1678)', () => {
  it('consults bdd for a go service — a still-ungated beta cell the old list missed', () => {
    // behavioral-tests (always-on) emits godog for go; matrix bdd:go=beta. The old
    // hard-coded gate only checked mutation/contract/a11y, so bdd:go slipped through.
    const checks = checksFor({ language: 'go', archetype: 'backend-web-db' })
    expect(checks).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({ feature: 'bdd', language: 'go' }),
    )
    expect(blockedFeatures(checks)).toContain('bdd')
  })

  it('blocks a kotlin service on its beta cells (security/coverage/architecture/static_analysis)', () => {
    // Every emitted kotlin tool is beta in the matrix; the gate must surface them.
    const checks = checksFor({
      language: 'kotlin',
      archetype: 'backend-web-db',
      basePackage: 'com.example',
    })
    const blocked = blockedFeatures(checks)
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked).toEqual(expect.arrayContaining(['security', 'coverage', 'static_analysis']))
  })

  it('does NOT block a typescript service — every emitted TS tool is proven', () => {
    const checks = checksFor({
      language: 'typescript',
      archetype: 'backend-web-db',
      hasDatabase: true,
      hasPublicApi: true,
    })
    expect(checks.length).toBeGreaterThan(0)
    expect(blockedFeatures(checks)).toEqual([])
  })

  // #1606: a polyglot `multi` frontend ships the proven TS axe/Playwright binding. a11y
  // must resolve to typescript (proven) — NOT the unmodeled 'multi' cell that would block.
  it('resolves a11y to typescript for a multi frontend and never gates the unmodeled multi cells (#1606)', () => {
    const checks = checksFor({ language: 'multi', archetype: 'frontend-spa' })
    expect(checks).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({
        feature: 'a11y',
        language: 'typescript',
      }),
    )
    // No check resolves to the polyglot 'multi' pseudo-language (matrix has no cells).
    expect(checks.every((c) => c.language !== 'multi')).toBe(true)
    // And the multi frontend is therefore not falsely blocked.
    expect(blockedFeatures(checks)).toEqual([])
  })

  it('preserves the #1628 reproduction: a python frontend a11y harness is gated', () => {
    const checks = checksFor({ language: 'python', archetype: 'frontend-spa' })
    expect(checks).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({
        feature: 'a11y',
        language: 'python',
      }),
    )
    expect(blockedFeatures(checks)).toContain('a11y')
  })
})

// #1678: the L3 gate must also consult the WORKFLOW-template-emitted dims (the single
// 'github' registry key emits CI workflows for fuzz/dast/sbom/etc., which are beta for
// every modelled language). deriveWorkflowCapabilities mirrors the github.ts emission
// predicates; the 'github' spec routes them through the registry loop (gated by spec.enabled
// = useGitHub, so no false-block when github is disabled).
describe('deriveL3MaturityChecks — workflow-template dims (#1678)', () => {
  // ts service, standard, peer-review, security on, no deploy, github on.
  const tsSvc = (overrides: Partial<ProjectConfig> = {}) =>
    checksFor({
      language: 'typescript',
      archetype: 'backend-web-db',
      useGitHub: true,
      pipelineStyle: 'standard',
      collaborationMode: 'peer-review',
      enableSecurityScanning: true,
      ...overrides,
    })

  it('gates secret_scan for a typescript service (gitleaks is beta) and unblocks with the flag', () => {
    const checks = tsSvc()
    expect(checks).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({
        feature: 'secret_scan',
        language: 'typescript',
      }),
    )
    expect(blockedFeatures(checks)).toContain('secret_scan')
    // --accept-beta-tools unblocks it.
    const all = checks.every((c) => isL3Allowed(c.language, c.feature, true).allowed)
    expect(all).toBe(true)
  })

  it('does NOT gate secret_scan when security scanning is off AND style is starter AND peer-review (no false-block)', () => {
    const checks = tsSvc({ pipelineStyle: 'starter', enableSecurityScanning: false })
    expect(checks.map((c) => c.feature)).not.toContain('secret_scan')
  })

  it('gates license_scan for a typescript service (beta) — always-emitted by 02-pr-extended', () => {
    const checks = tsSvc()
    expect(checks).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({
        feature: 'license_scan',
        language: 'typescript',
      }),
    )
    expect(blockedFeatures(checks)).toContain('license_scan')
  })

  it('gates container_scan for a service (Trivy is service-guarded in 02)', () => {
    const checks = tsSvc()
    expect(checks).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({
        feature: 'container_scan',
        language: 'typescript',
      }),
    )
  })

  it('does NOT gate container_scan for a non-service lib with no deploy (no false-block)', () => {
    const checks = tsSvc({ archetype: 'library', deployTarget: undefined })
    expect(checks.map((c) => c.feature)).not.toContain('container_scan')
  })

  it('gates container_scan for a non-service lib WITH deploy (04-deploy-test Trivy)', () => {
    const checks = tsSvc({ archetype: 'library', deployTarget: 'gcp-cloud-run' })
    expect(checks).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({
        feature: 'container_scan',
        language: 'typescript',
      }),
    )
  })

  it('gates sbom + binary_signing for standard L3 (05-release) and for deploy', () => {
    const checks = tsSvc()
    expect(blockedFeatures(checks)).toEqual(expect.arrayContaining(['sbom', 'binary_signing']))
  })

  it('does NOT gate sbom/binary_signing for starter L3 with no deploy (05 skipped)', () => {
    const checks = tsSvc({ pipelineStyle: 'starter', deployTarget: undefined })
    const feats = checks.map((c) => c.feature)
    expect(feats).not.toContain('sbom')
    expect(feats).not.toContain('binary_signing')
  })

  it('gates provenance for standard L3 (05-release slsa-provenance) but NOT for starter+deploy (04/10 emit SBOM attestation, not provenance)', () => {
    const checks = tsSvc()
    expect(blockedFeatures(checks)).toContain('provenance')
    const starterDeploy = tsSvc({ pipelineStyle: 'starter', deployTarget: 'gcp-cloud-run' })
    expect(starterDeploy.map((c) => c.feature)).not.toContain('provenance')
  })

  it('gates fuzz for standard non-trunk-solo L3 (_nightly) but NOT for trunk-solo or starter', () => {
    const checks = tsSvc()
    expect(blockedFeatures(checks)).toContain('fuzz')
    expect(tsSvc({ collaborationMode: 'trunk-solo' }).map((c) => c.feature)).not.toContain('fuzz')
    expect(tsSvc({ pipelineStyle: 'starter' }).map((c) => c.feature)).not.toContain('fuzz')
  })

  it('gates dast for a service (scheduled _shared-security) AND for non-service+deploy (04 dast-baseline)', () => {
    const checks = tsSvc()
    expect(blockedFeatures(checks)).toContain('dast')
    const libDeploy = tsSvc({ archetype: 'library', deployTarget: 'gcp-cloud-run' })
    expect(libDeploy.map((c) => c.feature)).toContain('dast')
  })

  it('does NOT gate dast for a non-service lib with no deploy (no false-block)', () => {
    const checks = tsSvc({ archetype: 'library', deployTarget: undefined })
    expect(checks.map((c) => c.feature)).not.toContain('dast')
  })

  it('does NOT gate any workflow dim when useGitHub is false (no false-block on un-emitted workflows)', () => {
    const checks = tsSvc({ useGitHub: false })
    const wfDims = [
      'secret_scan',
      'license_scan',
      'container_scan',
      'sbom',
      'binary_signing',
      'provenance',
      'fuzz',
      'dast',
    ]
    expect(checks.map((c) => c.feature).filter((f) => wfDims.includes(f))).toEqual([])
  })

  it('a typescript service at L3 now blocks on the beta workflow dims (previously passed) — unblocked by --accept-beta-tools', () => {
    // The existing "does NOT block a typescript service" assumption is superseded: the
    // workflow dims are beta for TS, so a standard L3 service blocks on them without the flag.
    const checks = tsSvc()
    expect(blockedFeatures(checks).length).toBeGreaterThan(0)
    const all = checks.every((c) => isL3Allowed(c.language, c.feature, true).allowed)
    expect(all).toBe(true)
  })
})

// #1725: `hasMatrixCell(multi, dim)` has no explicit cell for the unmodeled 'multi'
// pseudo-language, so `deriveWorkflowCapabilities` — which previously used the raw
// `config.language` unresolved — produced capabilities that `deriveL3MaturityChecks`
// silently skipped for ALL 8 workflow dims on a polyglot repo (false-pass, no gating).
// Fix: resolve 'multi' to its modelled constituent languages (typescript + java),
// mirroring the established `probe.ts` `matrixEntriesFor`/`buildProbesFor` 'multi' =
// union(typescript, java) precedent, so a polyglot service is gated on both toolchains'
// workflow-emitted dims instead of silently skipping the language dimension entirely.
describe('deriveWorkflowCapabilities — multi polyglot resolves to constituent languages (#1725)', () => {
  const multiSvc = (overrides: Partial<ProjectConfig> = {}) =>
    deriveWorkflowCapabilities(
      makeConfig('/tmp/maturity-emission-multi', {
        governanceLevel: 'L3',
        language: 'multi',
        archetype: 'backend-web-db',
        useGitHub: true,
        pipelineStyle: 'standard',
        collaborationMode: 'peer-review',
        enableSecurityScanning: true,
        ...overrides,
      }),
    )

  it('never resolves a workflow capability to the unmodeled multi pseudo-language', () => {
    const caps = multiSvc()
    expect(caps.length).toBeGreaterThan(0)
    expect(caps.every((c) => c.language !== 'multi')).toBe(true)
  })

  it('resolves license_scan (always-emitted) to BOTH typescript and java', () => {
    const caps = multiSvc()
    expect(caps).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({
        feature: 'license_scan',
        language: 'typescript',
      }),
    )
    expect(caps).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({
        feature: 'license_scan',
        language: 'java',
      }),
    )
  })

  it('gates every resolved multi-constituent capability through the full L3 pipeline (deriveL3MaturityChecks)', () => {
    const checks = checksFor({
      language: 'multi',
      archetype: 'backend-web-db',
      useGitHub: true,
      pipelineStyle: 'standard',
      collaborationMode: 'peer-review',
      enableSecurityScanning: true,
    })
    const workflowChecks = checks.filter((c) =>
      ['license_scan', 'secret_scan', 'container_scan', 'sbom', 'binary_signing', 'provenance', 'fuzz', 'dast'].includes(
        c.feature,
      ),
    )
    // Previously ZERO — hasMatrixCell('multi', dim) had no cell, so every workflow dim
    // was silently skipped for a polyglot repo (false-pass, no gating).
    expect(workflowChecks.length).toBeGreaterThan(0)
    expect(blockedFeatures(workflowChecks).length).toBeGreaterThan(0)
  })
})
