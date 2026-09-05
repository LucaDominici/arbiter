import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-catalog-agents-parity.mjs')

function run(catalogPath: string, agentsPath: string, canonPath?: string) {
  const argv = [SCRIPT, `--catalog=${catalogPath}`, `--agents=${agentsPath}`]
  if (canonPath) argv.push(`--canon=${canonPath}`)
  const r = spawnSync('node', argv, {
    encoding: 'utf-8',
    cwd: resolve('.'),
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeCanon(ids: string[]): string {
  const heading = '# Canon\n\n'
  return heading + ids.map((id) => `## ${id} — placeholder rule\n`).join('\n')
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

// #2513: a "collapsed" entry has id and title on the SAME source line — exactly
// what a routine prettier pass produces for a short object literal. This is the
// shape the parity check must not go blind on.
function makeCollapsedCatalog(entries: Array<{ id: string; title: string }>): string {
  return entries
    .map((e) => `  { id: '${e.id}', tier: 'governance', title: '${e.title}' },`)
    .join('\n')
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

  it('exits 1 and reports ORPHAN when AGENTS.md has an INV-NN missing from catalog (#485)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(catalog, makeCatalog(['INV-01']))
      writeFileSync(agents, makeAgents(['INV-01', 'INV-99']))
      const result = run(catalog, agents)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ORPHAN in AGENTS.md')
      expect(result.stdout).toContain('INV-99')
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

  it('multi-line title with embedded apostrophe in double-quoted form parses correctly (#486)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      const trickyTitle = "Every 'proven' language must have a nightly fixture"
      writeFileSync(
        catalog,
        `  {\n    id: 'INV-32',\n    tier: 'governance',\n    title:\n      "${trickyTitle}",\n  }`,
      )
      writeFileSync(agents, `## Invariants\n\n- **INV-32:** ${trickyTitle}`)
      const result = run(catalog, agents)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('multi-line title with embedded double quotes in single-quoted form parses correctly (#486)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      const trickyTitle = 'Title containing "quoted" segment'
      writeFileSync(
        catalog,
        `  {\n    id: 'INV-33',\n    tier: 'governance',\n    title:\n      '${trickyTitle}',\n  }`,
      )
      writeFileSync(agents, `## Invariants\n\n- **INV-33:** ${trickyTitle}`)
      const result = run(catalog, agents)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 and reports ORPHAN for **CANON-NN:** absent from CANON.md (#485)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      const canon = join(dir, 'CANON.md')
      writeFileSync(catalog, makeCatalog(['INV-01']))
      writeFileSync(
        agents,
        `## Invariants\n\n- **INV-01:** Default title for INV-01\n\n## Canon refs\n\n- **CANON-01:** existing\n- **CANON-99:** phantom`,
      )
      writeFileSync(canon, makeCanon(['CANON-01']))
      const result = run(catalog, agents, canon)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ORPHAN in AGENTS.md')
      expect(result.stdout).toContain('CANON-99')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when CANON.md and AGENTS.md CANON-NN sets are exact match (#485 happy path)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      const canon = join(dir, 'CANON.md')
      writeFileSync(catalog, makeCatalog(['INV-01']))
      writeFileSync(
        agents,
        `## Invariants\n\n- **INV-01:** Default title for INV-01\n\n## Canon refs\n\n- **CANON-01:** placeholder rule\n- **CANON-02:** placeholder rule\n- **CANON-03:** placeholder rule`,
      )
      writeFileSync(canon, makeCanon(['CANON-01', 'CANON-02', 'CANON-03']))
      expect(run(catalog, agents, canon).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  // RED tests: prove the vacuous CANON forward-loop (#1148 Slice A)
  // These MUST fail against the current vacuous gate before the fix is applied.

  it('exits 1 when CANON.md heading absent from AGENTS.md [FORWARD GAP #1148]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      const canon = join(dir, 'CANON.md')
      writeFileSync(catalog, makeCatalog(['INV-01']))
      writeFileSync(agents, makeAgents(['INV-01']))
      writeFileSync(canon, makeCanon(['CANON-99']))
      // CANON-99 is in CANON.md but NOT in AGENTS.md — must fail with MISSING
      const result = run(catalog, agents, canon)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('MISSING from AGENTS.md: CANON-99')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when multiple CANON.md headings absent from AGENTS.md (all reported)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      const canon = join(dir, 'CANON.md')
      writeFileSync(catalog, makeCatalog(['INV-01']))
      writeFileSync(agents, makeAgents(['INV-01']))
      writeFileSync(canon, makeCanon(['CANON-01', 'CANON-02', 'CANON-03']))
      // AGENTS.md has zero CANON rows — all 3 must be reported MISSING
      const result = run(catalog, agents, canon)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('MISSING from AGENTS.md: CANON-01')
      expect(result.stdout).toContain('MISSING from AGENTS.md: CANON-02')
      expect(result.stdout).toContain('MISSING from AGENTS.md: CANON-03')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when CANON.md headings all present in AGENTS.md (forward parity satisfied)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      const canon = join(dir, 'CANON.md')
      writeFileSync(catalog, makeCatalog(['INV-01']))
      writeFileSync(
        agents,
        `## Invariants\n\n- **INV-01:** Default title for INV-01\n\n## Canon\n\n- **CANON-01:** placeholder rule\n- **CANON-02:** placeholder rule`,
      )
      writeFileSync(canon, makeCanon(['CANON-01', 'CANON-02']))
      expect(run(catalog, agents, canon).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 and reports CANON TITLE MISMATCH when AGENTS.md CANON title drifts [#1158]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      const canon = join(dir, 'CANON.md')
      writeFileSync(catalog, makeCatalog(['INV-01']))
      // CANON-01 present in both, but the AGENTS.md title drifts from CANON.md.
      writeFileSync(
        agents,
        `## Invariants\n\n- **INV-01:** Default title for INV-01\n\n## Canon\n\n- **CANON-01:** drifted title`,
      )
      writeFileSync(canon, makeCanon(['CANON-01']))
      const result = run(catalog, agents, canon)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('CANON TITLE MISMATCH: CANON-01')
    } finally {
      cleanup()
    }
  })

  // #1570: retired tombstones (status: 'retired') are kept in the catalog for
  // ID-stability but must NOT be required as live rows in AGENTS.md, and must not
  // be flagged as orphans if a tombstone row is left behind.
  function retiredEntry(id: string, title: string): string {
    return `  {\n    id: '${id}',\n    tier: 'governance',\n    title: '${title}',\n    status: 'retired',\n  }`
  }

  it('exits 0 when a retired catalog entry is absent from AGENTS.md (#1570)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(catalog, `${makeCatalog(['INV-01'])}\n${retiredEntry('INV-56', 'Dead rule')}`)
      // AGENTS.md omits the retired INV-56 — must NOT fail with MISSING.
      writeFileSync(agents, makeAgents(['INV-01']))
      expect(run(catalog, agents).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a retired catalog entry is still present in AGENTS.md (not orphaned) (#1570)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(catalog, `${makeCatalog(['INV-01'])}\n${retiredEntry('INV-56', 'Dead rule')}`)
      writeFileSync(
        agents,
        makeAgents([{ id: 'INV-01', title: 'Default title for INV-01' }, 'INV-56']),
      )
      expect(run(catalog, agents).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  // #2513: a catalog entry whose `id` and `title` sit on the SAME source line
  // (exactly what prettier produces when it collapses a short object literal)
  // must not go invisible to the parser. Before the fix, the line-scanner
  // recorded currentId and `continue`d to the NEXT line looking for a title
  // that was already consumed — so the entry never made it into
  // catalogEntries at all, and both the forward AND reverse checks went blind
  // to it.

  it('exits non-zero when a collapsed (same-line id+title) entry is missing from AGENTS.md [#2513 silent hole]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(
        catalog,
        `${makeCatalog(['INV-01'])}\n${makeCollapsedCatalog([{ id: 'INV-02', title: 'second rule' }])}`,
      )
      // AGENTS.md omits INV-02 entirely — the collapsed entry must still be
      // caught as MISSING, not silently dropped from catalogEntries.
      writeFileSync(agents, makeAgents(['INV-01']))
      const result = run(catalog, agents)
      expect(result.status).not.toBe(0)
      expect(result.stdout).toContain('INV-02')
    } finally {
      cleanup()
    }
  })

  it('exits non-zero when a collapsed entry is present in AGENTS.md with the WRONG title [#2513]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(
        catalog,
        `${makeCatalog(['INV-01'])}\n${makeCollapsedCatalog([{ id: 'INV-02', title: 'second rule' }])}`,
      )
      writeFileSync(
        agents,
        makeAgents([
          { id: 'INV-01', title: 'Default title for INV-01' },
          { id: 'INV-02', title: 'a completely different title' },
        ]),
      )
      const result = run(catalog, agents)
      expect(result.status).not.toBe(0)
      expect(result.stdout).toContain('TITLE MISMATCH: INV-02')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a collapsed entry is present in AGENTS.md with the correct title [#2513 no false positive]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(
        catalog,
        `${makeCatalog(['INV-01'])}\n${makeCollapsedCatalog([{ id: 'INV-02', title: 'second rule' }])}`,
      )
      writeFileSync(
        agents,
        makeAgents([
          { id: 'INV-01', title: 'Default title for INV-01' },
          { id: 'INV-02', title: 'second rule' },
        ]),
      )
      expect(run(catalog, agents).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits non-zero and names the unaccounted id when the catalog holds an id the parser cannot extract a title for [#2513 vacuity guard]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      // INV-77's title uses a template-literal string (backticks) — a form
      // neither the same-line nor multi-line title regex recognizes, and
      // which also never triggers the `title:\s*$` lookahead (since content
      // follows "title:" on the same line). The id IS present in the source,
      // but the entry silently never lands in catalogEntries — and AGENTS.md
      // deliberately omits INV-77 too, so the pre-fix reverse-orphan check
      // has nothing to accidentally catch this on: only an explicit
      // programme-membership check (comparing catalogEntries against every
      // `id: 'INV-NN'` occurrence in the source) can catch this. Without it,
      // the gate would report a confident OK on a short-counted set.
      writeFileSync(
        catalog,
        `${makeCatalog(['INV-01'])}\n  { id: 'INV-77', tier: 'governance', title: \`Backtick title\` },`,
      )
      writeFileSync(agents, makeAgents(['INV-01']))
      const result = run(catalog, agents)
      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toContain('INV-77')
    } finally {
      cleanup()
    }
  })

  it('exits 0 with mixed multi-line and collapsed formatting all consistent with AGENTS.md [#2513]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const agents = join(dir, 'AGENTS.md')
      writeFileSync(
        catalog,
        [
          makeCatalog([{ id: 'INV-01', title: 'Exact title' }]),
          makeCollapsedCatalog([{ id: 'INV-02', title: 'second rule' }]),
          `  {\n    id: 'INV-03',\n    tier: 'governance',\n    title:\n      'Multi-line title',\n  }`,
          makeCollapsedCatalog([{ id: 'INV-04', title: 'fourth rule' }]),
        ].join('\n'),
      )
      writeFileSync(
        agents,
        makeAgents([
          { id: 'INV-01', title: 'Exact title' },
          { id: 'INV-02', title: 'second rule' },
          { id: 'INV-03', title: 'Multi-line title' },
          { id: 'INV-04', title: 'fourth rule' },
        ]),
      )
      expect(run(catalog, agents).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('passes against the real catalog and AGENTS.md', () => {
    const result = run(resolve('src/invariants/catalog.ts'), resolve('AGENTS.md'))
    expect(result.status).toBe(0)
  })

  it('passes against the real catalog, AGENTS.md, and CANON.md (bidirectional)', () => {
    const result = run(
      resolve('src/invariants/catalog.ts'),
      resolve('AGENTS.md'),
      resolve('docs/internal/SYSTEM/CANON.md'),
    )
    expect(result.status).toBe(0)
  })
})
