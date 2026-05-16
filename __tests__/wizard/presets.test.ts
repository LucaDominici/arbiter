// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { applyPreset } from '../../src/wizard/presets.js'
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
})
