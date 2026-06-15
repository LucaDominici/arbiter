import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/gold-audit.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** A registry with one of each verdict-producing check type. All SAFE by default. */
const REGISTRY = `version: '1.0.0'
profile: tooling
dimensions:
  - id: D-DOCS
    title: Documentation
  - id: D-META
    title: Meta-test discipline
checks:
  - id: GA-01
    dimension: D-DOCS
    title: README present
    type: file_exists
    args: { path: README.md }
    weight: 1
    risk: SAFE
    anchor: INV-00
  - id: GA-02
    dimension: D-DOCS
    title: README mentions install
    type: file_contains
    args: { path: README.md, pattern: 'install' }
    weight: 1
    risk: SAFE
  - id: GA-03
    dimension: D-META
    title: api-only overlay doc
    type: file_exists
    args: { path: docs/api.md }
    applies_if: has-api
    weight: 1
    risk: SAFE
  - id: GA-04
    dimension: D-META
    title: human attestation of release process
    type: manual
    weight: 1
    risk: SAFE
`

function makeRepo(
  registry: string = REGISTRY,
  profile?: string,
): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gold-audit-test-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-registry.yml'), registry)
  if (profile) {
    writeFileSync(join(dir, 'standards', 'gold-profile'), profile)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('gold-audit (#1373)', () => {
  it('--help exits 0', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('resolves an absolute --registry and writes --json to an absolute path (regression: join→resolve)', () => {
    const { dir, cleanup } = makeRepo()
    const ext = mkdtempSync(join(tmpdir(), 'gold-audit-ext-'))
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const regAbs = join(ext, 'my-registry.yml')
      writeFileSync(regAbs, REGISTRY)
      const outAbs = join(ext, 'out.json')
      const r = run(dir, ['--registry', regAbs, '--json', outAbs])
      expect(r.status).toBe(0)
      expect(r.stdout).not.toMatch(/SKIP/) // absolute registry must be found, not concatenated onto CWD
      expect(existsSync(outAbs)).toBe(true) // absolute --json must write to that exact path
      const j = JSON.parse(readFileSync(outAbs, 'utf-8'))
      expect(typeof j.score).toBe('number')
    } finally {
      cleanup()
      rmSync(ext, { recursive: true, force: true })
    }
  })

  it('--json emits a scored payload with score, yCount, riskyCount, dimensions, checks', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const r = run(dir, ['--json'])
      expect(r.status).toBe(0)
      const j = JSON.parse(r.stdout)
      expect(typeof j.score).toBe('number')
      expect(typeof j.yCount).toBe('number')
      expect(typeof j.riskyCount).toBe('number')
      expect(Array.isArray(j.checks)).toBe(true)
      expect(typeof j.dimensions).toBe('object')
    } finally {
      cleanup()
    }
  })

  it('verdicts: present→Y, absent→N, applies_if-false→NA, manual→NV', () => {
    const { dir, cleanup } = makeRepo() // no overlay → GA-03 is NA
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId: Record<string, { verdict: string }> = Object.fromEntries(
        j.checks.map((c: { id: string }) => [c.id, c]),
      )
      expect(byId['GA-01'].verdict).toBe('Y') // README exists
      expect(byId['GA-02'].verdict).toBe('Y') // README contains "install"
      expect(byId['GA-03'].verdict).toBe('NA') // has-api overlay off
      expect(byId['GA-04'].verdict).toBe('NV') // manual → not verified by code
    } finally {
      cleanup()
    }
  })

  it('absent file_exists → N', () => {
    const { dir, cleanup } = makeRepo()
    try {
      // README missing entirely → GA-01 N, GA-02 N
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId: Record<string, { verdict: string }> = Object.fromEntries(
        j.checks.map((c: { id: string }) => [c.id, c]),
      )
      expect(byId['GA-01'].verdict).toBe('N')
      expect(byId['GA-02'].verdict).toBe('N')
    } finally {
      cleanup()
    }
  })

  it('every non-NA/NV verdict carries evidence with a file', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId = Object.fromEntries(j.checks.map((c: { id: string }) => [c.id, c]))
      expect(byId['GA-01'].evidence.file).toBe('README.md')
      expect(byId['GA-02'].evidence.file).toBe('README.md')
      expect(typeof byId['GA-02'].evidence.line).toBe('number')
    } finally {
      cleanup()
    }
  })

  it('overlay on → applies_if check becomes applicable', () => {
    const { dir, cleanup } = makeRepo(REGISTRY, 'overlays:\n  - has-api\n')
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId = Object.fromEntries(j.checks.map((c: { id: string }) => [c.id, c]))
      expect(byId['GA-03'].verdict).toBe('N') // now applies, doc missing
    } finally {
      cleanup()
    }
  })

  it('is deterministic — byte-identical JSON for identical inputs', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const a = run(dir, ['--json']).stdout
      const b = run(dir, ['--json']).stdout
      expect(a).toBe(b)
    } finally {
      cleanup()
    }
  })

  it('--check bootstraps a missing baseline and exits 0', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const r = run(dir, ['--check'])
      expect(r.status).toBe(0)
      expect(existsSync(join(dir, '.gold-audit-baseline.json'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('--check no-regress: a higher baseline score fails (exit 1)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      // Seed a baseline that demands a higher score/yCount than current.
      writeFileSync(
        join(dir, '.gold-audit-baseline.json'),
        JSON.stringify({ score: 100, yCount: 99, dimensions: {} }, null, 2) + '\n',
      )
      const r = run(dir, ['--check'])
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/regress/i)
    } finally {
      cleanup()
    }
  })

  it('--check passes (exit 0) when score meets the baseline', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      writeFileSync(
        join(dir, '.gold-audit-baseline.json'),
        JSON.stringify({ score: 0, yCount: 0, dimensions: {} }, null, 2) + '\n',
      )
      const r = run(dir, ['--check'])
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('--update-baseline is monotonic — never lowers a recorded field', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      // Existing baseline already higher than what the current tree scores.
      writeFileSync(
        join(dir, '.gold-audit-baseline.json'),
        JSON.stringify({ score: 100, yCount: 99, dimensions: {} }, null, 2) + '\n',
      )
      const r = run(dir, ['--update-baseline'])
      expect(r.status).toBe(0)
      const bl = JSON.parse(readFileSync(join(dir, '.gold-audit-baseline.json'), 'utf-8'))
      expect(bl.score).toBe(100) // not lowered
      expect(bl.yCount).toBe(99) // not lowered
    } finally {
      cleanup()
    }
  })

  it('false-gap meta-gate: a RISKY check fails --strict (exit 1)', () => {
    const risky = REGISTRY.replace('risk: SAFE\n    anchor: INV-00', 'risk: RISKY')
    const { dir, cleanup } = makeRepo(risky)
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const r = run(dir, ['--strict'])
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/risky/i)
    } finally {
      cleanup()
    }
  })

  it('false-gap meta-gate: all SAFE passes --strict (exit 0)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const r = run(dir, ['--strict'])
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
