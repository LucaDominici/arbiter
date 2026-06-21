// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  runWorkList,
  runWorkCreate,
  runWorkShow,
  runWorkClose,
  runWorkAdvance,
} from '../../src/commands/work.js'

/**
 * Branch-coverage climb for src/commands/work.ts.
 *
 * The module imports loadConfig / getBackend / t directly — its real seam is a
 * filesystem fixture driving the markdown decomposition backend. We use a real
 * mkdtempSync temp dir (no network, no git, no gh, no spawn) and capture stdout
 * via a vi.spyOn on process.stdout.write so nothing leaks and no real CLI runs.
 *
 * Branches exercised:
 *  - resolveDir: explicit dir AND undefined dir (falls back to process.cwd()).
 *  - requireConfig: throwing branch (missing arbiter.json → E_CONFIG_NOT_FOUND).
 *  - runWorkList: empty (length===0) AND populated; status-filter present AND
 *    absent; per-unit phase present/absent; labels present/absent.
 *  - runWorkCreate: body present/absent; labels present/absent.
 *  - runWorkShow: not-found throw (E_WORK_NOT_FOUND); phase/parent/labels/body
 *    present AND all absent.
 *  - runWorkClose: reason present AND absent.
 *  - runWorkAdvance: happy path.
 */

const VALID_CONFIG = {
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

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-work-cov-'))
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(VALID_CONFIG, null, 2))
  return dir
}

/** Collect everything written to process.stdout.write into a single string. */
function captureStdout(): { spy: ReturnType<typeof vi.spyOn>; text: () => string } {
  const chunks: string[] = []
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
      return true
    })
  return { spy, text: (): string => chunks.join('') }
}

/** Read the single .md file id out of a freshly-seeded work dir. */
function firstUnitId(dir: string): string {
  const workDir = join(dir, '.arbiter', 'work')
  const file = readdirSync(workDir).find((f: string) => f.endsWith('.md'))
  expect(file).toBeDefined()
  const content = readFileSync(join(workDir, file as string), 'utf-8')
  const m = content.match(/^id:\s*(.+)$/m)
  expect(m).not.toBeNull()
  return (m as RegExpMatchArray)[1]!.trim()
}

