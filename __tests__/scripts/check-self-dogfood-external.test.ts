// SPDX-License-Identifier: Apache-2.0
//
// R-02 (#1900) — external CI-surface parity. TEMPLATE_ROOTS' fail-closed "every
// template must materialize" contract does not fit .github/workflows/ or
// scripts/check-*.mjs: both families are emitted CONDITIONALLY (archetype ×
// governanceLevel × collaborationMode), so most templates have no self
// counterpart at all. checkExternalCiSurfaceParity instead compares only the
// basenames present on BOTH sides — the exact shape of the #1877/#1894 drift
// class (a file that exists in both places moved on one side without the
// other) — reusing the same CANON-14 pinned-diff mechanism as the rest of this
// gate.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { withRealRepoMutationLock } from '../helpers.js'
import {
  EXTERNAL_CI_FAMILIES,
  matchedFamilyBasenames,
  checkExternalCiSurfaceParity,
  hashDiff,
} from '../../scripts/check-self-dogfood.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

// ─── EXTERNAL_CI_FAMILIES ─────────────────────────────────────────────────────

describe('EXTERNAL_CI_FAMILIES', () => {
  it('declares the github-workflows, check-scripts, script-libs and schemas families', () => {
    expect(EXTERNAL_CI_FAMILIES.map((f: { key: string }) => f.key)).toEqual([
      'github-workflows',
      'check-scripts',
      'script-libs',
      'schemas',
    ])
  })

  it('check-scripts family excludes check-all (needs a bespoke coverageEnabled render field)', () => {
    const scripts = EXTERNAL_CI_FAMILIES.find((f: { key: string }) => f.key === 'check-scripts')
    expect(scripts.include('check-all')).toBe(false)
    expect(scripts.include('check-drift')).toBe(true)
  })

  it('check-scripts family admits the record-* recorder twins (E1 #1943)', () => {
    const scripts = EXTERNAL_CI_FAMILIES.find((f: { key: string }) => f.key === 'check-scripts')
    expect(scripts.include('record-agent-return')).toBe(true)
  })

  it('check-scripts family only includes check-*/record-*.mjs, not the wider scripts/ corpus', () => {
    const scripts = EXTERNAL_CI_FAMILIES.find((f: { key: string }) => f.key === 'check-scripts')
    expect(scripts.include('debt-lib')).toBe(false)
    expect(scripts.include('evidence-collect')).toBe(false)
  })

  it('script-libs family basename-intersects scripts/lib with its shipped twins', () => {
    const libs = EXTERNAL_CI_FAMILIES.find((f: { key: string }) => f.key === 'script-libs')
    expect(libs.templateDir).toBe('src/templates/scripts/lib')
    expect(libs.materializedDir).toBe('scripts/lib')
    // The E1-E7 shared helpers must be inside parity scope (#1943 residual c).
    expect(matchedFamilyBasenames(repoRoot, libs)).toEqual(
      expect.arrayContaining(['gate-args', 'agent-return-validate']),
    )
  })

  it('schemas family covers the agent-return envelope schema twin (E1 #1943)', () => {
    const schemas = EXTERNAL_CI_FAMILIES.find((f: { key: string }) => f.key === 'schemas')
    expect(schemas.materializedDir).toBe('schemas')
    expect(matchedFamilyBasenames(repoRoot, schemas)).toContain('agent-return')
  })

  it('check-scripts family covers the five anti-context-rot gate twins (#1943 residual c)', () => {
    const scripts = EXTERNAL_CI_FAMILIES.find((f: { key: string }) => f.key === 'check-scripts')
    const matched = matchedFamilyBasenames(repoRoot, scripts)
    expect(matched).toEqual(
      expect.arrayContaining([
        'check-agent-return',
        'check-refutation-verdicts',
        'check-audit-dry-pass',
        'check-handoff-doc',
        'check-touched-vs-manifest',
        'record-agent-return',
      ]),
    )
  })
})

// ─── matchedFamilyBasenames ───────────────────────────────────────────────────

