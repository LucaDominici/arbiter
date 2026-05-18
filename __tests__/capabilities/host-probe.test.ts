// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach, vi } from 'vitest'
import { detectHostCapabilities } from '../../src/capabilities/host-probe.js'

describe('detectHostCapabilities (#703)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns modelSwitch=true when CLAUDECODE env is set', () => {
    vi.stubEnv('CLAUDECODE', '1')
    const caps = detectHostCapabilities()
    expect(caps.modelSwitch).toBe(true)
  })

  it('returns modelSwitch=false when CLAUDECODE is absent', () => {
    vi.stubEnv('CLAUDECODE', '')
    const caps = detectHostCapabilities()
    expect(caps.modelSwitch).toBe(false)
  })

  it('returns transcriptPath as string or null — never throws', () => {
    const caps = detectHostCapabilities()
    expect(caps.transcriptPath === null || typeof caps.transcriptPath === 'string').toBe(true)
  })

  it('exitPlanModeTool is a boolean', () => {
    const caps = detectHostCapabilities()
    expect(typeof caps.exitPlanModeTool).toBe('boolean')
  })

  it('never throws even when all capability env vars are absent', () => {
    vi.stubEnv('CLAUDECODE', '')
    vi.stubEnv('ANTHROPIC_MODEL', '')
    expect(() => detectHostCapabilities()).not.toThrow()
  })

  it('returns false modelSwitch in CI (non-Claude-Code) environment', () => {
    vi.stubEnv('CLAUDECODE', '')
    vi.stubEnv('CI', 'true')
    const caps = detectHostCapabilities()
    expect(caps.modelSwitch).toBe(false)
  })

  it('returned object has the three required keys', () => {
    const caps = detectHostCapabilities()
    expect(Object.keys(caps)).toEqual(
      expect.arrayContaining(['modelSwitch', 'transcriptPath', 'exitPlanModeTool']),
    )
  })

  it('CLAUDECODE=0 is treated as falsy (no model switch)', () => {
    vi.stubEnv('CLAUDECODE', '0')
    const caps = detectHostCapabilities()
    expect(caps.modelSwitch).toBe(false)
  })
})
