// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit test for src/generators/check-stack-conformity.ts (#1312).
// Red phase: all tests must FAIL until generator + template are implemented.
//
// Covers TDD units 1, 7 (emission gating + CATALOG marker) at generator level.
// Runtime conformity behavior (units 2-5) is covered by the spawn-based suite below
// (renders the template to a temp dir, then runs the emitted gate against root manifests).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'
import { generateStackConformity } from '../../src/generators/check-stack-conformity.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generateStackConformity (#1312, CANON-05)', () => {
  it('emits check-stack-conformity.mjs to scripts/ dir', () => {
    const config = makeConfig(dir, { language: 'go', governanceLevel: 'L1' })
    const result = generateStackConformity(config)
    const scriptFile = result.files.find((f) => f.path.endsWith('check-stack-conformity.mjs'))
    expect(scriptFile).toBeDefined()
    expect(existsSync(scriptFile!.path)).toBe(true)
  })

  it('emitted script carries a CATALOG marker block (INV-94, ≥3 contiguous lines in first 30)', () => {
    const config = makeConfig(dir, { language: 'go', governanceLevel: 'L1' })
    const result = generateStackConformity(config)
    const scriptFile = result.files.find((f) => f.path.endsWith('check-stack-conformity.mjs'))
    const content = readFileSync(scriptFile!.path, 'utf-8')
    const first30 = content.split('\n').slice(0, 30)
    const catalogLines = first30.filter((l: string) => l.startsWith('// CATALOG:'))
    expect(catalogLines.length).toBeGreaterThanOrEqual(3)
  })

  it('is idempotent — second run produces identical output', () => {
    const config = makeConfig(dir, { language: 'go', governanceLevel: 'L2' })
    const a = generateStackConformity(config)
    const b = generateStackConformity(config)
    const fa = a.files.find((f) => f.path.endsWith('check-stack-conformity.mjs'))!
    const fb = b.files.find((f) => f.path.endsWith('check-stack-conformity.mjs'))!
    expect(readFileSync(fa.path, 'utf-8')).toBe(readFileSync(fb.path, 'utf-8'))
  })

  it('respects dryRun — no file written to disk', () => {
    const config = makeConfig(dir, { language: 'go', governanceLevel: 'L1' })
    const result = generateStackConformity(config, { dryRun: true })
    expect(existsSync(join(dir, 'scripts', 'check-stack-conformity.mjs'))).toBe(false)
    expect(result.files.every((f) => f.action === 'created')).toBe(true)
  })
})

// ─── Emitted-gate runtime behavior (TDD units 2-5) ──────────────────────────
// Render the template once, then exercise the runtime self-safety + conformity
// logic by staging arbiter.json + root manifests in a temp dir and spawning node.

const RENDERED = renderTemplate('scripts/check-stack-conformity.mjs.ejs', {
  ...makeConfig('/tmp/render', { language: 'go' }),
} as unknown as Record<string, unknown>)

function stage(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const d = mkdtempSync(join(tmpdir(), 'stack-conf-'))
  mkdirSync(join(d, 'scripts'), { recursive: true })
  writeFileSync(join(d, 'scripts', 'check-stack-conformity.mjs'), RENDERED)
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(d, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body)
  }
  return { dir: d, cleanup: () => rmSync(d, { recursive: true, force: true }) }
}

function run(d: string) {
  const r = spawnSync('node', [join(d, 'scripts', 'check-stack-conformity.mjs')], {
    encoding: 'utf-8',
    cwd: d,
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('emitted check-stack-conformity.mjs — runtime conformity (#1312)', () => {
  it('unit 4: absent language in arbiter.json ⇒ exit 0 (self/undeclared never fails)', () => {
    const { dir: d, cleanup } = stage({
      'arbiter.json': JSON.stringify({ collaborationMode: 'trunk-solo' }),
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
    })
    try {
      expect(run(d).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('unit 4: absent arbiter.json ⇒ exit 0 (non-arbiter project)', () => {
    const { dir: d, cleanup } = stage({ 'go.mod': 'module x\n' })
    try {
      expect(run(d).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('unit 2: declared go but root package.json + no go.mod ⇒ exit 1 (mismatch)', () => {
    const { dir: d, cleanup } = stage({
      'arbiter.json': JSON.stringify({ language: 'go' }),
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
    })
    try {
      const r = run(d)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/language/i)
    } finally {
      cleanup()
    }
  })

  it('unit 2: declared go + root go.mod present ⇒ exit 0 (match)', () => {
    const { dir: d, cleanup } = stage({
      'arbiter.json': JSON.stringify({ language: 'go' }),
      'go.mod': 'module example.com/x\n\ngo 1.22\n',
    })
    try {
      expect(run(d).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('unit 2: declared typescript + root go.mod and no package.json ⇒ exit 1 (mismatch)', () => {
    const { dir: d, cleanup } = stage({
      'arbiter.json': JSON.stringify({ language: 'typescript' }),
      'go.mod': 'module example.com/x\n',
    })
    try {
      expect(run(d).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('unit 3: declared sqlite + postgres driver in root package.json ⇒ exit 1 (DB mismatch)', () => {
    const { dir: d, cleanup } = stage({
      'arbiter.json': JSON.stringify({ language: 'typescript', databaseEngine: 'sqlite' }),
      'package.json': JSON.stringify({ dependencies: { pg: '^8', typescript: '^5' } }),
    })
    try {
      const r = run(d)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/database|engine|driver/i)
    } finally {
      cleanup()
    }
  })

  it('unit 3: declared sqlite + matching sqlite driver ⇒ exit 0', () => {
    const { dir: d, cleanup } = stage({
      'arbiter.json': JSON.stringify({ language: 'typescript', databaseEngine: 'sqlite' }),
      'package.json': JSON.stringify({
        dependencies: { 'better-sqlite3': '^11', typescript: '^5' },
      }),
    })
    try {
      expect(run(d).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('unit 3: declared databaseEngine none ⇒ DB conformity skipped, exit 0', () => {
    const { dir: d, cleanup } = stage({
      'arbiter.json': JSON.stringify({ language: 'typescript', databaseEngine: 'none' }),
      'package.json': JSON.stringify({ dependencies: { pg: '^8', typescript: '^5' } }),
    })
    try {
      expect(run(d).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('unit 4: absent databaseEngine ⇒ DB conformity skipped (treated as none), exit 0', () => {
    const { dir: d, cleanup } = stage({
      'arbiter.json': JSON.stringify({ language: 'typescript' }),
      'package.json': JSON.stringify({ dependencies: { pg: '^8', typescript: '^5' } }),
    })
    try {
      expect(run(d).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('unit 5: a go.mod in a subdir is NOT read (root-only) — no false fail', () => {
    const { dir: d, cleanup } = stage({
      'arbiter.json': JSON.stringify({ language: 'typescript' }),
      'package.json': JSON.stringify({ dependencies: { typescript: '^5' } }),
      'backend/go.mod': 'module example.com/be\n',
      '__tests__/fixtures/x/go.mod': 'module fixture\n',
    })
    try {
      expect(run(d).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