describe('matchedFamilyBasenames', () => {
  let tmp: string

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  })

  function makeFamily(root: string) {
    return {
      templateDir: 'tpl',
      templateSuffix: '.yml.ejs',
      materializedDir: 'mat',
      materializedSuffix: '.yml',
      renderPath: (base: string) => `tpl/${base}.yml.ejs`,
      _root: root,
    }
  }

  it('returns only basenames present on BOTH sides (intersection, not union)', () => {
    tmp = mkdtempSync(join(tmpdir(), 'dogfood-ext-'))
    mkdirSync(join(tmp, 'tpl'), { recursive: true })
    mkdirSync(join(tmp, 'mat'), { recursive: true })
    writeFileSync(join(tmp, 'tpl', 'both.yml.ejs'), 'a')
    writeFileSync(join(tmp, 'mat', 'both.yml'), 'a')
    writeFileSync(join(tmp, 'tpl', 'template-only.yml.ejs'), 'a')
    writeFileSync(join(tmp, 'mat', 'materialized-only.yml'), 'a')

    const result = matchedFamilyBasenames(tmp, makeFamily(tmp))
    expect(result).toEqual(['both'])
  })

  it('does not recurse into subdirectories (e.g. _partials/)', () => {
    tmp = mkdtempSync(join(tmpdir(), 'dogfood-ext-'))
    mkdirSync(join(tmp, 'tpl', '_partials'), { recursive: true })
    mkdirSync(join(tmp, 'mat'), { recursive: true })
    writeFileSync(join(tmp, 'tpl', '_partials', 'nested.yml.ejs'), 'a')
    writeFileSync(join(tmp, 'mat', 'nested.yml'), 'a')

    const result = matchedFamilyBasenames(tmp, makeFamily(tmp))
    expect(result).toEqual([])
  })

  it('applies the family include filter (e.g. check-* only)', () => {
    tmp = mkdtempSync(join(tmpdir(), 'dogfood-ext-'))
    mkdirSync(join(tmp, 'tpl'), { recursive: true })
    mkdirSync(join(tmp, 'mat'), { recursive: true })
    for (const name of ['check-x', 'debt-lib']) {
      writeFileSync(join(tmp, 'tpl', `${name}.yml.ejs`), 'a')
      writeFileSync(join(tmp, 'mat', `${name}.yml`), 'a')
    }
    const family = { ...makeFamily(tmp), include: (b: string) => b.startsWith('check-') }
    expect(matchedFamilyBasenames(tmp, family)).toEqual(['check-x'])
  })

  it('returns [] when either side does not exist (no throw)', () => {
    tmp = mkdtempSync(join(tmpdir(), 'dogfood-ext-'))
    expect(matchedFamilyBasenames(tmp, makeFamily(tmp))).toEqual([])
  })

  it('real repo: github-workflows family has at least one matched pair (03-human-approval)', () => {
    const family = EXTERNAL_CI_FAMILIES.find((f: { key: string }) => f.key === 'github-workflows')
    expect(matchedFamilyBasenames(repoRoot, family)).toContain('03-human-approval')
  })
})

// ─── checkExternalCiSurfaceParity ─────────────────────────────────────────────

describe('checkExternalCiSurfaceParity', () => {
  let tmp: string

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  })

  function setup() {
    tmp = mkdtempSync(join(tmpdir(), 'dogfood-ext-check-'))
    mkdirSync(join(tmp, 'src/templates/github/workflows'), { recursive: true })
    mkdirSync(join(tmp, '.github/workflows'), { recursive: true })
    return tmp
  }

  it('counts an identical basename-matched pair as checked, not drifted', async () => {
    const root = setup()
    writeFileSync(join(root, 'src/templates/github/workflows/foo.yml.ejs'), 'name: Foo\n')
    writeFileSync(join(root, '.github/workflows/foo.yml'), 'name: Foo\n')
    const result = await checkExternalCiSurfaceParity(root, new Map(), () => 'name: Foo\n')
    expect(result.checked).toBe(1)
    expect(result.drifted).toEqual([])
  })

  it('flags an UNPINNED divergence as drift (fail-closed)', async () => {
    const root = setup()
    writeFileSync(join(root, 'src/templates/github/workflows/foo.yml.ejs'), 'name: Foo\n')
    writeFileSync(join(root, '.github/workflows/foo.yml'), 'name: Bar\n')
    const result = await checkExternalCiSurfaceParity(root, new Map(), () => 'name: Foo\n')
    expect(result.checked).toBe(0)
    expect(result.drifted).toHaveLength(1)
    expect(result.drifted[0].template).toBe('github/workflows/foo.yml.ejs')
  })

  it('skips a divergence whose pinned diffHash matches the recomputed diff (CANON-14)', async () => {
    const root = setup()
    writeFileSync(join(root, 'src/templates/github/workflows/foo.yml.ejs'), 'name: Foo\n')
    writeFileSync(join(root, '.github/workflows/foo.yml'), 'name: Bar\n')
    const diff = { added: ['name: Bar'], removed: ['name: Foo'] }
    const divergences = new Map([
      [
        join(root, '.github/workflows/foo.yml'),
        { path: 'foo.yml', dest: '.github/workflows', reason: 'r', diffHash: hashDiff(diff) },
      ],
    ])
    const result = await checkExternalCiSurfaceParity(root, divergences, () => 'name: Foo\n')
    expect(result.skipped).toBe(1)
    expect(result.drifted).toEqual([])
  })

  it('re-flags when the diff CHANGES beyond the pinned hash (non-vacuous allowlist)', async () => {
    const root = setup()
    writeFileSync(join(root, 'src/templates/github/workflows/foo.yml.ejs'), 'name: Foo\n')
    writeFileSync(join(root, '.github/workflows/foo.yml'), 'name: Bar\nextra: 1\n')
    const staleDiff = { added: ['name: Bar'], removed: ['name: Foo'] }
    const divergences = new Map([
      [
        join(root, '.github/workflows/foo.yml'),
        {
          path: 'foo.yml',
          dest: '.github/workflows',
          reason: 'r',
          diffHash: hashDiff(staleDiff),
        },
      ],
    ])
    const result = await checkExternalCiSurfaceParity(root, divergences, () => 'name: Foo\n')
    expect(result.drifted).toHaveLength(1)
    expect(result.drifted[0].reason).toContain('CHANGED beyond the approved pin')
  })

  it('reports a render error as drift instead of throwing', async () => {
    const root = setup()
    writeFileSync(join(root, 'src/templates/github/workflows/foo.yml.ejs'), 'name: Foo\n')
    writeFileSync(join(root, '.github/workflows/foo.yml'), 'name: Foo\n')
    const result = await checkExternalCiSurfaceParity(root, new Map(), () => {
      throw new Error('boom')
    })
    expect(result.drifted).toHaveLength(1)
    expect(result.drifted[0].reason).toContain('render error: boom')
  })
})

