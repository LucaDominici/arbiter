import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-doc-set.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(manifest: string, profile?: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'doc-set-test-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), manifest)
  if (profile) {
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, 'standards', 'doc-profile'), profile)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const MANIFEST = `version: '1.0.0'
profile: tooling
checks:
  - path: README.md
    tier: mandatory
    applies: always
  - path: docs/coding-standards.md
    tier: mandatory
    applies: always
    accept_any: ['docs/coding-standards.md', 'CONTRIBUTING.md']
  - path: docs/GLOSSARY.md
    tier: recommended
    applies: always
  - path: docs/api
    tier: conditional
    applies: has-api
    glob: 'docs/api/*'
`

describe('check-doc-set (#1374)', () => {
  it('--help exits 0', () => {
    const { dir, cleanup } = makeRepo(MANIFEST)
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('reports a mandatory gap and --strict exits 1', () => {
    const { dir, cleanup } = makeRepo(MANIFEST)
    try {
      // README.md missing → mandatory gap.
      const advisory = run(dir)
      expect(advisory.status).toBe(0) // advisory by default
      expect(advisory.stdout).toMatch(/MISSING \[mandatory\] README\.md/)
      const strict = run(dir, ['--strict'])
      expect(strict.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('accept_any: an equivalent path satisfies the check', () => {
    const { dir, cleanup } = makeRepo(MANIFEST)
    try {
      writeFileSync(join(dir, 'README.md'), '# r')
      writeFileSync(join(dir, 'CONTRIBUTING.md'), '# c') // satisfies docs/coding-standards via accept_any
      const r = run(dir, ['--strict'])
      expect(r.status).toBe(0)
      expect(r.stdout).not.toMatch(/MISSING \[mandatory\]/)
    } finally {
      cleanup()
    }
  })

  it('conditional checks are n/a unless their overlay is enabled', () => {
    const off = makeRepo(MANIFEST)
    try {
      writeFileSync(join(off.dir, 'README.md'), '# r')
      writeFileSync(join(off.dir, 'CONTRIBUTING.md'), '# c')
      const r = run(off.dir, ['--json'])
      const j = JSON.parse(r.stdout)
      expect(j.totals.na).toBe(1) // docs/api conditional, overlay off
    } finally {
      off.cleanup()
    }
    const on = makeRepo(MANIFEST, 'overlays:\n  - has-api\n')
    try {
      writeFileSync(join(on.dir, 'README.md'), '# r')
      writeFileSync(join(on.dir, 'CONTRIBUTING.md'), '# c')
      const r = run(on.dir, ['--strict']) // docs/api now applies and is missing (conditional, not mandatory)
      const j = JSON.parse(run(on.dir, ['--json']).stdout)
      expect(j.totals.na).toBe(0)
      expect(r.status).toBe(0) // conditional gap is not a mandatory failure
    } finally {
      on.cleanup()
    }
  })

  it('--generate scaffolds a stub for a missing docs/*.md', () => {
    const { dir, cleanup } = makeRepo(MANIFEST)
    try {
      writeFileSync(join(dir, 'README.md'), '# r')
      writeFileSync(join(dir, 'CONTRIBUTING.md'), '# c')
      const r = run(dir, ['--generate'])
      expect(r.status).toBe(0)
      expect(existsSync(join(dir, 'docs', 'GLOSSARY.md'))).toBe(true)
      expect(r.stdout).toMatch(/scaffolded stub: docs\/GLOSSARY\.md/)
    } finally {
      cleanup()
    }
  })

  it('is deterministic — identical output for identical inputs', () => {
    const { dir, cleanup } = makeRepo(MANIFEST)
    try {
      writeFileSync(join(dir, 'README.md'), '# r')
      const a = run(dir, ['--json']).stdout
      const b = run(dir, ['--json']).stdout
      expect(a).toBe(b)
    } finally {
      cleanup()
    }
  })
})
