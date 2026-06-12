// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { applyPreset, resolvePresetOption } from '../../src/wizard/presets.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

function baseConfig(): ProjectConfig {
  return {
    targetDir: '/tmp/test',
    projectName: 'test-project',
    description: 'test',
    language: 'typescript',
    framework: null,
    archetype: 'backend-web-db',
    architectureStyle: 'none',
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
    buildTool: 'npm',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npm run format',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    githubOwner: null,
    githubRepo: null,
    existing: {
      agentsMd: false,
      claudeDir: false,
      agentsDir: false,
      aiRulez: false,
      settingsJson: false,
      checkAllScript: false,
      geminiDir: false,
      windsurfRules: false,
      aiderConf: false,
    },
    languageHooks: [],
    enableDebtGates: true,
    enableSuppressions: true,
    enableSecurityScanning: true,
    invariantTiers: ['architectural', 'governance'],
    contractType: 'none',
    lanes: [],
  }
}

describe('applyPreset', () => {
  it('is a no-op for preset "none"', () => {
    const config = baseConfig()
    const before = JSON.stringify(config)
    applyPreset('none', config)
    expect(JSON.stringify(config)).toBe(before)
  })

  describe('industrial-grade', () => {
    it('enables ISO 27001 mapping', () => {
      const config = baseConfig()
      applyPreset('industrial-grade', config)
      expect(config.enableIso27001Mapping).toBe(true)
    })

    it('enables NIS2 mapping', () => {
      const config = baseConfig()
      applyPreset('industrial-grade', config)
      expect(config.enableNis2Mapping).toBe(true)
    })

    it('enables GDPR mapping', () => {
      const config = baseConfig()
      applyPreset('industrial-grade', config)
      expect(config.enableGdprMapping).toBe(true)
    })

    it('enables risk register', () => {
      const config = baseConfig()
      applyPreset('industrial-grade', config)
      expect(config.enableRiskRegister).toBe(true)
    })

    it('enables evidence harness', () => {
      const config = baseConfig()
      applyPreset('industrial-grade', config)
      expect(config.enableEvidenceHarness).toBe(true)
    })

    it('enables operations handbook', () => {
      const config = baseConfig()
      applyPreset('industrial-grade', config)
      expect(config.enableOperationsHandbook).toBe(true)
    })

    it('enables MCP fallback', () => {
      const config = baseConfig()
      applyPreset('industrial-grade', config)
      expect(config.enableMcpFallback).toBe(true)
    })

    it('sets auth config with tenantIsolation, provider none', () => {
      const config = baseConfig()
      applyPreset('industrial-grade', config)
      expect(config.auth).toEqual({ provider: 'none', tenantIsolation: true })
    })

    it('sets observability config with metrics+logs+alerts, provider none', () => {
      const config = baseConfig()
      applyPreset('industrial-grade', config)
      expect(config.observability).toEqual({
        provider: 'none',
        metrics: true,
        logs: true,
        traces: false,
        alerts: true,
      })
    })

    it('does not overwrite auth provider when already set', () => {
      const config = baseConfig()
      config.auth = { provider: 'keycloak' }
      applyPreset('industrial-grade', config)
      expect(config.auth.provider).toBe('keycloak')
      expect(config.auth.tenantIsolation).toBe(true)
    })

    it('does not overwrite observability provider when already set', () => {
      const config = baseConfig()
      config.observability = { provider: 'prom-grafana-loki-jaeger' }
      applyPreset('industrial-grade', config)
      expect(config.observability.provider).toBe('prom-grafana-loki-jaeger')
      expect(config.observability.metrics).toBe(true)
    })

    it('stores preset name on config', () => {
      const config = baseConfig()
      applyPreset('industrial-grade', config)
      expect(config.preset).toBe('industrial-grade')
    })
  })

  describe('solo-homelab', () => {
    it('stores preset name on config', () => {
      const config = baseConfig()
      applyPreset('solo-homelab', config)
      expect(config.preset).toBe('solo-homelab')
    })

    it('turns the compliance pack OFF (iso27001/gdpr/nis2/risk register)', () => {
      const config = baseConfig()
      config.enableIso27001Mapping = true
      config.enableGdprMapping = true
      config.enableNis2Mapping = true
      config.enableRiskRegister = true
      applyPreset('solo-homelab', config)
      expect(config.enableIso27001Mapping).toBe(false)
      expect(config.enableGdprMapping).toBe(false)
      expect(config.enableNis2Mapping).toBe(false)
      expect(config.enableRiskRegister).toBe(false)
    })

    it('disables the industry overlay (sox/pharma/gdpr STRIDE/RACI)', () => {
      const config = baseConfig()
      config.industryOverlay = 'iso27001'
      applyPreset('solo-homelab', config)
      expect(config.industryOverlay).toBe('none')
    })

    it('disables mutation testing', () => {
      const config = baseConfig()
      config.enableMutationTesting = true
      applyPreset('solo-homelab', config)
      expect(config.enableMutationTesting).toBe(false)
    })

    it('disables the operations handbook (no prod runbooks)', () => {
      const config = baseConfig()
      config.enableOperationsHandbook = true
      applyPreset('solo-homelab', config)
      expect(config.enableOperationsHandbook).toBe(false)
    })

    it('disables the evidence harness', () => {
      const config = baseConfig()
      config.enableEvidenceHarness = true
      applyPreset('solo-homelab', config)
      expect(config.enableEvidenceHarness).toBe(false)
    })

    it('clamps governance above L2 down to L2', () => {
      const config = baseConfig()
      config.governanceLevel = 'L4'
      applyPreset('solo-homelab', config)
      expect(config.governanceLevel).toBe('L2')
    })

    it('leaves governance at or below L2 unchanged', () => {
      const config = baseConfig()
      config.governanceLevel = 'L1'
      applyPreset('solo-homelab', config)
      expect(config.governanceLevel).toBe('L1')
    })

    it('is selectable non-interactively via --preset solo-homelab (full flag flow)', () => {
      // The CLI accepts the raw --preset string; resolvePresetOption is the
      // validation gate that lets `solo-homelab` reach runInit → applyPreset.
      expect(resolvePresetOption('solo-homelab')).toBe('solo-homelab')
      const config = baseConfig()
      config.governanceLevel = 'L4'
      applyPreset(resolvePresetOption('solo-homelab') ?? 'none', config)
      expect(config.preset).toBe('solo-homelab')
      expect(config.governanceLevel).toBe('L2')
      expect(config.enableMutationTesting).toBe(false)
    })
  })

  describe('resolvePresetOption', () => {
    it('accepts industrial-grade', () => {
      expect(resolvePresetOption('industrial-grade')).toBe('industrial-grade')
    })

    it('accepts solo-homelab', () => {
      expect(resolvePresetOption('solo-homelab')).toBe('solo-homelab')
    })

    it('returns undefined for an unknown preset string', () => {
      expect(resolvePresetOption('bogus')).toBeUndefined()
    })

    it('returns undefined for undefined input', () => {
      expect(resolvePresetOption(undefined)).toBeUndefined()
    })
  })
})
