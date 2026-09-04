// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-milestones.mjs (INV-146, #2480 wave 3).
 *
 * RED phase: the module under test does not exist yet, so every case here fails by
 * construction. That is the point — the gate this suite describes must be shown to go red
 * before it is trusted, and #2051 lets a tests-only red commit through the L1 gate so
 * `arbiter task record-red` has a real commit to pin.
 *
 * What the milestone gate must prove, and therefore what is asserted here:
 *   - the SSOT satisfies schemas/milestone.schema.json, including the Now/Next/Later
 *     granularity decay (`due` required for `now`, forbidden for `later`) — enforceable only
 *     since #2509 taught the shared validator if/then/not;
 *   - identifiers are unique, within the set and within each milestone's exit criteria;
 *   - `depends_on` resolves and the graph is acyclic, reported AS THE CYCLE not as a boolean;
 *   - `done`/`verified` is fail-closed on exit-criteria evidence — this is the rule the whole
 *     gate exists for, because a roadmap whose `done` means "someone typed done" is worse than
 *     no roadmap: it is a false claim with a schema around it;
 *   - `verified` additionally requires the evidence to resolve;
 *   - exit codes obey INV-53 (0 pass/skip, 1 violation, 2 error), because a gate that prints
 *     FAIL and exits 0 is fake-green.
 *
 * Existing Code Survey (CANON-16):
 *   - grep 'milestone' src/ scripts/: only scripts/gen-status.mjs (parses the prose
 *     MILESTONES.md "Open epics" table) and two ship commands that mention the word. No gate
 *     reads a milestone SSOT, and no existing gate validates a typed graph of this shape —
 *     check-id-registry proves the *scheme* is collision-free, check-doc-set gates presence
 *     and freshness. New gate justified; its schema validation reuses loadSchema/validateSchema
 *     rather than reimplementing a validator.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  findDuplicateIds,
  findDanglingDeps,
  findCycle,
  findDoneWithoutEvidence,
  findUnresolvedEvidence,
  evidenceResolves,
  collectViolations,
  annotateSchemaViolations,
} from '../../scripts/check-milestones.mjs'

const REPO_ROOT = join(__dirname, '..', '..')
const GATE = join(REPO_ROOT, 'scripts', 'check-milestones.mjs')

/** A schema-valid milestone; override fields per case. */
function milestone(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'MS-01',
    title: 'A sufficiently long title',
    goal: { claim: 'a claim long enough to pass', strategy: 'a strategy long enough to pass' },
    exit_criteria: [{ id: 'EC-01', description: 'something checkable' }],
    horizon: 'next',
    status: 'planned',
    ...over,
  }
}

describe('findDuplicateIds', () => {
  it('accepts distinct ids', () => {
    expect(findDuplicateIds([milestone(), milestone({ id: 'MS-02' })])).toEqual([])
  })

  it('reports a repeated milestone id', () => {
    const out = findDuplicateIds([milestone(), milestone()])
    expect(out.length).toBe(1)
    expect(out[0]).toMatch(/MS-01/)
  })

  it('reports a repeated exit-criterion id within one milestone', () => {
    const out = findDuplicateIds([
      milestone({
        exit_criteria: [
          { id: 'EC-01', description: 'first thing' },
          { id: 'EC-01', description: 'second thing' },
        ],
      }),
    ])
    expect(out.length).toBe(1)
    expect(out[0]).toMatch(/EC-01/)
  })

  it('allows the same exit-criterion id across different milestones', () => {
    expect(findDuplicateIds([milestone(), milestone({ id: 'MS-02' })])).toEqual([])
  })
})

describe('findDanglingDeps', () => {
  it('accepts a dependency that exists', () => {
    const set = [milestone({ depends_on: ['MS-02'] }), milestone({ id: 'MS-02' })]
    expect(findDanglingDeps(set)).toEqual([])
  })

  it('reports a dependency that does not', () => {
    const out = findDanglingDeps([milestone({ depends_on: ['MS-77'] })])
    expect(out.length).toBe(1)
    expect(out[0]).toMatch(/MS-77/)
  })

  it('treats an absent depends_on as no dependencies', () => {
    expect(findDanglingDeps([milestone()])).toEqual([])
  })
})

