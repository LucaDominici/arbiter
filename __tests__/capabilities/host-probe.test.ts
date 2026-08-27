// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach, vi } from 'vitest'

const mockedHomedir = vi.hoisted(() => vi.fn())
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: mockedHomedir,
}))

import { detectHostCapabilities } from '../../src/capabilities/host-probe.js'

describe('detectHostCapabilities (#703)', () => {
  const dirs: string[] = []

  afterEach(() => {
    vi.unstubAllEnvs()
    mockedHomedir.mockReset()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function tempHome(): string {
    const dir = mkdtempSync(join(tmpdir(), 'host-probe-home-'))
    dirs.push(dir)
    mockedHomedir.mockReturnValue(dir)
    return dir
  }

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

  it('returned object has the two required keys', () => {
    const caps = detectHostCapabilities()
    expect(Object.keys(caps)).toEqual(expect.arrayContaining(['modelSwitch', 'transcriptPath']))
  })

  it('CLAUDECODE=0 is treated as falsy (no model switch)', () => {
    vi.stubEnv('CLAUDECODE', '0')
    const caps = detectHostCapabilities()
    expect(caps.modelSwitch).toBe(false)
  })

  it('selects the JSONL transcript under the encoded current-project directory', () => {
    const home = tempHome()
    const encodedCwd = encodeURIComponent(process.cwd()).replace(/%2F/g, '-').replace(/^-/, '')
    const projectDir = join(home, '.claude', 'projects', encodedCwd)
    const transcript = join(projectDir, 'session.jsonl')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(transcript, '{"type":"user"}\n')

    expect(detectHostCapabilities().transcriptPath).toBe(transcript)
  })

  it('returns no transcript when the projects directory has no matching cwd entry', () => {
    const projectsDir = join(tempHome(), '.claude', 'projects', 'unrelated-project')
    mkdirSync(projectsDir, { recursive: true })
    writeFileSync(join(projectsDir, 'session.jsonl'), '{}\n')

    expect(detectHostCapabilities().transcriptPath).toBeNull()
  })
})
