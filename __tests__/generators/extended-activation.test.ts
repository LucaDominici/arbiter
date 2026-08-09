// SPDX-License-Identifier: Apache-2.0
// #2044 — extended-set activation + live-SSOT drift binding. RED tests:
// REUSE_REGISTRY.md register emission (the spec exists, the register doesn't),
// the mechanical reuse-registry check, the live-SSOT commit-binding mode of
// check-drift, and the governance.liveSsot schema surface.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGoldKit } from '../../src/generators/gold-kit.js'
import { generateSsot } from '../../src/generators/ssot.js'
import { validateConfig, DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import { renderTemplate } from '../../src/utils/render.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
  generateGoldKit(makeConfig(dir))
})

afterEach(() => {
  cleanupTestProject(dir)
})

function renderScript(tpl: string): string {
  return renderTemplate(
    tpl,
    makeConfig('/tmp/render', {
      projectName: 'test-project',
      includeExtendedInvariants: true,
    }) as unknown as Record<string, unknown>,
  )
}

function runScript(
  scriptBody: string,
  cwd: string,
): { status: number; stdout: string; stderr: string } {
  const scriptDir = mkdtempSync(join(tmpdir(), 'extended-gate-'))
  try {
    writeFileSync(join(scriptDir, 'gate.mjs'), scriptBody, 'utf-8')
    const r = spawnSync('node', [join(scriptDir, 'gate.mjs')], { cwd, encoding: 'utf-8' })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } finally {
    rmSync(scriptDir, { recursive: true, force: true })
  }
}