describe('findCycle', () => {
  it('accepts a DAG', () => {
    const set = [
      milestone({ id: 'MS-01', depends_on: ['MS-02'] }),
      milestone({ id: 'MS-02', depends_on: ['MS-03'] }),
      milestone({ id: 'MS-03' }),
    ]
    expect(findCycle(set)).toEqual([])
  })

  it('reports a two-node cycle as the path that closes it', () => {
    const set = [
      milestone({ id: 'MS-01', depends_on: ['MS-02'] }),
      milestone({ id: 'MS-02', depends_on: ['MS-01'] }),
    ]
    const out = findCycle(set)
    expect(out.length).toBe(1)
    expect(out[0]).toMatch(/MS-01 -> MS-02 -> MS-01/)
  })

  it('detects a self-loop', () => {
    expect(findCycle([milestone({ id: 'MS-01', depends_on: ['MS-01'] })]).length).toBe(1)
  })

  it('detects a three-node cycle', () => {
    const set = [
      milestone({ id: 'MS-01', depends_on: ['MS-02'] }),
      milestone({ id: 'MS-02', depends_on: ['MS-03'] }),
      milestone({ id: 'MS-03', depends_on: ['MS-01'] }),
    ]
    expect(findCycle(set).length).toBe(1)
  })

  it('does not mistake a diamond for a cycle', () => {
    const set = [
      milestone({ id: 'MS-01', depends_on: ['MS-02', 'MS-03'] }),
      milestone({ id: 'MS-02', depends_on: ['MS-04'] }),
      milestone({ id: 'MS-03', depends_on: ['MS-04'] }),
      milestone({ id: 'MS-04' }),
    ]
    expect(findCycle(set)).toEqual([])
  })

  it('ignores a dangling edge rather than reporting it as a cycle', () => {
    expect(findCycle([milestone({ depends_on: ['MS-77'] })])).toEqual([])
  })
})

describe('findDoneWithoutEvidence — the fail-closed rule', () => {
  it('allows a planned milestone with no evidence', () => {
    expect(findDoneWithoutEvidence([milestone({ status: 'planned' })])).toEqual([])
  })

  it('allows an active milestone with no evidence', () => {
    expect(findDoneWithoutEvidence([milestone({ status: 'active' })])).toEqual([])
  })

  it('refuses done when an exit criterion carries no evidence_ref', () => {
    const out = findDoneWithoutEvidence([milestone({ status: 'done' })])
    expect(out.length).toBe(1)
    expect(out[0]).toMatch(/status is not evidence/)
  })

  it('refuses verified when an exit criterion carries no evidence_ref', () => {
    expect(findDoneWithoutEvidence([milestone({ status: 'verified' })]).length).toBe(1)
  })

  it('refuses done when an evidence_ref is present but blank', () => {
    const out = findDoneWithoutEvidence([
      milestone({
        status: 'done',
        exit_criteria: [{ id: 'EC-01', description: 'x', evidence_ref: '   ' }],
      }),
    ])
    expect(out.length).toBe(1)
  })

  it('accepts done when every criterion carries evidence', () => {
    const out = findDoneWithoutEvidence([
      milestone({
        status: 'done',
        exit_criteria: [
          { id: 'EC-01', description: 'first', evidence_ref: 'scripts/check-all.mjs' },
          { id: 'EC-02', description: 'second', evidence_ref: 'INV-140' },
        ],
      }),
    ])
    expect(out).toEqual([])
  })

  it('reports EVERY uncovered criterion, not just the first', () => {
    const out = findDoneWithoutEvidence([
      milestone({
        status: 'done',
        exit_criteria: [
          { id: 'EC-01', description: 'first' },
          { id: 'EC-02', description: 'second' },
        ],
      }),
    ])
    expect(out.length).toBe(2)
  })
})