// ─── non-vacuity proof against the real repo (mirrors the .claude/ship pattern) ─
// Requires a built dist/ (npm run build) — the check imports resolveProjectConfig
// + renderTemplate from the COMPILED output because scripts/ cannot import .ts
// directly (mirrors check-agent-dispatch.mjs, #1267); CI always builds before
// running the test suite.

describe('external CI-surface parity is non-vacuous against the real repo (#1900)', () => {
  // Per-test timeout raised past the spawnSync's own 120_000ms bound below (the default global
  // 30_000ms testTimeout is shorter than the child process's own allowance, so under load this
  // test could time out at the vitest level while the still-running child would have finished
  // fine within its budget — flaky-red, not a real regression). 150s gives the child's 120s a
  // margin for process spawn/teardown overhead.
  it(
    'a mutated pinned workflow (.github/workflows/01-pr-fast.yml) turns the gate red',
    () =>
      withRealRepoMutationLock(() => {
        const target = join(repoRoot, '.github/workflows/01-pr-fast.yml')
        const original = readFileSync(target, 'utf-8')
        try {
          writeFileSync(target, `${original}      - run: echo synthetic-drift-sentinel\n`, 'utf-8')
          const r = spawnSync('node', ['scripts/check-self-dogfood.mjs'], {
            cwd: repoRoot,
            encoding: 'utf-8',
            timeout: 120_000,
          })
          expect(r.status).not.toBe(0)
          expect(r.stdout + r.stderr).toContain('01-pr-fast.yml')
          expect(r.stdout + r.stderr).toContain('CHANGED beyond the approved pin')
        } finally {
          writeFileSync(target, original, 'utf-8')
        }
      }),
    150_000,
  )

  it(
    'a mutated pinned check-script (scripts/check-drift.mjs) turns the gate red',
    () =>
      withRealRepoMutationLock(() => {
        const target = join(repoRoot, 'scripts/check-drift.mjs')
        const original = readFileSync(target, 'utf-8')
        try {
          writeFileSync(target, `${original}// synthetic-drift-sentinel\n`, 'utf-8')
          const r = spawnSync('node', ['scripts/check-self-dogfood.mjs'], {
            cwd: repoRoot,
            encoding: 'utf-8',
            timeout: 120_000,
          })
          expect(r.status).not.toBe(0)
          expect(r.stdout + r.stderr).toContain('check-drift.mjs')
          expect(r.stdout + r.stderr).toContain('CHANGED beyond the approved pin')
        } finally {
          writeFileSync(target, original, 'utf-8')
        }
      }),
    150_000,
  )

  it(
    'passes cleanly against the real, unmutated repo',
    () =>
      withRealRepoMutationLock(() => {
        const r = spawnSync('node', ['scripts/check-self-dogfood.mjs'], {
          cwd: repoRoot,
          encoding: 'utf-8',
          timeout: 120_000,
        })
        expect(r.status).toBe(0)
      }),
    150_000,
  )
})
