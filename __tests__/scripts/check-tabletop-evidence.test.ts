// SPDX-License-Identifier: Apache-2.0
// CATALOG: gate: scripts/check-tabletop-evidence.mjs (L1)
// CATALOG: Red phase: every test FAILS until scripts/check-tabletop-evidence.mjs exists.
//
// #2429 — the tabletop evidence gate. A tabletop is high-recall/low-precision by design, so
// it only pays for itself if every blocker/major finding terminates in an owner (an issue ref
// or `fixed:<sha>`). This gate is that terminator: frontmatter must satisfy
// schemas/tabletop-evidence.schema.json, the findings table must parse into the seven
// declared columns, and an unowned blocker/major fails the build.
import { describe, it, expect } from 'vitest'
import {
  parseScenarios,
  scenarioViolations,
  joinViolations,
} from '../../scripts/check-tabletop-evidence.mjs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-tabletop-evidence.mjs')
const EVIDENCE_REL = '.arbiter/evidence/tabletop'

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function stage(files: Record<string, string> | null): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tabletop-evidence-'))
  if (files !== null) {
    mkdirSync(join(dir, EVIDENCE_REL), { recursive: true })
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, EVIDENCE_REL, name), body)
    }
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const HEADER = [
  '| step | doc claim (path:line) | observed | severity | class | proposed permanent check | owner |',
  '| --- | --- | --- | --- | --- | --- | --- |',
].join('\n')

function evidence(rows: string[], counts = { blocker: 0, major: 1, minor: 1 }): string {
  return [
    '---',
    'scenario: greenfield-init-ts',
    'sha: 8c24ef4a1b2c3d4e5f60718293a4b5c6d7e8f900',
    'date: 2026-08-29',
    'persona: TypeScript library author installing arbiter for the first time',
    'steps: 3',
    'findings:',
    `  blocker: ${counts.blocker}`,
    `  major: ${counts.major}`,
    `  minor: ${counts.minor}`,
    '---',
    '',
    '# Tabletop — greenfield-init-ts',
    '',
    HEADER,
    ...rows,
    '',
  ].join('\n')
}

const OWNED_MAJOR =
  '| 2 | docs/QUICKSTART.md:12 | init prints no next step | major | doc-drift | assert the next-step banner in the init smoke test | #2429 |'
const MINOR =
  '| 3 | README.md:40 | wizard label reads "level" not "governance level" | minor | ux | none — cosmetic | — |'

describe('check-tabletop-evidence (#2429)', () => {
  it('passes vacuously when the evidence directory does not exist', () => {
    const { dir, cleanup } = stage(null)
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.out).toMatch(/OK|SKIP/)
    } finally {
      cleanup()
    }
  })

  it('passes vacuously when the evidence directory is empty', () => {
    const { dir, cleanup } = stage({})
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('accepts a well-formed evidence file with owned findings', () => {
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([OWNED_MAJOR, MINOR]),
    })
    try {
      const r = run(dir)
      expect(r.out).toContain('OK')
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('accepts `fixed:<sha>` as an owner', () => {
    const fixed = OWNED_MAJOR.replace('| #2429 |', '| fixed:8c24ef4a |')
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': evidence([fixed, MINOR]) })
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails on a blocker finding with no owner', () => {
    const unowned = OWNED_MAJOR.replace('| major |', '| blocker |').replace('| #2429 |', '|  |')
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([unowned, MINOR], {
        blocker: 1,
        major: 0,
        minor: 1,
      }),
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('owner')
    } finally {
      cleanup()
    }
  })

  it('fails on a major finding whose owner cell is a bare em-dash', () => {
    const unowned = OWNED_MAJOR.replace('| #2429 |', '| — |')
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([unowned, MINOR]),
    })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails on frontmatter missing a schema-required key', () => {
    const bad = evidence([OWNED_MAJOR, MINOR]).replace(/^persona: .*\n/m, '')
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': bad })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('persona')
    } finally {
      cleanup()
    }
  })

  it('fails on a file with no frontmatter at all', () => {
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': `# nope\n\n${HEADER}\n` })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails when the findings table header does not carry the seven declared columns', () => {
    const body = evidence([OWNED_MAJOR, MINOR]).replace('| owner |', '|')
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': body })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails when the frontmatter counts disagree with the table rows', () => {
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([OWNED_MAJOR, MINOR], {
        blocker: 0,
        major: 3,
        minor: 1,
      }),
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('major')
    } finally {
      cleanup()
    }
  })

  it('finds the findings table past an unrelated seven-column table in the narrative', () => {
    const decoy = [
      '| a | b | c | d | e | f | g |',
      '| - | - | - | - | - | - | - |',
      '| 1 | 2 | 3 | 4 | 5 | 6 | 7 |',
      '',
    ].join('\n')
    const body = evidence([OWNED_MAJOR, MINOR]).replace(
      '# Tabletop — greenfield-init-ts\n',
      `# Tabletop — greenfield-init-ts\n\n${decoy}`,
    )
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': body })
    try {
      const r = run(dir)
      expect(r.out).toContain('OK')
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('accepts a clean tabletop: header, separator, and no findings rows', () => {
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([], { blocker: 0, major: 0, minor: 0 }),
    })
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails when the findings table has no separator row under its header', () => {
    const body = evidence([OWNED_MAJOR, MINOR]).replace(
      '| --- | --- | --- | --- | --- | --- | --- |\n',
      '',
    )
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': body })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('separator')
    } finally {
      cleanup()
    }
  })

  it('reports only the schema error when `findings` is a scalar, not three count mismatches', () => {
    const body = evidence([OWNED_MAJOR, MINOR]).replace(
      ['findings:', '  blocker: 0', '  major: 1', '  minor: 1'].join('\n'),
      'findings: 2',
    )
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': body })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('findings: expected an object')
      expect(r.out).not.toContain('frontmatter says undefined')
    } finally {
      cleanup()
    }
  })

  it('fails on an unknown severity or class value', () => {
    const badClass = MINOR.replace('| ux |', '| vibes |')
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([OWNED_MAJOR, badClass]),
    })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })
})

