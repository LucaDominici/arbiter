// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-runbook-coverage.mjs (INV-148, #2480 wave 8).
 *
 * What the gate must prove, and therefore what is asserted here:
 *   - runbooks are found by their DECLARED frontmatter tags, never by grepping the body. This is
 *     the first case in the file because it is the defect the naive implementation has:
 *     docs/GOVERNANCE.md and docs/INDEX.md both contain the literal string `kind/runbook` while
 *     merely listing tags, and a grep makes the gate's first finding its own false positive;
 *   - every runbook carries a unique RB-NN canonical_id and a non-empty `handles:` whose every
 *     invariant id resolves in the catalog — a dangling ref reads as coverage and covers nothing;
 *   - the uncovered-operational count is a RATCHET, not a rule. There are 49 operational
 *     invariants and two runbooks; a hard rule here would be red on arrival and baselined into
 *     meaninglessness, so the ratchet is what keeps the debt visible and bounded instead;
 *   - exit codes obey INV-53 — 1 means a runbook is wrong, 2 means the gate could not tell, and
 *     conflating them files an unreadable baseline as an operational-readiness finding.
 *
 * Existing Code Survey (CANON-16): grepped `handles`, `runbook` and `kind/runbook` across scripts/
 * and src/. check-doc-style.mjs validates the frontmatter SHAPE every hand-authored doc shares and
 * was extended in preference to a new parser where possible — its 15-line reader is mirrored here
 * rather than a YAML engine added (I1-equivalent restraint). No existing gate reads a
 * kind-specific frontmatter field or resolves refs into the invariant catalog:
 * check-inv-enforcement-wired.mjs proves an invariant's enforcement SCRIPT is wired, which is the
 * opposite direction — what runs automatically, versus what a human does once it has fired. New
 * gate justified; the walker (scripts/lib/glob-walk.mjs) and the main-module guard
 * (scripts/lib/run-helpers.mjs) are reused rather than reimplemented.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  parseFrontmatter,
  isRunbook,
  parseHandles,
  collectRunbooks,
  runbookViolations,
  operationalInvariants,
  uncoveredOperational,
  runbookProjection,
} from '../../scripts/check-runbook-coverage.mjs'

const REPO_ROOT = join(__dirname, '..', '..')
const GATE = join(REPO_ROOT, 'scripts', 'check-runbook-coverage.mjs')

const CATALOG = `export const INVARIANT_CATALOG = [
  {
    id: 'INV-01',
    tier: 'architectural',
  },
  {
    id: 'INV-16',
    tier: 'operational',
  },
  {
    id: 'INV-17',
    tier: 'operational',
  },
  {
    id: 'INV-74',
    tier: 'security',
  },
]
`

function doc(fields: Record<string, string>, body = '# Title\n'): string {
  const head = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  return `---\n${head}\n---\n\n${body}`
}

const RUNBOOK = {
  title: "'A runbook'",
  doc_version: "'1.0.0'",
  status: 'active',
  last_review: "'2026-01-01'",
  owner: "''",
  canonical_id: "'RB-01'",
  tags: "['audience/ops', 'kind/runbook']",
  handles: '[INV-16]',
  related: '[]',
}

describe('parseFrontmatter', () => {
  it('reads keys and strips the surrounding quotes', () => {
    const kv = parseFrontmatter(doc(RUNBOOK))
    expect(kv?.get('canonical_id')).toBe('RB-01')
  })

  it('reads an empty quoted value as empty, not as the two-character string "\'\'"', () => {
    const kv = parseFrontmatter(doc({ ...RUNBOOK, canonical_id: "''" }))
    expect(kv?.get('canonical_id')).toBe('')
  })

  it('returns null for a document with no frontmatter block', () => {
    expect(parseFrontmatter('# Just a heading\n')).toBeNull()
  })

  it('returns null when the block is never closed', () => {
    expect(parseFrontmatter('---\ntitle: x\n\n# body\n')).toBeNull()
  })
})

describe('isRunbook — declared tags, never a grep', () => {
  it('accepts a doc whose tags include kind/runbook', () => {
    expect(isRunbook(parseFrontmatter(doc(RUNBOOK)))).toBe(true)
  })

  it('rejects a doc that merely MENTIONS the tag in its body — the false positive that motivated the rule', () => {
    const mentions = doc(
      { ...RUNBOOK, tags: "['kind/reference']" },
      '# Index\n\nTags: kind/runbook\n',
    )
    expect(isRunbook(parseFrontmatter(mentions))).toBe(false)
  })

  it('does not match kind/runbooks or a prefix of the tag', () => {
    expect(isRunbook(parseFrontmatter(doc({ ...RUNBOOK, tags: "['kind/runbooks']" })))).toBe(false)
    expect(isRunbook(parseFrontmatter(doc({ ...RUNBOOK, tags: "['kind/run']" })))).toBe(false)
  })

  it('is false for a doc with no tags key at all, and for a null frontmatter', () => {
    const noTags = Object.fromEntries(Object.entries(RUNBOOK).filter(([k]) => k !== 'tags'))
    expect(isRunbook(parseFrontmatter(doc(noTags)))).toBe(false)
    expect(isRunbook(null)).toBe(false)
  })
})