describe('evidenceResolves', () => {
  it('resolves a path that exists', () => {
    expect(evidenceResolves('scripts/check-all.mjs', REPO_ROOT)).toBe(true)
  })

  it('rejects a path that does not', () => {
    expect(evidenceResolves('scripts/nope-not-here.mjs', REPO_ROOT)).toBe(false)
  })

  it('resolves an INV id present in the catalog', () => {
    expect(evidenceResolves('INV-140', REPO_ROOT)).toBe(true)
  })

  it('rejects an INV id absent from the catalog', () => {
    expect(evidenceResolves('INV-9999', REPO_ROOT)).toBe(false)
  })

  it('accepts a github: ref unresolved — this gate is offline by contract (INV-13)', () => {
    expect(evidenceResolves('github:LucaDominici/arbiter#1770', REPO_ROOT)).toBe(true)
  })
})

describe('findUnresolvedEvidence', () => {
  it('ignores a done milestone — only verified demands resolution', () => {
    const out = findUnresolvedEvidence(
      [
        milestone({
          status: 'done',
          exit_criteria: [{ id: 'EC-01', description: 'x', evidence_ref: 'nope/missing.mjs' }],
        }),
      ],
      REPO_ROOT,
    )
    expect(out).toEqual([])
  })

  it('reports a verified milestone whose evidence does not resolve', () => {
    const out = findUnresolvedEvidence(
      [
        milestone({
          status: 'verified',
          exit_criteria: [{ id: 'EC-01', description: 'x', evidence_ref: 'nope/missing.mjs' }],
        }),
      ],
      REPO_ROOT,
    )
    expect(out.length).toBe(1)
    expect(out[0]).toMatch(/does not resolve/)
  })

  it('accepts a verified milestone whose evidence resolves', () => {
    const out = findUnresolvedEvidence(
      [
        milestone({
          status: 'verified',
          exit_criteria: [{ id: 'EC-01', description: 'x', evidence_ref: 'scripts/check-all.mjs' }],
        }),
      ],
      REPO_ROOT,
    )
    expect(out).toEqual([])
  })
})