/**
 * TT-NN (#2480 wave 8) — the catalogue half, and the join.
 *
 * The evidence was schema'd from the start; the scenario DEFINITIONS were prose, guarded only by a
 * hand-maintained slug list in a test that no governed project ever received. The rule that could
 * not exist while that was true is the join: an evidence file naming a scenario nothing declares.
 */
const SCENARIOS_REL = 'docs/internal/METHOD/TABLETOP-SCENARIOS.md'

function scenarioBlock(over: Partial<Record<string, string>> = {}): string {
  const f: Record<string, string> = {
    heading: '## 1. A scenario',
    Id: '`TT-01`',
    Slug: '`a-scenario`',
    Persona: 'someone',
    'Starting state': 'a repo',
    Goal: 'get somewhere',
    'Docs the user would read': '`README.md`',
    'Executable probes': 'run the thing',
    'Exit criterion': 'it worked',
    ...over,
  }
  const { heading, ...fields } = f
  return [heading, '', ...Object.entries(fields).map(([k, v]) => `- **${k}:** ${v}`), ''].join('\n')
}

describe('parseScenarios', () => {
  it('reads the id and slug out of their backticks', () => {
    const [s] = parseScenarios(scenarioBlock())
    expect(s.id).toBe('TT-01')
    expect(s.slug).toBe('a-scenario')
    expect(s.heading).toBe('1. A scenario')
    expect(s.missing).toEqual([])
  })

  it('names exactly the fields that are absent', () => {
    const text = scenarioBlock().replace(/^- \*\*Persona:\*\*.*$/m, '')
    expect(parseScenarios(text)[0].missing).toEqual(['Persona'])
  })

  it('splits on the numbered heading only, so a plain ## section is not a scenario', () => {
    const text = `${scenarioBlock()}\n## Notes\n\nprose\n`
    expect(parseScenarios(text)).toHaveLength(1)
  })

  it('returns nothing for a document with no scenario blocks', () => {
    expect(parseScenarios('# Title\n\nprose only\n')).toEqual([])
  })
})