describe('parseHandles', () => {
  it('reads several ids in declaration order', () => {
    expect(parseHandles('[INV-74, INV-16, INV-105]')).toEqual(['INV-74', 'INV-16', 'INV-105'])
  })

  it('returns an empty list for an empty declaration or a missing one', () => {
    expect(parseHandles('[]')).toEqual([])
    expect(parseHandles(undefined)).toEqual([])
  })
})

describe('operationalInvariants', () => {
  it('selects only the operational tier', () => {
    expect(operationalInvariants(CATALOG)).toEqual(['INV-16', 'INV-17'])
  })
})

describe('uncoveredOperational', () => {
  it('subtracts what the runbooks handle', () => {
    const rbs = [{ file: 'a', id: 'RB-01', handles: ['INV-16'] }]
    expect(uncoveredOperational(rbs, ['INV-16', 'INV-17'])).toEqual(['INV-17'])
  })

  it('ignores handled invariants that are not operational — they cover nothing here', () => {
    const rbs = [{ file: 'a', id: 'RB-01', handles: ['INV-74'] }]
    expect(uncoveredOperational(rbs, ['INV-16', 'INV-17'])).toEqual(['INV-16', 'INV-17'])
  })
})

describe('runbookViolations — the three hard rules', () => {
  const known = new Set(['INV-01', 'INV-16', 'INV-17', 'INV-74'])
  const rb = (over: Partial<{ file: string; id: string; handles: string[] }> = {}) => ({
    file: 'docs/rb/a.md',
    id: 'RB-01',
    handles: ['INV-16'],
    ...over,
  })

  it('is silent on a well-formed runbook', () => {
    expect(runbookViolations([rb()], known)).toEqual([])
  })

  it('reports an empty canonical_id', () => {
    expect(runbookViolations([rb({ id: '' })], known)[0]).toMatch(/canonical_id is empty/)
  })

  it.each([['RB1'], ['rb-01'], ['RB-1'], ['RB-001'], ['ADR-01']])(
    'reports the off-pattern id %s',
    (id) => {
      expect(runbookViolations([rb({ id })], known)[0]).toMatch(/expected an RB-NN id/)
    },
  )

  it('reports a duplicate id, naming the file that already holds it', () => {
    const found = runbookViolations([rb(), rb({ file: 'docs/rb/b.md' })], known)
    expect(found).toEqual(['docs/rb/b.md: canonical_id RB-01 is already used by docs/rb/a.md'])
  })

  it('reports an empty handles list', () => {
    expect(runbookViolations([rb({ handles: [] })], known)[0]).toMatch(/declares no `handles:`/)
  })

  it('reports every unresolvable ref, not merely the first', () => {
    const found = runbookViolations([rb({ handles: ['INV-998', 'INV-16', 'INV-999'] })], known)
    expect(found).toHaveLength(2)
    expect(found[0]).toMatch(/INV-998/)
    expect(found[1]).toMatch(/INV-999/)
  })

  it('does not also complain about refs when the list is empty — one defect, one line', () => {
    expect(runbookViolations([rb({ handles: [] })], known)).toHaveLength(1)
  })

  it('accepts a handles ref of ANY tier — the real runbooks handle security invariants', () => {
    expect(runbookViolations([rb({ handles: ['INV-74'] })], known)).toEqual([])
  })
})

