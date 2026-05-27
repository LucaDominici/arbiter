import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGithub } from '../../src/generators/github.js'
import { makeConfig } from '../helpers.js'

// Phase A regression tests: nightly/weekly/monthly/heartbeat gating per ADR-050
// ADR-050 §54-58: nightly (T4), weekly (T5), monthly (T5b), and heartbeat (T6)
// are L3+ only. L1/L2 projects must not receive these workflows.

describe('generateGithub — heartbeat gated on L3+ (Phase A, ADR-050)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-collab-hb-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('L1: 09-heartbeat.yml NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '09-heartbeat.yml'))).toBe(false)
  })

  it('L2: 09-heartbeat.yml NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '09-heartbeat.yml'))).toBe(false)
  })

  it('L3: 09-heartbeat.yml emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '09-heartbeat.yml'))).toBe(true)
  })

  it('L4: 09-heartbeat.yml emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L4' }))
    expect(existsSync(join(dir, '.github', 'workflows', '09-heartbeat.yml'))).toBe(true)
  })
})

describe('generateGithub — nightly/weekly/monthly gated on L3+ (Phase A, ADR-050)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-collab-nightly-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('L1: 06-nightly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly.yml'))).toBe(false)
  })

  it('L2: 06-nightly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly.yml'))).toBe(false)
  })

  it('L1: 07-weekly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly.yml'))).toBe(false)
  })

  it('L2: 07-weekly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly.yml'))).toBe(false)
  })

  it('L1: 08-monthly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '08-monthly.yml'))).toBe(false)
  })

  it('L2: 08-monthly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '08-monthly.yml'))).toBe(false)
  })

  it('L3: 06-nightly emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly.yml'))).toBe(true)
  })

  it('L3: 07-weekly emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly.yml'))).toBe(true)
  })

  it('L3: 08-monthly emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '08-monthly.yml'))).toBe(true)
  })

  it('L4: 06-nightly emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L4' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly.yml'))).toBe(true)
  })
})