describe('work.ts coverage climb', () => {
  let dir: string
  let cap: { spy: ReturnType<typeof vi.spyOn>; text: () => string }
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = makeProjectDir()
    cap = captureStdout()
    // Silence the markdown backend's malformed-unit warning channel too.
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((): boolean => true)
  })

  afterEach(() => {
    cap.spy.mockRestore()
    stderrSpy.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  // ----- requireConfig throwing branch -----------------------------------

  it('runWorkList throws E_CONFIG_NOT_FOUND when arbiter.json is missing', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'arbiter-work-nocfg-'))
    try {
      await expect(runWorkList({ dir: emptyDir })).rejects.toThrow(/arbiter\.json/i)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  // ----- runWorkList -----------------------------------------------------

  it('runWorkList prints the no-units message on an empty backend', async () => {
    await runWorkList({ dir })
    expect(cap.text()).toContain('No work units found')
  })

  it('runWorkList renders phase and labels segments when present', async () => {
    await runWorkCreate({ dir, title: 'With phase', labels: ['alpha', 'beta'] })
    await runWorkAdvance({ dir, id: firstUnitId(dir), phase: 'plan' })
    await runWorkList({ dir })
    const out = cap.text()
    expect(out).toContain('With phase')
    expect(out).toContain('[plan]')
    expect(out).toContain('alpha, beta')
  })

  it('runWorkList omits phase and labels segments when absent', async () => {
    await runWorkCreate({ dir, title: 'Bare unit' })
    await runWorkList({ dir })
    const out = cap.text()
    expect(out).toContain('Bare unit')
    expect(out).not.toContain('[plan]')
    expect(out).not.toContain('(')
  })

  it('runWorkList applies the status filter branch (match)', async () => {
    await runWorkCreate({ dir, title: 'Open one' })
    await runWorkList({ dir, status: 'open' })
    expect(cap.text()).toContain('Open one')
  })

  it('runWorkList applies the status filter branch (no match → empty)', async () => {
    await runWorkCreate({ dir, title: 'Open one' })
    await runWorkList({ dir, status: 'done' })
    expect(cap.text()).toContain('No work units found')
  })

  // ----- runWorkCreate ---------------------------------------------------

  it('runWorkCreate persists body and labels when provided', async () => {
    await runWorkCreate({
      dir,
      title: 'Rich unit',
      body: 'a detailed body',
      labels: ['x', 'y'],
    })
    const id = firstUnitId(dir)
    cap.spy.mockClear()
    await runWorkShow({ dir, id })
    const out = cap.text()
    expect(out).toContain('a detailed body')
    expect(out).toContain('x, y')
  })

  it('runWorkCreate works without body or labels', async () => {
    await runWorkCreate({ dir, title: 'Plain unit' })
    expect(cap.text()).toContain('Plain unit')
  })

  // ----- runWorkShow -----------------------------------------------------

  it('runWorkShow throws E_WORK_NOT_FOUND for an unknown id', async () => {
    await expect(runWorkShow({ dir, id: 'WU-9999-99-99-99' })).rejects.toThrow(/not found/i)
  })

  it('runWorkShow prints phase, parent, labels and body when all present', async () => {
    // Hand-author a unit file that exercises every optional show branch,
    // including parent which runWorkCreate never sets.
    const workDir = join(dir, '.arbiter', 'work')
    mkdirSync(workDir, { recursive: true })
    const id = 'WU-2026-06-21-1'
    const md = [
      '---',
      `id: ${id}`,
      'title: Full unit',
      'status: in_progress',
      'phase: green',
      'parent: WU-2026-06-21-0',
      'labels: red, blue',
      '---',
      '',
      'the body text',
      '',
    ].join('\n')
    writeFileSync(join(workDir, `${id}.md`), md)

    await runWorkShow({ dir, id })
    const out = cap.text()
    expect(out).toContain('Full unit')
    expect(out).toContain('green')
    expect(out).toContain('WU-2026-06-21-0')
    expect(out).toContain('red, blue')
    expect(out).toContain('the body text')
  })

  it('runWorkShow omits phase, parent, labels and body when absent', async () => {
    await runWorkCreate({ dir, title: 'Minimal unit' })
    const id = firstUnitId(dir)
    cap.spy.mockClear()
    await runWorkShow({ dir, id })
    const out = cap.text()
    expect(out).toContain('Minimal unit')
    expect(out).not.toContain('phase:')
    expect(out).not.toContain('parent:')
    expect(out).not.toContain('labels:')
  })

  // ----- runWorkClose ----------------------------------------------------

  it('runWorkClose closes with a reason (reason branch taken)', async () => {
    await runWorkCreate({ dir, title: 'Close with reason' })
    const id = firstUnitId(dir)
    cap.spy.mockClear()
    await runWorkClose({ dir, id, reason: 'superseded' })
    expect(cap.text()).toContain(id)

    cap.spy.mockClear()
    await runWorkShow({ dir, id })
    expect(cap.text()).toContain('superseded')
  })

  it('runWorkClose closes without a reason (reason branch skipped)', async () => {
    await runWorkCreate({ dir, title: 'Close no reason' })
    const id = firstUnitId(dir)
    cap.spy.mockClear()
    await runWorkClose({ dir, id })
    const out = cap.text()
    expect(out).toContain(id)
  })

  // ----- runWorkAdvance --------------------------------------------------

  it('runWorkAdvance advances and persists the phase', async () => {
    await runWorkCreate({ dir, title: 'Advance me' })
    const id = firstUnitId(dir)
    cap.spy.mockClear()
    await runWorkAdvance({ dir, id, phase: 'verification' })
    expect(cap.text()).toContain(id)

    cap.spy.mockClear()
    await runWorkShow({ dir, id })
    expect(cap.text()).toContain('verification')
  })

  // ----- resolveDir: undefined dir → process.cwd() -----------------------

  it('resolveDir falls back to process.cwd() when dir is undefined', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
    try {
      await runWorkCreate({ title: 'cwd-based unit' })
      expect(cap.text()).toContain('cwd-based unit')
      // The unit must have landed under the spoofed cwd, proving the
      // dir ?? process.cwd() fallback branch executed.
      const workDir = join(dir, '.arbiter', 'work')
      expect(readdirSync(workDir).some((f: string) => f.endsWith('.md'))).toBe(true)
    } finally {
      cwdSpy.mockRestore()
    }
  })
})