describe('the gate as invoked — INV-53 exit codes and the ratchet', () => {
  let dir: string

  const writeDoc = (rel: string, fields: Record<string, string>): void => {
    mkdirSync(join(dir, 'docs', 'rb'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'rb', rel), doc(fields))
  }
  const writeBaseline = (value: unknown): void => {
    mkdirSync(join(dir, 'scripts', 'data'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'data', 'runbook-baseline.json'), JSON.stringify(value))
  }
  const run = (...args: string[]): { status: number; stdout: string; stderr: string } => {
    const r = spawnSync('node', [GATE, '--dir', dir, ...args], { encoding: 'utf-8' })
    return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-runbooks-'))
    mkdirSync(join(dir, 'src', 'invariants'), { recursive: true })
    writeFileSync(join(dir, 'src', 'invariants', 'catalog.ts'), CATALOG)
    writeBaseline({ uncoveredOperational: 2 })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 and says PASS on a well-formed tree', () => {
    writeDoc('a.md', RUNBOOK)
    const r = run()
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/PASS/)
    expect(r.stdout).toMatch(/1 runbook\(s\)/)
  })

  it('exits 1 naming the file when a handles ref does not resolve', () => {
    writeDoc('a.md', { ...RUNBOOK, handles: '[INV-999]' })
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/handles "INV-999"/)
  })

  it('exits 0 with zero runbooks — a project need not have written one yet', () => {
    const r = run()
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/0 runbook\(s\)/)
  })

  it('exits 0 and SKIPs out loud when there is no catalog, and never says PASS', () => {
    rmSync(join(dir, 'src', 'invariants', 'catalog.ts'))
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('[SKIP]')
    expect(r.stdout).not.toMatch(/PASS/)
  })

  it('surfaces the skip as verdict "skip" under --json, so a reader cannot mistake it for a pass', () => {
    rmSync(join(dir, 'src', 'invariants', 'catalog.ts'))
    expect(JSON.parse(run('--json').stdout).verdict).toBe('skip')
  })

  it('exits 1 when the uncovered count rises above the baseline, naming what is uncovered', () => {
    writeBaseline({ uncoveredOperational: 0 })
    writeDoc('a.md', RUNBOOK)
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/rose to 1, baseline allows 0/)
    expect(r.stderr).toMatch(/INV-17/)
  })

  it('passes when the count FALLS below the baseline — burn-down is always free', () => {
    writeDoc('a.md', RUNBOOK)
    writeDoc('b.md', { ...RUNBOOK, canonical_id: "'RB-02'", handles: '[INV-17]' })
    const r = run()
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/0\/2 operational invariants uncovered/)
  })

  it('exits 2, not 1, when the baseline is absent — the gate could not tell', () => {
    rmSync(join(dir, 'scripts', 'data', 'runbook-baseline.json'))
    expect(run().status).toBe(2)
  })

  it.each([['{"nope": 1}'], ['{"uncoveredOperational": "2"}'], ['not json at all']])(
    'exits 2 on an unusable baseline (%s)',
    (raw) => {
      writeFileSync(join(dir, 'scripts', 'data', 'runbook-baseline.json'), raw)
      expect(run().status).toBe(2)
    },
  )

  it('--update-baseline records the measured count, creating scripts/data/ if absent', () => {
    rmSync(join(dir, 'scripts', 'data'), { recursive: true, force: true })
    writeDoc('a.md', RUNBOOK)
    expect(run('--update-baseline').status).toBe(0)
    const written = JSON.parse(
      readFileSync(join(dir, 'scripts', 'data', 'runbook-baseline.json'), 'utf-8'),
    )
    expect(written.uncoveredOperational).toBe(1)
  })

  it('--update-baseline preserves other keys rather than truncating the file', () => {
    writeBaseline({ uncoveredOperational: 2, _doc: 'why this exists' })
    run('--update-baseline')
    const written = JSON.parse(
      readFileSync(join(dir, 'scripts', 'data', 'runbook-baseline.json'), 'utf-8'),
    )
    expect(written._doc).toBe('why this exists')
  })
})

describe('collectRunbooks over a real tree', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-runbooks-walk-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds runbooks at any depth and returns paths sorted, so the report is stable', () => {
    mkdirSync(join(dir, 'docs', 'a', 'b'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'a', 'b', 'deep.md'),
      doc({ ...RUNBOOK, canonical_id: "'RB-02'" }),
    )
    writeFileSync(join(dir, 'docs', 'a', 'shallow.md'), doc(RUNBOOK))
    expect(collectRunbooks(dir).map((r) => r.file)).toEqual([
      'docs/a/b/deep.md',
      'docs/a/shallow.md',
    ])
  })

  it('ignores non-markdown files and docs that are not runbooks', () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'note.txt'), doc(RUNBOOK))
    writeFileSync(join(dir, 'docs', 'other.md'), doc({ ...RUNBOOK, tags: "['kind/reference']" }))
    expect(collectRunbooks(dir)).toEqual([])
  })

  it('returns nothing when there is no docs/ directory at all', () => {
    expect(collectRunbooks(dir)).toEqual([])
  })
})

/**
 * The projection forma's operations lens consumes (#2480 wave 8). It carries the coverage algebra
 * as MEASURED, and it carries the uncovered LIST rather than only its length — an operations view
 * whose only signal is "49" cannot tell an operator which failure they have no procedure for, and
 * that list is the whole reason the ratchet exists.
 */
describe('runbookProjection', () => {
  const rbs = [
    { file: 'docs/b.md', id: 'RB-02', handles: ['INV-17', 'INV-16'] },
    { file: 'docs/a.md', id: 'RB-01', handles: ['INV-74'] },
  ]

  it('sorts runbooks by id and their handles, so a diff of two runs is meaningful', () => {
    const p = runbookProjection(rbs, ['INV-16', 'INV-17'], [])
    expect(p.runbooks.map((r) => r.id)).toEqual(['RB-01', 'RB-02'])
    expect(p.runbooks[1].handles).toEqual(['INV-16', 'INV-17'])
  })

  it('carries the uncovered LIST, not merely a count', () => {
    const p = runbookProjection(rbs, ['INV-16', 'INV-17', 'INV-18'], ['INV-18', 'INV-16'])
    expect(p.coverage).toEqual({ operationalTotal: 3, uncovered: ['INV-16', 'INV-18'] })
  })

  it('declares its schema version, which is what a consumer checks before trusting the shape', () => {
    expect(runbookProjection([], [], []).schema).toBe('arbiter-runbooks-v1')
  })

  it('emits an empty coverage list rather than omitting it when nothing is uncovered', () => {
    expect(runbookProjection(rbs, ['INV-16'], []).coverage.uncovered).toEqual([])
  })
})