describe('scenarioViolations', () => {
  it('is silent on a well-formed catalogue', () => {
    const text =
      scenarioBlock() +
      scenarioBlock({ heading: '## 2. Another', Id: '`TT-02`', Slug: '`another-one`' })
    expect(scenarioViolations(parseScenarios(text))).toEqual([])
  })

  it('reports a duplicate id, naming the scenario that already holds it', () => {
    const text =
      scenarioBlock() + scenarioBlock({ heading: '## 2. Another', Slug: '`another-one`' })
    expect(scenarioViolations(parseScenarios(text))[0]).toMatch(
      /id TT-01 is already used by "1\. A scenario"/,
    )
  })

  it('reports a duplicate slug — the evidence filename convention would be ambiguous', () => {
    const text = scenarioBlock() + scenarioBlock({ heading: '## 2. Another', Id: '`TT-02`' })
    expect(scenarioViolations(parseScenarios(text))[0]).toMatch(/slug "a-scenario" is already used/)
  })

  it.each([['T1'], ['TT-1'], ['tt-01'], ['TT-001']])('rejects the off-pattern id %s', (id) => {
    const found = scenarioViolations(parseScenarios(scenarioBlock({ Id: `\`${id}\`` })))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/does not match \^TT-\[0-9\]\{2\}\$/)
  })

  it.each([['Not_Kebab'], ['has spaces'], ['-leading'], ['trailing-'], ['double--dash']])(
    'rejects the non-kebab slug %s',
    (slug) => {
      const found = scenarioViolations(parseScenarios(scenarioBlock({ Slug: `\`${slug}\`` })))
      expect(found).toHaveLength(1)
      expect(found[0]).toMatch(/is not kebab-case/)
    },
  )

  it('reports a missing field without also inventing an id or slug complaint', () => {
    const text = scenarioBlock().replace(/^- \*\*Goal:\*\*.*$/m, '')
    const found = scenarioViolations(parseScenarios(text))
    expect(found).toEqual(['scenario "1. A scenario": missing field(s) Goal'])
  })
})

describe('joinViolations — evidence must name a declared scenario', () => {
  const declared = parseScenarios(scenarioBlock())

  it('reports evidence for a scenario the catalogue does not declare', () => {
    const found = joinViolations([{ file: 'e/x.md', scenario: 'ghost-scenario' }], declared)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('scenario "ghost-scenario" is not declared')
  })

  it('is silent when the slug resolves', () => {
    expect(joinViolations([{ file: 'e/x.md', scenario: 'a-scenario' }], declared)).toEqual([])
  })

  it('leaves a missing or non-string scenario to the schema rather than reporting it twice', () => {
    const claims = [
      { file: 'e/a.md', scenario: undefined },
      { file: 'e/b.md', scenario: '' },
      { file: 'e/c.md', scenario: 7 },
    ]
    expect(joinViolations(claims, declared)).toEqual([])
  })

  it('catches the rename case — the reason the join exists', () => {
    const renamed = parseScenarios(scenarioBlock({ Slug: '`a-scenario-v2`' }))
    expect(joinViolations([{ file: 'e/x.md', scenario: 'a-scenario' }], renamed)).toHaveLength(1)
  })
})

describe('the catalogue half as invoked', () => {
  const CATALOGUE_DIR = 'docs/internal/METHOD'

  function stageWith(catalogue: string | null, evidenceFiles: Record<string, string> = {}) {
    const staged = stage(evidenceFiles)
    if (catalogue !== null) {
      mkdirSync(join(staged.dir, CATALOGUE_DIR), { recursive: true })
      writeFileSync(join(staged.dir, SCENARIOS_REL), catalogue)
    }
    return staged
  }

  it('exits 1 and names the catalogue when a definition is malformed', () => {
    const { dir, cleanup } = stageWith(scenarioBlock({ Id: '`nope`' }))
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain(SCENARIOS_REL)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when evidence names an undeclared scenario, even though the evidence itself is valid', () => {
    const { dir, cleanup } = stageWith(scenarioBlock({ Slug: '`something-else`' }), {
      'greenfield-init-ts-2026-08-29.md': evidence([OWNED_MAJOR, MINOR]),
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/is not declared in/)
    } finally {
      cleanup()
    }
  })

  it('passes when the catalogue declares the slug the evidence claims', () => {
    const { dir, cleanup } = stageWith(scenarioBlock({ Slug: '`greenfield-init-ts`' }), {
      'greenfield-init-ts-2026-08-29.md': evidence([OWNED_MAJOR, MINOR]),
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.out).toContain('1 scenario(s) declared')
    } finally {
      cleanup()
    }
  })

  it('skips the join and says so when there is no catalogue — a project need not seed one', () => {
    const { dir, cleanup } = stageWith(null, {
      'greenfield-init-ts-2026-08-29.md': evidence([OWNED_MAJOR, MINOR]),
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.out).toContain('join skipped')
    } finally {
      cleanup()
    }
  })

  it('reports the catalogue defect BEFORE reading evidence — a broken catalogue makes the join meaningless', () => {
    const { dir, cleanup } = stageWith(scenarioBlock({ Id: '`nope`' }), {
      'ghost-2026-08-29.md': evidence([OWNED_MAJOR, MINOR]),
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).not.toMatch(/is not declared in/)
    } finally {
      cleanup()
    }
  })
})
