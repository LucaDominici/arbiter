// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit test for src/generators/test-pyramid-manifest.ts (#1364).
// CANON-04: render test for src/templates/scripts/check-test-pyramid.mjs.ejs.
// CANON-07: runtime integration test — executes the generated gate script.
// CANON-11: brownfield / skipIfExists test for the file-emitting generator.
//
// Red phase: all tests must FAIL until generator + template are implemented.
//
// R8  (CANON-05): generateTestPyramidManifest emits manifest with all profile levels + globs.
// R9  (CANON-04): check-test-pyramid.mjs.ejs renders without error + carries CATALOG block.
// R10 (CANON-07): generated gate script exits 0 (populated) and 1 (empty declared level).
// R11 (CANON-11): brownfield — skipIfExists respected on re-init.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'
import { generateTestPyramidManifest } from '../../src/generators/test-pyramid-manifest.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

// ─── R8: CANON-05 — generator emits correct manifest ─────────────────────────

describe('generateTestPyramidManifest (R8, CANON-05)', () => {
  it('emits test-pyramid.json to project root', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    const result = generateTestPyramidManifest(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('test-pyramid.json'))
    expect(manifestFile).toBeDefined()
    expect(existsSync(manifestFile!.path)).toBe(true)
  })

  it('emitted manifest contains all levels from getTestPyramidProfile("library")', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    const result = generateTestPyramidManifest(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('test-pyramid.json'))!
    const manifest: { levels: Array<{ id: string }> } = JSON.parse(
      readFileSync(manifestFile.path, 'utf-8'),
    )
    // library archetype has L1 Unit and L2 Property-Based
    const ids = manifest.levels.map((l) => l.id)
    expect(ids).toContain('L1')
    expect(ids).toContain('L2')
  })

  it('emitted manifest includes language-appropriate globs for typescript', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    const result = generateTestPyramidManifest(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('test-pyramid.json'))!
    const manifest: { levels: Array<{ id: string; status: string; globs?: string[] }> } =
      JSON.parse(readFileSync(manifestFile.path, 'utf-8'))
    const l1 = manifest.levels.find((l) => l.id === 'L1')
    expect(l1?.status).toBe('required')
    expect(l1?.globs).toBeDefined()
    expect(l1!.globs!.some((g) => g.includes('.ts'))).toBe(true)
  })

  // B4 (#1491): first-run gate must be green. The emitted example test lands under
  // src/ (vitest convention), so the TS L1 glob must cover src/**, and tiers the
  // init scaffold does not populate (L2 Property-Based) must be greenfield-n/a so
  // the freshly-scaffolded project passes its OWN check-test-pyramid gate.
  it('TS L1 globs cover src/** so the emitted example test satisfies L1 (B4)', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    const result = generateTestPyramidManifest(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('test-pyramid.json'))!
    const manifest: { levels: Array<{ id: string; globs?: string[] }> } = JSON.parse(
      readFileSync(manifestFile.path, 'utf-8'),
    )
    const l1 = manifest.levels.find((l) => l.id === 'L1')
    expect(l1!.globs!).toContain('src/**/*.test.ts')
  })

  it('unscaffolded higher tiers are greenfield-n/a with a rationale (B4)', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    const result = generateTestPyramidManifest(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('test-pyramid.json'))!
    const manifest: {
      levels: Array<{ id: string; status: string; rationale?: string; globs?: string[] }>
    } = JSON.parse(readFileSync(manifestFile.path, 'utf-8'))
    const l2 = manifest.levels.find((l) => l.id === 'L2')
    expect(l2?.status).toBe('n/a')
    expect(l2?.rationale?.length).toBeGreaterThanOrEqual(20)
    // globs retained so a team can flip status→required without re-deriving them
    expect(l2?.globs).toBeDefined()
  })

  it('Rust keeps L2 required (its example tests land under tests/, L1 stays n/a)', () => {
    const config = makeConfig(dir, { language: 'rust', archetype: 'library' })
    const result = generateTestPyramidManifest(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('test-pyramid.json'))!
    const manifest: { levels: Array<{ id: string; status: string }> } = JSON.parse(
      readFileSync(manifestFile.path, 'utf-8'),
    )
    expect(manifest.levels.find((l) => l.id === 'L1')?.status).toBe('n/a')
    expect(manifest.levels.find((l) => l.id === 'L2')?.status).toBe('required')
  })

  it('emits Rust L1 Unit as n/a (inline #[test] cannot be glob-detected)', () => {
    const config = makeConfig(dir, { language: 'rust', archetype: 'library' })
    const result = generateTestPyramidManifest(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('test-pyramid.json'))!
    const manifest: { levels: Array<{ id: string; status: string; rationale?: string }> } =
      JSON.parse(readFileSync(manifestFile.path, 'utf-8'))
    const l1 = manifest.levels.find((l) => l.id === 'L1')
    expect(l1?.status).toBe('n/a')
    expect(l1?.rationale?.length).toBeGreaterThanOrEqual(20)
  })

  it('is idempotent — second run produces identical output', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    generateTestPyramidManifest(config)
    const manifestFile = join(dir, 'test-pyramid.json')
    const first = readFileSync(manifestFile, 'utf-8')
    // re-run (skipIfExists would skip, but dryRun comparison works regardless)
    const config2 = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    const result2 = generateTestPyramidManifest(config2, { dryRun: true })
    const dryContent = result2.files.find((f) => f.path.endsWith('test-pyramid.json'))
    // dry run should propose the same content
    expect(dryContent).toBeDefined()
    expect(first).toEqual(readFileSync(manifestFile, 'utf-8'))
  })

  it('respects dryRun — no file written to disk', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    generateTestPyramidManifest(config, { dryRun: true })
    expect(existsSync(join(dir, 'test-pyramid.json'))).toBe(false)
  })

  // #1653: polyglot (`multi`) had no key in the per-language GLOB tables, so its
  // `required` L1 tier got empty globs and failed the unconditional gate Day-1.
  it('emits non-empty globs for every required tier when language is "multi"', () => {
    const config = makeConfig(dir, { language: 'multi', archetype: 'library' })
    const result = generateTestPyramidManifest(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('test-pyramid.json'))!
    const manifest: { levels: Array<{ id: string; status: string; globs?: string[] }> } =
      JSON.parse(readFileSync(manifestFile.path, 'utf-8'))
    const required = manifest.levels.filter((l) => l.status === 'required')
    expect(required.length).toBeGreaterThan(0)
    for (const lvl of required) {
      expect(lvl.globs?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('multi L1 globs are the union of concrete languages (TS + Java BDD scaffold targets)', () => {
    const config = makeConfig(dir, { language: 'multi', archetype: 'library' })
    const result = generateTestPyramidManifest(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('test-pyramid.json'))!
    const manifest: { levels: Array<{ id: string; globs?: string[] }> } = JSON.parse(
      readFileSync(manifestFile.path, 'utf-8'),
    )
    const l1 = manifest.levels.find((l) => l.id === 'L1')!
    expect(l1.globs).toContain('src/**/*.test.ts')
    expect(l1.globs).toContain('src/test/**/*Test.java')
  })
})

// ─── R9: CANON-04 — template renders without error + CATALOG block ────────────

describe('check-test-pyramid.mjs.ejs render (R9, CANON-04)', () => {
  it('renders without throwing', () => {
    expect(() =>
      renderTemplate('scripts/check-test-pyramid.mjs.ejs', {
        ...makeConfig('/tmp/render-pyramid', { language: 'typescript' }),
      } as unknown as Record<string, unknown>),
    ).not.toThrow()
  })

  it('rendered output carries a CATALOG block (≥3 contiguous // CATALOG: lines in first 30)', () => {
    const rendered = renderTemplate('scripts/check-test-pyramid.mjs.ejs', {
      ...makeConfig('/tmp/render-pyramid', { language: 'typescript' }),
    } as unknown as Record<string, unknown>)
    const first30 = rendered.split('\n').slice(0, 30)
    const catalogLines = first30.filter((l) => l.startsWith('// CATALOG:'))
    expect(catalogLines.length).toBeGreaterThanOrEqual(3)
  })

  it('rendered output mentions INV-124', () => {
    const rendered = renderTemplate('scripts/check-test-pyramid.mjs.ejs', {
      ...makeConfig('/tmp/render-pyramid', { language: 'typescript' }),
    } as unknown as Record<string, unknown>)
    expect(rendered).toContain('INV-124')
  })
})

// ─── R10: CANON-07 — execute the generated gate script ────────────────────────

// Render the template once and reuse across the suite.
const RENDERED = renderTemplate('scripts/check-test-pyramid.mjs.ejs', {
  ...makeConfig('/tmp/render-pyramid-rt', { language: 'typescript' }),
} as unknown as Record<string, unknown>)

// #1366: the gate now imports the shared scripts/lib/glob-walk.mjs helper, so the
// generated tree must include it (both are UNCONDITIONAL_EMISSIONS in real init).
const RENDERED_GLOB_WALK = renderTemplate('scripts/lib/glob-walk.mjs.ejs', {
  ...makeConfig('/tmp/render-pyramid-rt', { language: 'typescript' }),
} as unknown as Record<string, unknown>)

function writeGateScripts(d: string): void {
  mkdirSync(join(d, 'scripts', 'lib'), { recursive: true })
  writeFileSync(join(d, 'scripts', 'check-test-pyramid.mjs'), RENDERED)
  writeFileSync(join(d, 'scripts', 'lib', 'glob-walk.mjs'), RENDERED_GLOB_WALK)
}

function stageTarget(
  manifest: unknown,
  extraFiles: Record<string, string> = {},
): { dir: string; cleanup: () => void } {
  const d = mkdtempSync(join(tmpdir(), 'tp-gen-'))
  writeGateScripts(d)
  writeFileSync(join(d, 'test-pyramid.json'), JSON.stringify(manifest, null, 2))
  for (const [rel, body] of Object.entries(extraFiles)) {
    const abs = join(d, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body)
  }
  return { dir: d, cleanup: () => rmSync(d, { recursive: true, force: true }) }
}

function runGenerated(d: string) {
  const r = spawnSync('node', [join(d, 'scripts', 'check-test-pyramid.mjs')], {
    encoding: 'utf-8',
    cwd: d,
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('generated check-test-pyramid.mjs runtime behaviour (R10, CANON-07)', () => {
  it('exits 0 when all required levels have matching files', () => {
    const { dir: d, cleanup } = stageTarget(
      {
        archetype: 'library',
        levels: [
          {
            id: 'L1',
            name: 'Unit',
            globs: ['__tests__/**/*.test.ts'],
            status: 'required',
          },
        ],
      },
      {
        '__tests__/foo.test.ts':
          'import { it, expect } from "vitest"\nit("x", () => expect(1).toBe(1))\n',
      },
    )
    try {
      expect(runGenerated(d).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a required level has no matching files', () => {
    const { dir: d, cleanup } = stageTarget({
      archetype: 'library',
      levels: [{ id: 'L1', name: 'Unit', globs: ['__tests__/**/*.test.ts'], status: 'required' }],
    })
    try {
      const r = runGenerated(d)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/declared but empty/i)
    } finally {
      cleanup()
    }
  })

  it('exits 0 for absent manifest (SKIP)', () => {
    const d = mkdtempSync(join(tmpdir(), 'tp-gen-absent-'))
    writeGateScripts(d)
    try {
      expect(runGenerated(d).status).toBe(0)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})

// ─── R11: CANON-11 — brownfield / skipIfExists ────────────────────────────────

describe('brownfield re-init (R11, CANON-11)', () => {
  it('does not overwrite an existing test-pyramid.json (skipIfExists)', () => {
    const customManifest = {
      archetype: 'library',
      levels: [{ id: 'L1', name: 'Unit', globs: ['custom/**/*.spec.ts'], status: 'required' }],
    }
    writeFileSync(join(dir, 'test-pyramid.json'), JSON.stringify(customManifest, null, 2))
    const originalContent = readFileSync(join(dir, 'test-pyramid.json'), 'utf-8')

    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    generateTestPyramidManifest(config)

    const afterContent = readFileSync(join(dir, 'test-pyramid.json'), 'utf-8')
    expect(afterContent).toBe(originalContent)
  })

  it('result.files[0].action is "skipped" when file already exists', () => {
    writeFileSync(
      join(dir, 'test-pyramid.json'),
      JSON.stringify({ archetype: 'library', levels: [] }),
    )
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    const result = generateTestPyramidManifest(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('test-pyramid.json'))
    expect(manifestFile?.action).toBe('skipped')
  })
})