describe('annotateSchemaViolations', () => {
  it('resolves an array index to the milestone id', () => {
    const out = annotateSchemaViolations(
      ['milestones.milestones[1]: missing required property "title"'],
      [milestone(), milestone({ id: 'MS-02' })],
    )
    expect(out[0]).toMatch(/milestone MS-02/)
    expect(out[0]).not.toMatch(/\[1\]/)
  })

  it('translates the opaque "not" rule into the decay rule it can only mean', () => {
    const out = annotateSchemaViolations(
      ['milestones.milestones[0]: value must NOT match the "not" schema, but does'],
      [milestone({ horizon: 'later' })],
    )
    expect(out[0]).toMatch(/must not carry a "due" date/)
  })

  it('leaves an unrelated violation alone', () => {
    const msg = 'milestones: missing required property "milestones"'
    expect(annotateSchemaViolations([msg], [])).toEqual([msg])
  })

  it('degrades to an index when the milestone is absent', () => {
    const out = annotateSchemaViolations(['milestones.milestones[3]: bad'], [])
    expect(out[0]).toMatch(/milestone #3/)
  })
})

describe('collectViolations', () => {
  it('is clean for a well-formed set', () => {
    const set = [milestone({ depends_on: ['MS-02'] }), milestone({ id: 'MS-02' })]
    expect(collectViolations(set, REPO_ROOT)).toEqual([])
  })

  it('accumulates across rules rather than stopping at the first', () => {
    const set = [
      milestone({ id: 'MS-01', depends_on: ['MS-99'], status: 'done' }),
      milestone({ id: 'MS-01' }),
    ]
    expect(collectViolations(set, REPO_ROOT).length).toBeGreaterThanOrEqual(3)
  })
})

describe('the gate as invoked — INV-53 exit codes', () => {
  let dir: string

  const write = (yaml: string): void => {
    mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'internal', 'PRODUCT', 'MILESTONES.yml'), yaml)
  }
  const run = (): { status: number; stdout: string; stderr: string } => {
    const r = spawnSync('node', [GATE, '--dir', dir], { encoding: 'utf-8' })
    return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  const VALID = `milestones:
  - id: MS-01
    title: A sufficiently long title
    goal:
      claim: a claim long enough to pass
      strategy: a strategy long enough to pass
    exit_criteria:
      - id: EC-01
        description: something checkable
    horizon: next
    status: planned
`

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-milestones-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 and says PASS on a valid set', () => {
    write(VALID)
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/PASS/)
  })

  it('exits 0 and says SKIP when the SSOT is absent — and never says PASS', () => {
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/\[SKIP\]/)
    expect(r.stdout).not.toMatch(/PASS/)
  })

  it('exits 1 on a structural violation', () => {
    write(VALID.replace('horizon: next', 'horizon: next\n    depends_on: [MS-77]'))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/MS-77/)
  })

  it('exits 1 on the granularity-decay rule', () => {
    write(VALID.replace('horizon: next', "horizon: later\n    due: '2026-12-01'"))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/due/)
  })

  it('exits 1 on done without evidence', () => {
    write(VALID.replace('status: planned', 'status: done'))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/status is not evidence/)
  })

  it('exits 2 on unparseable YAML — an error, not a violation', () => {
    write('milestones: [\n  broken')
    expect(run().status).toBe(2)
  })

  it('reports the verdict as JSON under --json', () => {
    write(VALID)
    const r = spawnSync('node', [GATE, '--dir', dir, '--json'], { encoding: 'utf-8' })
    const parsed = JSON.parse(r.stdout ?? '{}')
    expect(parsed.verdict).toBe('pass')
    expect(parsed.violations).toEqual([])
  })

  it('makes a skip visible as a verdict under --json, not as a pass', () => {
    const r = spawnSync('node', [GATE, '--dir', dir, '--json'], { encoding: 'utf-8' })
    expect(JSON.parse(r.stdout ?? '{}').verdict).toBe('skip')
  })
})

