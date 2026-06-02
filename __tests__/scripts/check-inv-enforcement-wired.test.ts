import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-inv-enforcement-wired.mjs')

function run(catalogPath: string, gatePath: string) {
  const r = spawnSync('node', [SCRIPT, `--catalog=${catalogPath}`, `--gate=${gatePath}`], {
    encoding: 'utf-8',
    cwd: resolve('.'),
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'canon09-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-inv-enforcement-wired.mjs (INV-52 / CANON-09)', () => {
  it('exits 0 when all catalog enforcement scripts are wired in gate', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(catalog, `{ id: "INV-01", enforcement: "scripts/check-foo.mjs" }`)
      writeFileSync(gate, `runCheck("foo", "node", ["scripts/check-foo.mjs"])`)
      expect(run(catalog, gate).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an enforcement script is absent from gate', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(catalog, `{ id: "INV-01", enforcement: "scripts/check-missing.mjs" }`)
      writeFileSync(gate, `runCheck("other", "node", ["scripts/check-other.mjs"])`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('check-missing.mjs')
    } finally {
      cleanup()
    }
  })

  it('ignores check-all.mjs self-reference in catalog', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      // catalog references check-all.mjs itself — should not trigger failure
      writeFileSync(catalog, `{ id: "INV-XX", enforcement: "scripts/check-all.mjs" }`)
      writeFileSync(gate, `// gate file with no other scripts`)
      expect(run(catalog, gate).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('reports all missing scripts, not just the first', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(catalog, `{ enforcement: "scripts/check-a.mjs + scripts/check-b.mjs" }`)
      writeFileSync(gate, `// empty gate`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('check-a.mjs')
      expect(result.stdout).toContain('check-b.mjs')
    } finally {
      cleanup()
    }
  })

  // RED tests: prove the CANON-09 blind spot (#1148 Slice A)
  // These MUST fail against the old regex before the fix is applied.

  it('exits 1 when enforcement cites a non-check- script absent from gate [EXPLOIT #1148]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(
        catalog,
        `  id: 'INV-99',\n  enforcement: 'scripts/verify-fake.mjs (L1 fail-closed)',`,
      )
      writeFileSync(gate, `// gate with no scripts`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('verify-fake.mjs')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when enforcement cites a digit-containing script absent from gate [EXPLOIT #1148]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(catalog, `  id: 'INV-99',\n  enforcement: 'scripts/check-inv-42.mjs (L1)',`)
      writeFileSync(gate, `// gate with no scripts`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('check-inv-42.mjs')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when enforcement cites a .mjs.ejs Track-B template ((?!\\.ejs) lookahead guards)', () => {
    // Use a script name NOT in TRACK_B_EXEMPT so only the lookahead prevents the false positive.
    // Removing (?!\.ejs) from the regex would match check-generated-thing.mjs → exit 1.
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(
        catalog,
        `  id: 'INV-44',\n  enforcement: 'src/templates/scripts/check-generated-thing.mjs.ejs',`,
      )
      writeFileSync(gate, `// gate with no scripts`)
      expect(run(catalog, gate).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('passes against the real catalog and check-all.mjs', () => {
    const result = run(resolve('src/invariants/catalog.ts'), resolve('scripts/check-all.mjs'))
    expect(result.status).toBe(0)
  })
})
