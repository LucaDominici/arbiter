import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-catalog-agents-parity.mjs')

function run(catalogPath: string, agentsPath: string) {
  const r = spawnSync('node', [SCRIPT, `--catalog=${catalogPath}`, `--agents=${agentsPath}`], {
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
  const dir = mkdtempSync(join(tmpdir(), 'canon08-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function makeCatalog(entries: string[] | Array<{ id: string; title: string }>): string {
  const items = entries.map((e) => {
    const id = typeof e === 'string' ? e : e.id
    const title = typeof e === 'string' ? `Default title for ${e}` : e.title
    return `  {\n    id: '${id}',\n    tier: 'governance',\n    title: '${title}',\n  }`
  })
  return items.join('\n')
}

function makeAgents(entries: string[] | Array<{ id: string; title: string }>): string {
  const lines = entries.map((e) =>
    typeof e === 'string' ? `- **${e}:** Default title for ${e}` : `- **${e.id}:** ${e.title}`,
  )
  return `## Invariants\n\n${lines.join('\n')}`
}

describe('check-catalog-agents-parity.mjs (INV-51 / CANON-08)', () => {
  it('exits 0 when all catalog IDs appear in AGENTS.md', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(catalog, makeCatalog(['INV-01', 'INV-02', 'INV-03']))
      writeFileSync(agents, makeAgents(['INV-01', 'INV-02', 'INV-03']))
      expect(run(catalog, agents).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a catalog ID is absent from AGENTS.md', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(catalog, makeCatalog(['INV-01', 'INV-02', 'INV-99']))
      writeFileSync(agents, makeAgents(['INV-01', 'INV-02']))
      const result = run(catalog, agents)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('INV-99')
    } finally {
      cleanup()
    }
  })

  it('exits 1 and lists all missing IDs', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(catalog, makeCatalog(['INV-01', 'INV-02', 'INV-03']))
      writeFileSync(agents, makeAgents(['INV-01']))
      const result = run(catalog, agents)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('INV-02')
      expect(result.stdout).toContain('INV-03')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when AGENTS.md has more IDs than catalog (superset is fine)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(catalog, makeCatalog(['INV-01']))
      writeFileSync(agents, makeAgents(['INV-01', 'INV-02']))
      expect(run(catalog, agents).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 and reports TITLE MISMATCH when title drifts from catalog', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(catalog, makeCatalog([{ id: 'INV-01', title: 'Canonical title' }]))
      writeFileSync(agents, makeAgents([{ id: 'INV-01', title: 'Drifted title' }]))
      const result = run(catalog, agents)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('INV-01')
      expect(result.stdout).toContain('TITLE')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when IDs and titles all match', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(
        catalog,
        makeCatalog([
          { id: 'INV-01', title: 'Exact title' },
          { id: 'INV-02', title: 'Another title' },
        ]),
      )
      writeFileSync(
        agents,
        makeAgents([
          { id: 'INV-01', title: 'Exact title' },
          { id: 'INV-02', title: 'Another title' },
        ]),
      )
      expect(run(catalog, agents).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('correctly extracts multi-line title (titlePending path)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(
        catalog,
        `  {\n    id: 'INV-36',\n    tier: 'governance',\n    title:\n      'Multi-line canonical title',\n  }`,
      )
      writeFileSync(agents, `## Invariants\n\n- **INV-36:** Multi-line canonical title`)
      expect(run(catalog, agents).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 2 when titlePending at EOF (malformed catalog)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      // id: present, title: keyword present, but no string value follows
      writeFileSync(catalog, `  {\n    id: 'INV-01',\n    tier: 'governance',\n    title:\n  }`)
      writeFileSync(agents, makeAgents(['INV-01']))
      const result = run(catalog, agents)
      expect(result.status).toBe(2)
    } finally {
      cleanup()
    }
  })

  it('passes against the real catalog and AGENTS.md', () => {
    const result = run(resolve('src/invariants/catalog.ts'), resolve('AGENTS.md'))
    expect(result.status).toBe(0)
  })
})