// ── --emit: the JSON projection forma consumes (#2480 wave 6) ────────────────
//
// forma has ZERO dependencies by design and therefore cannot parse YAML. The milestone SSOT stays
// YAML (humans edit it); arbiter emits the machine projection. That asymmetry is the whole point of
// "arbiter defines, forma derives" — forma reads arbiter's machine outputs rather than reimplementing
// its parser, which is how the two repos avoid holding a second opinion about the same data.
//
// --emit lives on the GATE rather than in a new gen-* script, and that buys a real property: the
// projection is written by the same code path that just schema-validated the SSOT, so an INVALID
// milestone set cannot produce a projection at all. A separate generator could emit a document the
// gate would reject.
describe('--emit (#2480 wave 6)', () => {
  let dir: string
  const VALID = `milestones:
  - id: MS-01
    title: A sufficiently long title
    goal:
      claim: a claim long enough to pass
      strategy: a strategy long enough to pass
    exit_criteria:
      - id: EC-01
        description: something checkable
    depends_on: []
    horizon: next
    estimate_days: 12
    status: planned
  - id: MS-02
    title: A second milestone title
    goal:
      claim: another claim long enough
      strategy: another strategy long enough
    exit_criteria:
      - id: EC-01
        description: something checkable
    depends_on: [MS-01]
    horizon: later
    status: planned
`
  const write = (yaml: string): void => {
    mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'internal', 'PRODUCT', 'MILESTONES.yml'), yaml)
  }
  const emit = (out: string): { status: number; stderr: string } => {
    const r = spawnSync('node', [GATE, '--dir', dir, '--emit', out], { encoding: 'utf-8' })
    return { status: r.status ?? -1, stderr: (r.stderr ?? '') + (r.stdout ?? '') }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-emit-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a projection carrying exactly what a scheduler needs', () => {
    write(VALID)
    const out = join(dir, 'milestones.json')
    expect(emit(out).status).toBe(0)
    const doc = JSON.parse(readFileSync(out, 'utf-8')) as {
      schema: string
      milestones: Array<Record<string, unknown>>
    }
    expect(doc.schema).toBe('arbiter-milestones-v1')
    expect(doc.milestones).toHaveLength(2)
    expect(doc.milestones[0]).toMatchObject({
      id: 'MS-01',
      depends_on: [],
      horizon: 'next',
      estimate_days: 12,
      status: 'planned',
    })
    expect(doc.milestones[1]).toMatchObject({ id: 'MS-02', depends_on: ['MS-01'] })
  })

  it('REFUSES to emit an invalid SSOT — a projection of a broken plan is worse than none', () => {
    write(VALID.replace('horizon: later', "horizon: later\n    due: '2026-12-01'"))
    const out = join(dir, 'milestones.json')
    const r = emit(out)
    expect(r.status).toBe(1)
    expect(existsSync(out)).toBe(false)
  })

  it('omits estimate_days when the SSOT does not carry one, rather than inventing a default', () => {
    write(VALID)
    const out = join(dir, 'milestones.json')
    emit(out)
    const doc = JSON.parse(readFileSync(out, 'utf-8')) as {
      milestones: Array<Record<string, unknown>>
    }
    expect(doc.milestones[1]).not.toHaveProperty('estimate_days')
  })

  it('carries members, because reconciliation needs the CLAIM as well as reality', () => {
    // The first cut of this projection omitted `members`, reasoning "only what a scheduler needs".
    // That was under-inclusive. The SSOT states that GitHub milestones are a PROJECTION of this
    // file and that drift is a finding — and drift is precisely the comparison between what the
    // SSOT CLAIMS a milestone contains and what GitHub actually holds. forma sees GitHub's side
    // already (each issue carries `ms`, the milestone title); without the claimed side it can
    // detect a milestone that has no GitHub counterpart but never an issue filed under the wrong
    // one, which is the more common drift. Membership is not governance — it is the join key.
    write(
      VALID.replace(
        '    depends_on: []',
        '    members:\n      issues: [11, 22]\n      label: programme/x\n    depends_on: []',
      ),
    )
    const out = join(dir, 'milestones.json')
    expect(emit(out).status).toBe(0)
    const doc = JSON.parse(readFileSync(out, 'utf-8')) as {
      milestones: Array<Record<string, unknown>>
    }
    expect(doc.milestones[0]!['members']).toEqual({ issues: [11, 22], label: 'programme/x' })
  })

  it('omits members entirely when the SSOT declares none, rather than inventing an empty claim', () => {
    write(VALID)
    const out = join(dir, 'milestones.json')
    emit(out)
    const doc = JSON.parse(readFileSync(out, 'utf-8')) as {
      milestones: Array<Record<string, unknown>>
    }
    expect(doc.milestones[0]).not.toHaveProperty('members')
  })

  it('still excludes the GSN goal and exit criteria — those ARE governance, not schedule', () => {
    write(VALID)
    const out = join(dir, 'milestones.json')
    emit(out)
    const doc = JSON.parse(readFileSync(out, 'utf-8')) as {
      milestones: Array<Record<string, unknown>>
    }
    expect(doc.milestones[0]).not.toHaveProperty('goal')
    expect(doc.milestones[0]).not.toHaveProperty('exit_criteria')
  })

  it('is deterministic: two emissions of the same SSOT are byte-identical', () => {
    write(VALID)
    const a = join(dir, 'a.json')
    const b = join(dir, 'b.json')
    emit(a)
    emit(b)
    expect(readFileSync(a, 'utf-8')).toBe(readFileSync(b, 'utf-8'))
  })

  it('still runs the gate: --emit on a cyclic set fails and writes nothing', () => {
    write(VALID.replace('depends_on: []', 'depends_on: [MS-02]'))
    const out = join(dir, 'milestones.json')
    expect(emit(out).status).toBe(1)
    expect(existsSync(out)).toBe(false)
  })
})