describe('extended-set activation (#2044)', () => {
  it('AC-2044.1: generateSsot emits the REUSE_REGISTRY.md register at L2+', () => {
    const results = generateSsot(makeConfig(dir, { governanceLevel: 'L2' }))
    const register = join(dir, 'docs', 'METHOD', 'REUSE_REGISTRY.md')
    expect(existsSync(register)).toBe(true)
    const content = readFileSync(register, 'utf-8')
    expect(content).toMatch(/Module|Percorso|Path/i)
    expect(results.files.some((f) => f.path.endsWith('REUSE_REGISTRY.md'))).toBe(true)
  })

  it('AC-2044.3: reuse-registry check fails when the register is missing or empty (extended active)', () => {
    const script = renderScript('scripts/check-reuse-registry.mjs.ejs')
    const fixture = mkdtempSync(join(tmpdir(), 'reuse-missing-'))
    try {
      const result = runScript(script, fixture)
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/REUSE_REGISTRY/i)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }

    const empty = mkdtempSync(join(tmpdir(), 'reuse-empty-'))
    try {
      mkdirSync(join(empty, 'docs', 'METHOD'), { recursive: true })
      writeFileSync(
        join(empty, 'docs', 'METHOD', 'REUSE_REGISTRY.md'),
        '# REUSE_REGISTRY\n',
        'utf-8',
      )
      const result = runScript(script, empty)
      expect(result.status).toBe(1)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('AC-2044.3: reuse-registry check passes with at least one registered entry', () => {
    const script = renderScript('scripts/check-reuse-registry.mjs.ejs')
    const fixture = mkdtempSync(join(tmpdir(), 'reuse-ok-'))
    try {
      mkdirSync(join(fixture, 'docs', 'METHOD'), { recursive: true })
      writeFileSync(
        join(fixture, 'docs', 'METHOD', 'REUSE_REGISTRY.md'),
        '# REUSE_REGISTRY\n\n| Module | Percorso | Note |\n| --- | --- | --- |\n| date-utils | src/lib/date-utils.ts | parsata da 3 PR |\n',
        'utf-8',
      )
      const result = runScript(script, fixture)
      expect(result.status).toBe(0)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('AC-2044.5: check-drift live-SSOT mode fails a code-only commit naming the surfaces', () => {
    const script = renderScript('scripts/check-drift.mjs.ejs')
    const fixture = mkdtempSync(join(tmpdir(), 'live-ssot-'))
    try {
      const run = (c: string): { status: number; stderr: string } => {
        const r = spawnSync('git', ['-C', c, 'init', '-q', '-b', 'main'], { encoding: 'utf-8' })
        return { status: r.status ?? 1, stderr: r.stderr ?? '' }
      }
      run(fixture)
      spawnSync('git', ['-C', fixture, 'config', 'user.email', 't@t'], { encoding: 'utf-8' })
      spawnSync('git', ['-C', fixture, 'config', 'user.name', 't'], { encoding: 'utf-8' })
      mkdirSync(join(fixture, '.arbiter'), { recursive: true })
      mkdirSync(join(fixture, 'src'), { recursive: true })
      mkdirSync(join(fixture, 'docs'), { recursive: true })
      writeFileSync(
        join(fixture, '.arbiter', 'live-ssot.json'),
        JSON.stringify({ surfaces: [{ path: 'docs/FEATURE_MATRIX.md', kind: 'matrix' }] }, null, 2),
        'utf-8',
      )
      writeFileSync(join(fixture, 'src', 'app.ts'), '// v1\n', 'utf-8')
      writeFileSync(join(fixture, 'docs', 'FEATURE_MATRIX.md'), '| feature | done |\n', 'utf-8')
      spawnSync('git', ['-C', fixture, 'add', '-A'], { encoding: 'utf-8' })
      spawnSync('git', ['-C', fixture, 'commit', '-qm', 'init'], { encoding: 'utf-8' })
      // Code-only change in the LAST commit — the live surface was not updated.
      writeFileSync(join(fixture, 'src', 'app.ts'), '// v2 changed\n', 'utf-8')
      spawnSync('git', ['-C', fixture, 'add', '-A'], { encoding: 'utf-8' })
      spawnSync('git', ['-C', fixture, 'commit', '-qm', 'code only'], { encoding: 'utf-8' })
      const result = runScript(script, fixture)
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/FEATURE_MATRIX/i)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('AC-2044.5: live-SSOT mode passes when the last commit also touches the surface', () => {
    const script = renderScript('scripts/check-drift.mjs.ejs')
    const fixture = mkdtempSync(join(tmpdir(), 'live-ssot-ok-'))
    try {
      spawnSync('git', ['-C', fixture, 'init', '-q', '-b', 'main'], { encoding: 'utf-8' })
      spawnSync('git', ['-C', fixture, 'config', 'user.email', 't@t'], { encoding: 'utf-8' })
      spawnSync('git', ['-C', fixture, 'config', 'user.name', 't'], { encoding: 'utf-8' })
      mkdirSync(join(fixture, '.arbiter'), { recursive: true })
      mkdirSync(join(fixture, 'src'), { recursive: true })
      mkdirSync(join(fixture, 'docs'), { recursive: true })
      writeFileSync(
        join(fixture, '.arbiter', 'live-ssot.json'),
        JSON.stringify({ surfaces: [{ path: 'docs/FEATURE_MATRIX.md', kind: 'matrix' }] }, null, 2),
        'utf-8',
      )
      writeFileSync(join(fixture, 'src', 'app.ts'), '// v1\n', 'utf-8')
      writeFileSync(join(fixture, 'docs', 'FEATURE_MATRIX.md'), '| feature | done |\n', 'utf-8')
      spawnSync('git', ['-C', fixture, 'add', '-A'], { encoding: 'utf-8' })
      spawnSync('git', ['-C', fixture, 'commit', '-qm', 'init'], { encoding: 'utf-8' })
      // Code AND surface touched together.
      writeFileSync(join(fixture, 'src', 'app.ts'), '// v2 changed\n', 'utf-8')
      writeFileSync(
        join(fixture, 'docs', 'FEATURE_MATRIX.md'),
        '| feature | done |\n| other | wip |\n',
        'utf-8',
      )
      spawnSync('git', ['-C', fixture, 'add', '-A'], { encoding: 'utf-8' })
      spawnSync('git', ['-C', fixture, 'commit', '-qm', 'code + matrix'], { encoding: 'utf-8' })
      const result = runScript(script, fixture)
      expect(result.status).toBe(0)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('AC-2044.6: live-SSOT mode SKIPs when no live-ssot.json is declared', () => {
    const script = renderScript('scripts/check-drift.mjs.ejs')
    const fixture = mkdtempSync(join(tmpdir(), 'live-ssot-skip-'))
    try {
      const result = runScript(script, fixture)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[SKIP]')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

describe('governance.liveSsot schema (#2044)', () => {
  const BASE_CONFIG = {
    version: '1.0.0',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: false,
    },
    thresholds: DEFAULT_THRESHOLDS.L2,
  }

  it('accepts a valid liveSsot declaration', () => {
    const result = validateConfig({
      ...BASE_CONFIG,
      governance: {
        liveSsot: { surfaces: [{ path: 'docs/FEATURE_MATRIX.md', kind: 'matrix' }] },
      },
    })
    expect(result.ok).toBe(true)
  })

  it('accepts both declared liveSsot surface kinds (matrix, ledger)', () => {
    const matrix = validateConfig({
      ...BASE_CONFIG,
      governance: {
        liveSsot: { surfaces: [{ path: 'docs/FEATURE_MATRIX.md', kind: 'matrix' }] },
      },
    })
    expect(matrix.ok).toBe(true)
    const ledger = validateConfig({
      ...BASE_CONFIG,
      governance: {
        liveSsot: { surfaces: [{ path: '.arbiter/ledger.jsonl', kind: 'ledger' }] },
      },
    })
    expect(ledger.ok).toBe(true)
  })

  it('rejects an unknown liveSsot surface kind', () => {
    const result = validateConfig({
      ...BASE_CONFIG,
      governance: {
        liveSsot: { surfaces: [{ path: 'docs/FEATURE_MATRIX.md', kind: 'spreadsheet' }] },
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('liveSsot'))).toBe(true)
  })

  it('rejects liveSsot surfaces that are not objects with a string path', () => {
    const result = validateConfig({
      ...BASE_CONFIG,
      governance: { liveSsot: { surfaces: [{ kind: 'matrix' }] } },
    })
    expect(result.ok).toBe(false)
  })
})
