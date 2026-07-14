// SPDX-License-Identifier: Apache-2.0
// CANON-07: runtime integration test — executes the generated check-api-e2e.mjs gate.
// CANON-04: render test for src/templates/scripts/check-api-e2e.mjs.ejs.
//
// Gate contract (INV-126), INVERTED absent-semantics vs test-pyramid for SERVICE archetypes:
//   manifest absent                       → exit 0 (SKIP — ungoverned repo safety)
//   manifest required:false               → exit 0 (SKIP — non-service archetype)
//   required:true + populated suite       → exit 0 (PASS)
//   required:true + absent/empty suite    → exit 1 (FAIL — the core of this issue)
//   path-traversal / absolute glob        → exit 2 (schema error)
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'

const RENDERED = renderTemplate('scripts/check-api-e2e.mjs.ejs', {
  ...makeConfig('/tmp/render-api-e2e', { language: 'typescript' }),
} as unknown as Record<string, unknown>)

// check-api-e2e.mjs imports the shared glob-walk helper (scripts/lib/glob-walk.mjs), which the
// real generator emits alongside it unconditionally (src/generators/check-all.ts) — stage() must
// materialize the same sibling file or the spawned script fails at module-load, before any of its
// own logic (including --help) runs.
const RENDERED_GLOB_WALK = renderTemplate('scripts/lib/glob-walk.mjs.ejs', {
  ...makeConfig('/tmp/render-api-e2e', { language: 'typescript' }),
} as unknown as Record<string, unknown>)

function stage(manifest: unknown | null, extraFiles: Record<string, string> = {}) {
  const d = mkdtempSync(join(tmpdir(), 'api-e2e-'))
  mkdirSync(join(d, 'scripts', 'lib'), { recursive: true })
  writeFileSync(join(d, 'scripts', 'check-api-e2e.mjs'), RENDERED)
  writeFileSync(join(d, 'scripts', 'lib', 'glob-walk.mjs'), RENDERED_GLOB_WALK)
  if (manifest !== null) {
    writeFileSync(join(d, 'api-e2e.json'), JSON.stringify(manifest, null, 2))
  }
  for (const [rel, body] of Object.entries(extraFiles)) {
    const abs = join(d, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body)
  }
  return { dir: d, cleanup: () => rmSync(d, { recursive: true, force: true }) }
}

function run(d: string) {
  const r = spawnSync('node', [join(d, 'scripts', 'check-api-e2e.mjs')], {
    encoding: 'utf-8',
    cwd: d,
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const SERVICE = {
  archetype: 'backend-web-db',
  required: true,
  suiteDir: 'tests/api',
  framework: 'supertest',
  glob: 'tests/api/**/*.test.ts',
}

describe('check-api-e2e.mjs.ejs render (CANON-04)', () => {
  it('renders without throwing and carries a CATALOG block + INV-126', () => {
    expect(RENDERED.length).toBeGreaterThan(100)
    const first30 = RENDERED.split('\n').slice(0, 30)
    expect(first30.filter((l) => l.startsWith('// CATALOG:')).length).toBeGreaterThanOrEqual(3)
    expect(RENDERED).toContain('INV-126')
  })
})

describe('generated check-api-e2e.mjs runtime (CANON-07)', () => {
  it('exits 0 (SKIP) when api-e2e.json is absent', () => {
    const { dir, cleanup } = stage(null)
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 (SKIP) when required:false (non-service archetype)', () => {
    const { dir, cleanup } = stage({ ...SERVICE, archetype: 'library', required: false })
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 (PASS) when required:true and a populated suite exists', () => {
    const { dir, cleanup } = stage(SERVICE, {
      'tests/api/api.e2e.test.ts':
        'import request from "supertest"\nit("live", async () => { await request("http://x").get("/health") })\n',
    })
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 (FAIL) when required:true but the suite is absent', () => {
    const { dir, cleanup } = stage(SERVICE)
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/absent|empty|no.*suite|missing/i)
    } finally {
      cleanup()
    }
  })

  it('exits 1 (FAIL) when required:true and the only suite file is empty', () => {
    const { dir, cleanup } = stage(SERVICE, { 'tests/api/api.e2e.test.ts': '   \n' })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('exits 2 (schema) on a path-traversal glob', () => {
    const { dir, cleanup } = stage({ ...SERVICE, glob: '../../etc/**/*.ts' })
    try {
      expect(run(dir).status).toBe(2)
    } finally {
      cleanup()
    }
  })

  it('exits 2 (schema) on an absolute glob', () => {
    const { dir, cleanup } = stage({ ...SERVICE, glob: '/etc/**/*.ts' })
    try {
      expect(run(dir).status).toBe(2)
    } finally {
      cleanup()
    }
  })

  it('exits 2 (schema) on invalid JSON', () => {
    const d = mkdtempSync(join(tmpdir(), 'api-e2e-badjson-'))
    mkdirSync(join(d, 'scripts', 'lib'), { recursive: true })
    writeFileSync(join(d, 'scripts', 'check-api-e2e.mjs'), RENDERED)
    writeFileSync(join(d, 'scripts', 'lib', 'glob-walk.mjs'), RENDERED_GLOB_WALK)
    writeFileSync(join(d, 'api-e2e.json'), '{ not json')
    try {
      expect(run(d).status).toBe(2)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('prints --help and exits 0', () => {
    const d = mkdtempSync(join(tmpdir(), 'api-e2e-help-'))
    mkdirSync(join(d, 'scripts', 'lib'), { recursive: true })
    writeFileSync(join(d, 'scripts', 'check-api-e2e.mjs'), RENDERED)
    writeFileSync(join(d, 'scripts', 'lib', 'glob-walk.mjs'), RENDERED_GLOB_WALK)
    try {
      const r = spawnSync('node', [join(d, 'scripts', 'check-api-e2e.mjs'), '--help'], {
        encoding: 'utf-8',
        cwd: d,
      })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/Usage/i)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
