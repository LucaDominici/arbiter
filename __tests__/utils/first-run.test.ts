import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { showTelemetryBannerIfFirstRun } from '../../src/utils/first-run.js'

describe('showTelemetryBannerIfFirstRun', () => {
  let homeDir: string
  const markerFile = '.arbiter/first-run-seen'

  beforeEach(() => {
    homeDir = join(tmpdir(), `arbiter-first-run-${Math.random().toString(36).slice(2)}`)
    mkdirSync(homeDir, { recursive: true })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('prints banner on first run', () => {
    showTelemetryBannerIfFirstRun(homeDir, false)
    expect(process.stderr.write).toHaveBeenCalled()
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0])
      .join('')
    expect(output).toContain('ZERO telemetry')
    expect(output).toContain('PRIVACY.md')
  })

  it('creates marker file on first run', () => {
    showTelemetryBannerIfFirstRun(homeDir, false)
    expect(existsSync(join(homeDir, markerFile))).toBe(true)
  })

  it('does not print banner on subsequent runs', () => {
    showTelemetryBannerIfFirstRun(homeDir, false)
    vi.clearAllMocks()
    showTelemetryBannerIfFirstRun(homeDir, false)
    expect(process.stderr.write).not.toHaveBeenCalled()
  })

  it('suppresses banner when quiet=true', () => {
    showTelemetryBannerIfFirstRun(homeDir, true)
    expect(process.stderr.write).not.toHaveBeenCalled()
  })

  it('still creates marker when quiet=true (so banner is suppressed on next non-quiet run too)', () => {
    showTelemetryBannerIfFirstRun(homeDir, true)
    vi.clearAllMocks()
    showTelemetryBannerIfFirstRun(homeDir, false)
    expect(process.stderr.write).not.toHaveBeenCalled()
  })
})
