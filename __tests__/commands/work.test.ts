import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  runWorkList,
  runWorkCreate,
  runWorkShow,
  runWorkClose,
  runWorkAdvance,
} from '../../src/commands/work.js'

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-work-cmd-'))
  const config = {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    decomposition: { backend: 'markdown' },
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: true,
    },
    thresholds: {
      lineCoverage: 80,
      branchCoverage: 70,
      mutationScore: 80,
      cyclomaticComplexity: 15,
      methodLength: 65,
      maxParams: 7,
    },
  }
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config, null, 2))
  return dir
}

describe('runWorkList', () => {
  let dir: string
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

  beforeEach(() => {
    dir = makeProjectDir()
    consoleSpy.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("prints 'No work units found' when empty", async () => {
    await runWorkList({ dir })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No work units found'))
  })

  it('lists created units', async () => {
    await runWorkCreate({ dir, title: 'Test task' })
    consoleSpy.mockClear()
    await runWorkList({ dir })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test task'))
  })
})

describe('runWorkCreate', () => {
  let dir: string
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

  beforeEach(() => {
    dir = makeProjectDir()
    consoleSpy.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates a work unit file in .arbiter/work/', async () => {
    await runWorkCreate({ dir, title: 'My first unit' })
    expect(existsSync(join(dir, '.arbiter', 'work'))).toBe(true)
  })

  it('prints the created unit id', async () => {
    await runWorkCreate({ dir, title: 'Printed unit' })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('WU-'))
  })

  it('throws if arbiter.json is missing', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'arbiter-work-no-cfg-'))
    try {
      await expect(runWorkCreate({ dir: emptyDir, title: 'Fail' })).rejects.toThrow(
        /arbiter\.json/i,
      )
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })
})

describe('runWorkShow', () => {
  let dir: string
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

  beforeEach(() => {
    dir = makeProjectDir()
    consoleSpy.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('shows unit details', async () => {
    await runWorkCreate({ dir, title: 'Show me' })
    consoleSpy.mockClear()

    const workDir = join(dir, '.arbiter', 'work')
    const { readdirSync } = await import('node:fs')
    const file = readdirSync(workDir)[0]
    const id = file!
      .replace(/\.md$/, '')
      .replace(/_/g, '-')
      .replace(/WU-(\d{4})-(\d{2})-(\d{2})-(\d+)/, 'WU-$1-$2-$3-$4')

    const allFiles = readdirSync(workDir)
    expect(allFiles.length).toBe(1)

    await runWorkShow({ dir, id: id.replace(/_/g, '-') })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Show me'))
  })
})

describe('runWorkClose', () => {
  let dir: string
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

  beforeEach(() => {
    dir = makeProjectDir()
    consoleSpy.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('closes a work unit', async () => {
    await runWorkCreate({ dir, title: 'Close test' })
    consoleSpy.mockClear()

    const workDir = join(dir, '.arbiter', 'work')
    const { readdirSync, readFileSync } = await import('node:fs')
    const file = readdirSync(workDir)[0]!
    const content = readFileSync(join(workDir, file), 'utf-8')
    const idMatch = content.match(/^id:\s*(.+)$/m)
    const id = idMatch![1]!.trim()

    await runWorkClose({ dir, id })
    consoleSpy.mockClear()

    await runWorkList({ dir })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('done'))
  })
})

describe('runWorkAdvance', () => {
  let dir: string
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

  beforeEach(() => {
    dir = makeProjectDir()
    consoleSpy.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('advances a work unit phase and persists it', async () => {
    await runWorkCreate({ dir, title: 'Advance test' })

    const workDir = join(dir, '.arbiter', 'work')
    const { readdirSync, readFileSync } = await import('node:fs')
    const file = readdirSync(workDir)[0]!
    const content = readFileSync(join(workDir, file), 'utf-8')
    const idMatch = content.match(/^id:\s*(.+)$/m)
    const id = idMatch![1]!.trim()

    await runWorkAdvance({ dir, id, phase: 'plan' })

    await runWorkShow({ dir, id })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('plan'))
  })
})
