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

describe('check-global-invariants-parity.mjs — PROJ-NN project invariants (#2035, TC-4)', () => {
  function runWithConfig(catalogPath: string, docPath: string, configPath: string | null) {
    const args = [SCRIPT, `--catalog=${catalogPath}`, `--doc=${docPath}`]
    if (configPath !== null) args.push(`--config=${configPath}`)
    const r = spawnSync('node', args, { encoding: 'utf-8' })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  function makeConfig(projectInvariants: unknown[]): string {
    return JSON.stringify({ governance: { projectInvariants } }, null, 2)
  }

  it('accepts PROJ sections in the doc without --config (arbiter-internal invocation)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const doc = join(dir, 'GLOBAL_INVARIANTS.md')
      writeFileSync(catalog, makeCatalog([{ id: 'INV-01', alwaysActive: true }]))
      writeFileSync(doc, '### INV-01: documented\n### PROJ-01: project rule\n')
      expect(runWithConfig(catalog, doc, null).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails when an always-active declared PROJ is missing from the doc (--config)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const doc = join(dir, 'GLOBAL_INVARIANTS.md')
      const config = join(dir, 'arbiter.json')
      writeFileSync(catalog, makeCatalog([{ id: 'INV-01', alwaysActive: true }]))
      writeFileSync(doc, '### INV-01: documented\n')
      writeFileSync(
        config,
        makeConfig([
          {
            id: 'PROJ-01',
            tier: 'governance',
            title: 'product rule',
            description: 'x',
            alwaysActive: true,
          },
        ]),
      )
      const result = runWithConfig(catalog, doc, config)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('PROJ-01')
    } finally {
      cleanup()
    }
  })

  it('fails when the doc carries a PROJ section not declared in the config (--config)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const doc = join(dir, 'GLOBAL_INVARIANTS.md')
      const config = join(dir, 'arbiter.json')
      writeFileSync(catalog, makeCatalog([{ id: 'INV-01', alwaysActive: true }]))
      writeFileSync(doc, '### INV-01: documented\n### PROJ-99: stale project rule\n')
      writeFileSync(config, makeConfig([]))
      const result = runWithConfig(catalog, doc, config)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('PROJ-99')
    } finally {
      cleanup()
    }
  })

  it('passes when declared PROJ invariants are all documented (--config)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const doc = join(dir, 'GLOBAL_INVARIANTS.md')
      const config = join(dir, 'arbiter.json')
      writeFileSync(catalog, makeCatalog([{ id: 'INV-01', alwaysActive: true }]))
      writeFileSync(doc, '### INV-01: documented\n### PROJ-01: project rule\n')
      writeFileSync(
        config,
        makeConfig([
          {
            id: 'PROJ-01',
            tier: 'governance',
            title: 'product rule',
            description: 'x',
            alwaysActive: true,
          },
        ]),
      )
      expect(runWithConfig(catalog, doc, config).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 2 when --config points at a missing or malformed file', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const doc = join(dir, 'GLOBAL_INVARIANTS.md')
      writeFileSync(catalog, makeCatalog([{ id: 'INV-01', alwaysActive: true }]))
      writeFileSync(doc, '### INV-01: documented\n')
      expect(runWithConfig(catalog, doc, join(dir, 'missing.json')).status).toBe(2)
      const bad = join(dir, 'arbiter.json')
      writeFileSync(bad, '{ not json')
      expect(runWithConfig(catalog, doc, bad).status).toBe(2)
    } finally {
      cleanup()
    }
  })
})
