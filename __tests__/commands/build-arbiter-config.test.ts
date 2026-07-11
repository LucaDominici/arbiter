// SPDX-License-Identifier: Apache-2.0
//
// #1887-A: enableMcpFallback and enableNoSkippedTests are pure round-trip-drop
// bugs. buildArbiterConfig never persisted them into arbiter.json's `features`
// block, so a fresh `arbiter init` honoured the recipe/CLI value for the FIRST
// generation only — the very next `arbiter update` re-resolved the flag as
// undefined and silently reverted the emitted files (config.toml.ejs's
// check-no-skipped-tests guard, claude.ts's 45-mcp-fallback.md rule) to their
// defaults. Mirrors the #1835 fiveLaneCi persistence-round-trip precedent.
import { describe, it, expect } from 'vitest'
import { buildArbiterConfig } from '../../src/commands/init/build-arbiter-config.js'
import { validateConfig } from '../../src/config/schema.js'
import { makeConfig } from '../helpers.js'

describe('buildArbiterConfig — enableMcpFallback / enableNoSkippedTests persistence (#1887-A)', () => {
  it('persists features.mcpFallback true when enableMcpFallback is true', () => {
    const on = buildArbiterConfig(makeConfig('/tmp/x', { enableMcpFallback: true }))
    const off = buildArbiterConfig(makeConfig('/tmp/x', { enableMcpFallback: false }))
    expect(on.features.mcpFallback).toBe(true)
    expect(off.features.mcpFallback).toBe(false)
  })

  it('defaults features.mcpFallback to false when the config field is absent', () => {
    const config = buildArbiterConfig(makeConfig('/tmp/x'))
    expect(config.features.mcpFallback).toBe(false)
  })

  it('persists features.noSkippedTests false when enableNoSkippedTests is explicitly false', () => {
    const off = buildArbiterConfig(makeConfig('/tmp/x', { enableNoSkippedTests: false }))
    const on = buildArbiterConfig(makeConfig('/tmp/x', { enableNoSkippedTests: true }))
    expect(off.features.noSkippedTests).toBe(false)
    expect(on.features.noSkippedTests).toBe(true)
  })

  it('defaults features.noSkippedTests to true when the config field is absent (opt-out flag)', () => {
    const config = buildArbiterConfig(makeConfig('/tmp/x'))
    expect(config.features.noSkippedTests).toBe(true)
  })

  it('round-trips: persisted mcpFallback/noSkippedTests validate ok', () => {
    const arbiterJson = buildArbiterConfig(
      makeConfig('/tmp/x', { enableMcpFallback: true, enableNoSkippedTests: false }),
    )
    const validated = validateConfig(JSON.parse(JSON.stringify(arbiterJson)))
    expect(validated.ok).toBe(true)
  })
})

// #1887-A: the compliance doc-pack flags are set ONLY by applyPreset
// ('industrial-grade' turns all 5 on) — there was NO persistence at all, so a
// preset-initialized project silently lost risk-register/compliance/operations
// docs on the very next `arbiter update`/`diff` (the registry re-resolves
// ProjectConfig from arbiter.json, where these fields never existed).
describe('buildArbiterConfig — compliance doc-pack flag persistence (#1887-A)', () => {
  const FLAGS = [
    ['enableRiskRegister', 'riskRegister'],
    ['enableOperationsHandbook', 'operationsHandbook'],
    ['enableIso27001Mapping', 'iso27001Mapping'],
    ['enableNis2Mapping', 'nis2Mapping'],
    ['enableGdprMapping', 'gdprMapping'],
  ] as const

  it.each(FLAGS)('persists features.%s from %s', (configField, featureKey) => {
    const on = buildArbiterConfig(makeConfig('/tmp/x', { [configField]: true }))
    const off = buildArbiterConfig(makeConfig('/tmp/x', { [configField]: false }))
    expect((on.features as Record<string, unknown>)[featureKey]).toBe(true)
    expect((off.features as Record<string, unknown>)[featureKey]).toBe(false)
  })

  it('defaults every compliance flag to false when absent', () => {
    const config = buildArbiterConfig(makeConfig('/tmp/x'))
    for (const [, featureKey] of FLAGS) {
      expect((config.features as Record<string, unknown>)[featureKey]).toBe(false)
    }
  })
})
