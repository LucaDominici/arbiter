import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { jsonOutput, statusToExitCode } from '../../src/utils/json-output.js'

describe('jsonOutput', () => {
  let written: string

  beforeEach(() => {
    written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits correct envelope shape for ok status', () => {
    jsonOutput('configure', 'ok', { updated: ['foo=bar'] })
    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed).toMatchObject({
      command: 'configure',
      version: '1',
      status: 'ok',
      data: { updated: ['foo=bar'] },
    })
    expect(parsed).not.toHaveProperty('errors')
  })

  it('includes errors array when provided and non-empty', () => {
    jsonOutput('update', 'error', {}, ['something went wrong'])
    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.errors).toEqual(['something went wrong'])
  })

  it('omits errors key when errors array is empty', () => {
    jsonOutput('diff', 'warning', { hasChanges: true }, [])
    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('errors')
  })

  it('emits warning status correctly', () => {
    jsonOutput('diff', 'warning', { hasChanges: true, files: [] })
    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('warning')
  })
})

describe('statusToExitCode (canonical convention: 0=ok, 1=warning, 2=error)', () => {
  it('maps ok → 0', () => {
    expect(statusToExitCode('ok')).toBe(0)
  })

  it('maps warning → 1 (CI advisory, should pass)', () => {
    expect(statusToExitCode('warning')).toBe(1)
  })

  it('maps error → 2 (CI blocker, must fail)', () => {
    expect(statusToExitCode('error')).toBe(2)
  })
})
