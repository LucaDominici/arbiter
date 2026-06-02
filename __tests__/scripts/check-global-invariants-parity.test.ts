import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-global-invariants-parity.mjs')

function run(catalogPath: string, docPath: string) {
  const r = spawnSync('node', [SCRIPT, `--catalog=${catalogPath}`, `--doc=${docPath}`], {
    encoding: 'utf-8',
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ginv-parity-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// alwaysActive: true must be on its OWN line after id: (parser skips same-line)
function makeCatalog(entries: Array<{ id: string; alwaysActive?: boolean }>): string {
  return entries
    .map(
      (e) =>
        `  {\n    id: '${e.id}',\n    tier: 'governance',\n    title: 'title for ${e.id}',\n${e.alwaysActive ? '    alwaysActive: true,\n' : ''}  }`,
    )
    .join('\n')
}

function makeDoc(ids: string[]): string {
  return ids.map((id) => `### ${id}: some description\n`).join('\n')
}

describe('check-global-invariants-parity.mjs (always-active INV ↔ doc parity)', () => {
  it('exits 0 when all always-active INVs are documented', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const doc = join(dir, 'GLOBAL_INVARIANTS.md')
      writeFileSync(catalog, makeCatalog([{ id: 'INV-01', alwaysActive: true }]))
      writeFileSync(doc, makeDoc(['INV-01']))
      expect(run(catalog, doc).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an always-active INV is missing from the doc', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const doc = join(dir, 'GLOBAL_INVARIANTS.md')
      writeFileSync(catalog, makeCatalog([{ id: 'INV-99', alwaysActive: true }]))
      writeFileSync(doc, '# no INV-99 here\n')
      const result = run(catalog, doc)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-99')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a documented INV has no catalog entry (phantom)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const doc = join(dir, 'GLOBAL_INVARIANTS.md')
      writeFileSync(catalog, makeCatalog([{ id: 'INV-01', alwaysActive: true }]))
      writeFileSync(doc, makeDoc(['INV-01', 'INV-99']))
      const result = run(catalog, doc)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-99')
    } finally {
      cleanup()
    }
  })

  it('exits 2 when catalog file cannot be read (fail-closed, INV-53)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const doc = join(dir, 'GLOBAL_INVARIANTS.md')
      writeFileSync(doc, '# empty\n')
      const result = run(join(dir, 'nonexistent.ts'), doc)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('cannot read input')
    } finally {
      cleanup()
    }
  })

  it('exits 0 for non-alwaysActive INVs even when absent from doc', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const doc = join(dir, 'GLOBAL_INVARIANTS.md')
      writeFileSync(catalog, makeCatalog([{ id: 'INV-01', alwaysActive: false }]))
      writeFileSync(doc, '# no INV-01 here\n')
      expect(run(catalog, doc).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('passes against the real catalog and GLOBAL_INVARIANTS.md', () => {
    const result = run(resolve('src/invariants/catalog.ts'), resolve('GLOBAL_INVARIANTS.md'))
    expect(result.status).toBe(0)
  })
})
