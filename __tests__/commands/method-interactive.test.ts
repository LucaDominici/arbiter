// SPDX-License-Identifier: Apache-2.0
// #2039: the cluster lens. Two contracts are worth more here than prompt-by-prompt coverage,
// because both are the kind of thing that decays silently in a later edit:
//
//   1. every write goes through `configure` — no second config engine;
//   2. cancelling writes NOTHING, and leaves no staging file behind.
//
// @clack/prompts is mocked so the flow is driven deterministically; runConfigure is mocked so
// "did we write, and with what" is an assertion rather than a filesystem diff.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const cancelSymbol = Symbol('clack-cancel')
const prompts: Array<() => unknown> = []

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  isCancel: (v: unknown) => v === cancelSymbol,
  select: vi.fn(() => Promise.resolve(prompts.shift()?.())),
  multiselect: vi.fn(() => Promise.resolve(prompts.shift()?.())),
  confirm: vi.fn(() => Promise.resolve(prompts.shift()?.())),
  text: vi.fn(() => Promise.resolve(prompts.shift()?.())),
}))

const runConfigure = vi.fn(() => Promise.resolve())
vi.mock('../../src/commands/configure.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/commands/configure.js')>()
  return { ...actual, runConfigure }
})

const { runInteractiveMethod } = await import('../../src/commands/method-interactive.js')

let dir: string
beforeEach(() => {
  prompts.length = 0
  runConfigure.mockClear()
  dir = mkdtempSync(join(tmpdir(), 'arbiter-method-int-'))
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify({
      version: '0.2',
      governanceLevel: 'L2',
      tools: ['claude'],
      permitGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: true,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
        perfTesting: false,
      },
      thresholds: {
        lineCoverage: 80,
        branchCoverage: 75,
        mutationScore: 60,
        cyclomaticComplexity: 15,
        methodLength: 65,
        maxParams: 5,
      },
    }),
  )
})
afterEach(() => {
  vi.clearAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

/** Nothing may be written to the project except through runConfigure, which is mocked out. */
function snapshot(): string {
  return JSON.stringify({
    entries: readdirSync(dir).sort(),
    config: readFileSync(join(dir, 'arbiter.json'), 'utf-8'),
  })
}

describe('runInteractiveMethod — writes only through configure', () => {
  it('turns a toggled feature into a configure --set assignment', async () => {
    prompts.push(
      () => 'testing', // cluster
      () => ['M-TEST-03'], // features: perf testing
      () => true, // features.perfTesting -> true
      () => true, // apply?
    )
    await runInteractiveMethod(dir)
    expect(runConfigure).toHaveBeenCalledTimes(1)
    expect(runConfigure).toHaveBeenCalledWith({
      dir,
      sets: ['features.perfTesting=true'],
    })
  })

  it('stages nothing for a value the user left unchanged', async () => {
    prompts.push(
      () => 'gates-cli',
      () => ['M-GATE-01'],
      () => true, // debtGates was already true
    )
    await runInteractiveMethod(dir)
    expect(runConfigure).not.toHaveBeenCalled()
  })
})

describe('runInteractiveMethod — cancel writes nothing, anywhere', () => {
  const cancelPoints: Array<[string, Array<() => unknown>]> = [
    ['at the cluster select', [() => cancelSymbol]],
    ['at the feature multiselect', [() => 'testing', () => cancelSymbol]],
    ['mid-feature', [() => 'testing', () => ['M-TEST-03'], () => cancelSymbol]],
    [
      'at the final confirm',
      [() => 'testing', () => ['M-TEST-03'], () => true, () => cancelSymbol],
    ],
    [
      'by answering no at the final confirm',
      [() => 'testing', () => ['M-TEST-03'], () => true, () => false],
    ],
  ]

  for (const [label, script] of cancelPoints) {
    it(`${label}: no configure call, no file touched, no staging file left behind`, async () => {
      const before = snapshot()
      prompts.push(...script)
      await runInteractiveMethod(dir)
      expect(runConfigure).not.toHaveBeenCalled()
      expect(snapshot()).toBe(before)
      // The "no hidden state" contract is literal: staging is in-process only.
      expect(readdirSync(dir)).not.toContain('.arbiter')
    })
  }
})

describe('the no-parallel-engine contract', () => {
  // A source assertion is the right instrument here: the contract is structural (which module
  // owns the write), and a behavioural test cannot prove the ABSENCE of a second write path.
  it('never imports saveConfig — configure owns the write', () => {
    const src = readFileSync(
      new URL('../../src/commands/method-interactive.ts', import.meta.url),
      'utf-8',
    )
    expect(src).not.toMatch(/\bsaveConfig\b\s*[,}]/)
    expect(src).toContain('runConfigure')
  })

  // "Staging is in-process only" is only true if these modules cannot write at all. Asserting
  // the absence of the specific filename would pass on any OTHER staging file; asserting the
  // absence of a write primitive is the real invariant.
  it('imports no write primitive at all — neither module can persist anything', () => {
    for (const file of ['method-interactive.ts', 'method.ts']) {
      const src = readFileSync(new URL(`../../src/commands/${file}`, import.meta.url), 'utf-8')
      const imports = [...src.matchAll(/^import[\s\S]*?from\s*'[^']+'/gm)].join('\n')
      expect(imports, file).not.toMatch(
        /\b(writeFile|writeFileTranslated|saveConfig|ensureDir|appendFileTranslated)\b/,
      )
    }
  })
})
