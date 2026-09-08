// SPDX-License-Identifier: Apache-2.0
/**
 * Track-B evidence gates, PROVEN TO RUN (#2480 wave 7).
 *
 * The arc42 wave (#2480, INV-144) shipped a gate that rendered correctly into a governed project
 * and could not execute there: its engine was absent from the tarball and its skeletons resolved to
 * a path that only exists in a dev checkout. Both defects were invisible to twenty-nine tests,
 * every one of which passed the fixture in by hand. The lesson written down at the time was that a
 * Track-B claim is worth what its execution proves, so these two ports are tested by RENDERING them
 * into a package-shaped project and RUNNING them there — including the failure paths, because a
 * gate that cannot fail is the thing this whole programme exists to refuse.
 *
 * Both gates were self-only until this wave for one shared reason: their rules validate against a
 * schema, and a rule shipped without its contract errors the moment a project uses it. So the
 * schema travelling with the gate is itself an assertion here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  unlinkSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const HEADER = `| feature_id | capability | kit_dims | level | status | code_ref | test_ref | doc_ref | issue_ref | note |
|---|---|---|---|---|---|---|---|---|---|`

const EXCERPT = 'The excerpt is the evidence, and the hash is what keeps it the evidence.\n'
const HASH = createHash('sha256').update(EXCERPT).digest('hex')

interface Run {
  status: number
  out: string
}

describe('Track-B evidence gates run where they are emitted (#2480)', () => {
  let dir: string

  /** Render the emitted files into a project-shaped tree — gate, its schema, its one dependency. */
  const emit = (): void => {
    const data = makeConfig(dir, { governanceLevel: 'L2' }) as unknown as Record<string, unknown>
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    mkdirSync(join(dir, 'schemas'), { recursive: true })
    mkdirSync(join(dir, 'docs'), { recursive: true })
    for (const [rel, tpl] of [
      ['scripts/check-sources.mjs', 'scripts/check-sources.mjs.ejs'],
      ['scripts/check-feature-matrix.mjs', 'scripts/check-feature-matrix.mjs.ejs'],
      ['scripts/lib/agent-return-validate.mjs', 'scripts/lib/agent-return-validate.mjs.ejs'],
      ['schemas/source-record.schema.json', 'schemas/source-record.schema.json.ejs'],
      ['schemas/rtm-verdict.schema.json', 'schemas/rtm-verdict.schema.json.ejs'],
      ['scripts/check-use-cases.mjs', 'scripts/check-use-cases.mjs.ejs'],
      ['schemas/use-case.schema.json', 'schemas/use-case.schema.json.ejs'],
      ['scripts/lib/run-helpers.mjs', 'scripts/lib/run-helpers.mjs.ejs'],
    ] as const) {
      const rendered = renderTemplate(tpl, data)
      // A leftover EJS tag would mean the gate ships a syntax error, which no runtime assertion
      // below would attribute correctly.
      expect(rendered, `${rel} still carries an unrendered EJS tag`).not.toContain('<%')
      writeFileSync(join(dir, rel), rendered)
    }
  }

  const run = (script: string, args: string[] = []): Run => {
    const r = spawnSync('node', [join(dir, 'scripts', script), ...args], {
      encoding: 'utf-8',
      cwd: dir,
    })
    return { status: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
  }

  const writeSources = (over: Record<string, unknown> = {}, excerpt = EXCERPT): void => {
    mkdirSync(join(dir, 'docs', 'sources', 'excerpts'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'sources', 'excerpts', 'SRC-001.txt'), excerpt)
    const source = {
      id: 'SRC-001',
      title: 'A source a governed project cites',
      url: 'https://example.invalid/spec',
      kind: 'docs',
      retrieved_at: '2026-09-04',
      excerpt_path: 'docs/sources/excerpts/SRC-001.txt',
      content_hash: HASH,
      citations: [{ quoted_text: 'the hash is what keeps it the evidence' }],
      selected_by_user: true,
      informs: [],
      application_status: 'cited',
      ...over,
    }
    writeFileSync(
      join(dir, 'docs', 'SOURCES.md'),
      [
        '# Sources',
        '',
        '<!-- SOURCES_START -->',
        '```json',
        JSON.stringify({ sources: [source] }, null, 2),
        '```',
        '<!-- SOURCES_END -->',
        '',
      ].join('\n'),
    )
  }

  const writeMatrix = (status: string): void => {
    const row = `| REQ-001 | A capability | N01 | L2 | ${status} | src/a.ts | test/a.test.ts | docs/a.md | #1 | — |`
    const counts = { Verified: 0, Done: 0, Partial: 0, Missing: 0 } as Record<string, number>
    counts[status] = 1
    writeFileSync(
      join(dir, 'docs', 'FEATURE_MATRIX.md'),
      [
        '# FEATURE_MATRIX',
        '',
        '<!-- FEATURE_MATRIX_START -->',
        HEADER,
        row,
        '<!-- FEATURE_MATRIX_END -->',
        '',
        '## Summary',
        '',
        '| Status | Count |',
        '|---|---|',
        `| Verified | ${counts['Verified']} |`,
        `| Done | ${counts['Done']} |`,
        `| Partial | ${counts['Partial']} |`,
        `| Missing | ${counts['Missing']} |`,
        '| **Total** | **1** |',
        '',
      ].join('\n'),
    )
    for (const rel of ['src/a.ts', 'test/a.test.ts', 'docs/a.md']) {
      mkdirSync(join(dir, rel.split('/')[0] as string), { recursive: true })
      writeFileSync(join(dir, rel), '// present\n')
    }
  }

  const writeEnvelope = (over: Record<string, unknown> = {}): void => {
    mkdirSync(join(dir, '.arbiter', 'evidence', 'rtm'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'evidence', 'rtm', 'REQ-001.json'),
      JSON.stringify({
        feature_id: 'REQ-001',
        verdict: 'PROVEN',
        justification: 'The suite was executed against this requirement and passed.',
        command: 'npm test',
        transcript_digest: 'a'.repeat(64),
        recorded_at: '2026-09-04T00:00:00Z',
        ...over,
      }),
    )
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-trackb-'))
    emit()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  describe('check-sources.mjs (INV-147)', () => {
    it('SKIPs out loud in a project that cites nothing — the common case must not read as a pass', () => {
      const r = run('check-sources.mjs')
      expect(r.status).toBe(0)
      expect(r.out).toMatch(/\[SKIP\]/)
      expect(r.out).not.toMatch(/PASS/)
    })

    it('resolves its emitted schema and passes on a well-formed registry', () => {
      writeSources()
      const r = run('check-sources.mjs')
      expect(r.out).not.toMatch(/cannot load/)
      expect(r.status).toBe(0)
      expect(r.out).toMatch(/PASS/)
    })

    it("reads docs/SOURCES.md, not arbiter's own internal path", () => {
      writeSources()
      mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
      unlinkSync(join(dir, 'docs', 'SOURCES.md'))
      expect(run('check-sources.mjs').out).toMatch(/\[SKIP\]/)
    })

    it('fails when the excerpt drifts from its recorded hash', () => {
      writeSources({}, EXCERPT.replace('evidence', 'EVIDENCE'))
      const r = run('check-sources.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/hash/i)
    })

    it('fails when the project quotes something the excerpt never said', () => {
      writeSources({ citations: [{ quoted_text: 'a sentence the source never contained' }] })
      expect(run('check-sources.mjs').status).toBe(1)
    })

    it('errors, not merely fails, when its emitted schema is missing (INV-53)', () => {
      writeSources()
      unlinkSync(join(dir, 'schemas', 'source-record.schema.json'))
      const r = run('check-sources.mjs')
      expect(r.status).toBe(2)
      expect(r.out).toMatch(/source-record\.schema\.json/)
    })
  })

  describe('check-feature-matrix.mjs axis 2 (INV-112)', () => {
    it('refuses a Verified row with no verification envelope — status is not evidence', () => {
      writeMatrix('Verified')
      const r = run('check-feature-matrix.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/RTM verdict ratchet/)
      expect(r.out).toMatch(/REQ-001/)
    })

    it('accepts the same row once the envelope exists', () => {
      writeMatrix('Verified')
      writeEnvelope()
      const r = run('check-feature-matrix.mjs')
      expect(r.out).not.toMatch(/RTM verdict ratchet/)
      expect(r.status).toBe(0)
    })

    it('refuses an envelope whose verdict is not PROVEN', () => {
      writeMatrix('Verified')
      writeEnvelope({ verdict: 'STALE' })
      const r = run('check-feature-matrix.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/requires verdict PROVEN/)
    })

    it('refuses evidence copied from another requirement', () => {
      writeMatrix('Verified')
      writeEnvelope({ feature_id: 'REQ-999' })
      const r = run('check-feature-matrix.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/REQ-999/)
    })

    it('refuses an envelope the emitted schema rejects — the contract travels with the rule', () => {
      writeMatrix('Verified')
      writeEnvelope({ justification: 'works' })
      const r = run('check-feature-matrix.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/envelope/)
    })

    it('says so when the schema is gone rather than letting the rule lapse in silence', () => {
      writeMatrix('Verified')
      writeEnvelope()
      unlinkSync(join(dir, 'schemas', 'rtm-verdict.schema.json'))
      const r = run('check-feature-matrix.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/rtm-verdict\.schema\.json is missing/)
    })

    it('leaves a row that claims nothing alone — the rule applies to Verified only', () => {
      writeMatrix('Partial')
      const r = run('check-feature-matrix.mjs')
      expect(r.out).not.toMatch(/RTM verdict ratchet/)
    })
  })
})

/**
 * UC-NN (#2480 wave 8), same harness and same reason. This gate is Track-B-shaped by construction:
 * arbiter's feature-matrix rows are cross-cutting capability areas, so one of its use cases would
 * name nearly all of them and the link would carry no information. It therefore SKIPs on arbiter's
 * own track, which means the ONLY place its rules are ever exercised is a governed project — and a
 * rule exercised nowhere in CI is a rule that has never run. So it is rendered into a
 * project-shaped tree and executed here, failure paths included.
 */
describe('the emitted use-case gate runs where it is emitted (#2480 wave 8)', () => {
  let dir: string

  const emitUseCases = (): void => {
    const data = makeConfig(dir, { governanceLevel: 'L2' }) as unknown as Record<string, unknown>
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    mkdirSync(join(dir, 'schemas'), { recursive: true })
    mkdirSync(join(dir, 'docs'), { recursive: true })
    for (const [rel, tpl] of [
      ['scripts/check-use-cases.mjs', 'scripts/check-use-cases.mjs.ejs'],
      ['schemas/use-case.schema.json', 'schemas/use-case.schema.json.ejs'],
      ['scripts/lib/run-helpers.mjs', 'scripts/lib/run-helpers.mjs.ejs'],
      ['scripts/lib/agent-return-validate.mjs', 'scripts/lib/agent-return-validate.mjs.ejs'],
    ] as const) {
      const rendered = renderTemplate(tpl, data)
      expect(rendered, `${rel} still carries an unrendered EJS tag`).not.toContain('<%')
      writeFileSync(join(dir, rel), rendered)
    }
  }

  const runUc = (): Run => {
    const r = spawnSync('node', [join(dir, 'scripts', 'check-use-cases.mjs')], {
      encoding: 'utf-8',
      cwd: dir,
    })
    return { status: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
  }

  const writeUseCases = (...useCases: Array<Record<string, unknown>>): void => {
    writeFileSync(
      join(dir, 'docs', 'USE_CASES.md'),
      [
        '# Use cases',
        '',
        '<!-- USE_CASES_START -->',
        '```json',
        JSON.stringify({ useCases }, null, 2),
        '```',
        '<!-- USE_CASES_END -->',
        '',
      ].join('\n'),
    )
  }

  const writeFeatureMatrix = (...featureIds: string[]): void => {
    writeFileSync(
      join(dir, 'docs', 'FEATURE_MATRIX.md'),
      [
        '# FEATURE_MATRIX',
        '',
        '| feature_id | capability |',
        '| --- | --- |',
        ...featureIds.map((f) => `| ${f} | a capability |`),
        '',
      ].join('\n'),
    )
  }

  const writeScenario = (exercises: string): void => {
    writeFileSync(
      join(dir, 'docs', 'TABLETOP-SCENARIOS.md'),
      ['# Scenarios', '', '## 1. A journey', '', `- **Exercises:** \`${exercises}\``, ''].join(
        '\n',
      ),
    )
  }

  const UC = {
    id: 'UC-01',
    actor: 'Traveler',
    goal: 'Search and filter trips by name and date',
    featureIds: ['F-TRIP-SEARCH'],
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-uc-trackb-'))
    emitUseCases()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('SKIPs out loud, and never says PASS, when the project has no use cases', () => {
    const r = runUc()
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('[SKIP]')
    expect(r.out).not.toMatch(/PASS/)
  })

  it('passes on a well-formed set whose features resolve', () => {
    writeFeatureMatrix('F-TRIP-SEARCH')
    writeUseCases(UC)
    const r = runUc()
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/1 use case\(s\)/)
  })

  it('FAILS on a featureId the matrix does not declare — the rule the gate exists for', () => {
    writeFeatureMatrix('F-SOMETHING-ELSE')
    writeUseCases(UC)
    const r = runUc()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/featureId "F-TRIP-SEARCH" is not a row/)
  })

  it('FAILS the schema when featureIds is empty — a promise with nothing behind it', () => {
    writeFeatureMatrix('F-TRIP-SEARCH')
    writeUseCases({ ...UC, featureIds: [] })
    const r = runUc()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/use case UC-01/)
  })

  it('FAILS the schema when the actor is missing', () => {
    writeFeatureMatrix('F-TRIP-SEARCH')
    const noActor = Object.fromEntries(Object.entries(UC).filter(([k]) => k !== 'actor'))
    writeUseCases(noActor)
    const r = runUc()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/actor/)
  })

  it('FAILS on a duplicate id', () => {
    writeFeatureMatrix('F-TRIP-SEARCH')
    writeUseCases(UC, UC)
    expect(runUc().out).toMatch(/duplicate use-case id "UC-01"/)
  })

  it('FAILS when use cases exist but the feature matrix does not — every ref is unresolvable', () => {
    writeUseCases(UC)
    const r = runUc()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/is absent — every featureId is unresolvable/)
  })

  it('FAILS on a scenario exercising a use case that does not exist', () => {
    writeFeatureMatrix('F-TRIP-SEARCH')
    writeUseCases(UC)
    writeScenario('UC-99')
    const r = runUc()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/exercises "UC-99", which is not a declared use case/)
  })

  it('FAILS on status "exercised" that no scenario walks — status is not a walk', () => {
    writeFeatureMatrix('F-TRIP-SEARCH')
    writeUseCases({ ...UC, status: 'exercised' })
    const r = runUc()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/claims status "exercised" but no tabletop scenario names it/)
  })

  it('passes "exercised" once a scenario actually names it, and counts the walk', () => {
    writeFeatureMatrix('F-TRIP-SEARCH')
    writeUseCases({ ...UC, status: 'exercised' })
    writeScenario('UC-01')
    const r = runUc()
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/1 exercised by a scenario/)
  })

  it('FAILS on a malformed block rather than skipping past it', () => {
    writeFeatureMatrix('F-TRIP-SEARCH')
    writeFileSync(join(dir, 'docs', 'USE_CASES.md'), '# Use cases\n\nno sentinels here\n')
    const r = runUc()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/sentinel pair/)
  })

  it('reads its schema from the project tree, so the emitted pair is self-sufficient', () => {
    unlinkSync(join(dir, 'schemas', 'use-case.schema.json'))
    writeFeatureMatrix('F-TRIP-SEARCH')
    writeUseCases(UC)
    const r = runUc()
    expect(r.status, 'a missing schema is exit 2 — the gate could not tell, INV-53').toBe(2)
  })
})

/**
 * MS-NN / EP-NN (#2480 wave 8), same harness and the same reason — with one extra edge the other
 * ports did not have: this gate's SELF copy parses YAML, and the emitted twin cannot. `yaml` is
 * arbiter's dependency, no emitted script imports it, and a Go or Python project receives 77 .mjs
 * gates and NO package.json in which to declare one. So the emitted twin reads a fenced JSON block
 * between sentinels, the convention docs/SOURCES.md and docs/USE_CASES.md already use here.
 *
 * That makes "renders correctly" worth even less than usual: the two copies now differ in their
 * READER, so only executing the emitted one proves the rules survived the swap.
 */
describe('the emitted milestone gate runs where it is emitted (#2480 wave 8)', () => {
  let dir: string

  const emitMilestones = (): void => {
    const data = makeConfig(dir, { governanceLevel: 'L2' }) as unknown as Record<string, unknown>
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    mkdirSync(join(dir, 'schemas'), { recursive: true })
    mkdirSync(join(dir, 'docs'), { recursive: true })
    for (const [rel, tpl] of [
      ['scripts/check-milestones.mjs', 'scripts/check-milestones.mjs.ejs'],
      ['schemas/milestone.schema.json', 'schemas/milestone.schema.json.ejs'],
      ['scripts/lib/agent-return-validate.mjs', 'scripts/lib/agent-return-validate.mjs.ejs'],
    ] as const) {
      const rendered = renderTemplate(tpl, data)
      expect(rendered, `${rel} still carries an unrendered EJS tag`).not.toContain('<%')
      writeFileSync(join(dir, rel), rendered)
    }
  }

  const runMs = (...args: string[]): Run => {
    const r = spawnSync('node', [join(dir, 'scripts', 'check-milestones.mjs'), ...args], {
      encoding: 'utf-8',
      cwd: dir,
    })
    return { status: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
  }

  const writePlan = (doc: Record<string, unknown>): void => {
    writeFileSync(
      join(dir, 'docs', 'MILESTONES.md'),
      [
        '# Milestones',
        '',
        '<!-- MILESTONES_START -->',
        '```json',
        JSON.stringify(doc, null, 2),
        '```',
        '<!-- MILESTONES_END -->',
        '',
      ].join('\n'),
    )
  }

  const ms = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'MS-01',
    title: 'A sufficiently long title',
    goal: { claim: 'a claim long enough to pass', strategy: 'a strategy long enough' },
    exit_criteria: [{ id: 'EC-01', description: 'something checkable' }],
    horizon: 'next',
    status: 'planned',
    ...over,
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-ms-trackb-'))
    emitMilestones()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('SKIPs out loud, and never says PASS, when the project codified no roadmap', () => {
    const r = runMs()
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('[SKIP]')
    expect(r.out).not.toMatch(/PASS/)
  })

  it('passes on a well-formed plan — the reader swap did not break the rules', () => {
    writePlan({ milestones: [ms()] })
    const r = runMs()
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/1 milestone\(s\)/)
  })

  it('FAILS on a dependency cycle, reported AS THE PATH', () => {
    writePlan({
      milestones: [ms({ depends_on: ['MS-02'] }), ms({ id: 'MS-02', depends_on: ['MS-01'] })],
    })
    const r = runMs()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/dependency cycle: MS-0[12] -> MS-0[12] -> MS-0[12]/)
  })

  it('FAILS the granularity decay: a `later` milestone may not carry a due date', () => {
    writePlan({ milestones: [ms({ horizon: 'later', due: '2027-01-01' })] })
    expect(runMs().status).toBe(1)
  })

  it('FAILS fail-closed on `done` without exit-criteria evidence', () => {
    writePlan({ milestones: [ms({ status: 'done' })] })
    const r = runMs()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/status is not evidence/)
  })

  it('FAILS a one-sided epic join', () => {
    writePlan({
      milestones: [ms()],
      epics: [{ id: 'EP-01', title: 'An epic title', issue: 1, targets: 'MS-01', status: 'open' }],
    })
    const r = runMs()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/one-sided/)
  })

  it('resolves an INV evidence_ref against AGENTS.md, which is where a project keeps them', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\n- **INV-01:** something\n')
    writePlan({
      milestones: [
        ms({
          status: 'verified',
          exit_criteria: [
            { id: 'EC-01', description: 'something checkable', evidence_ref: 'INV-01' },
          ],
        }),
      ],
    })
    const r = runMs()
    expect(r.status, `a resolvable INV ref must pass — got: ${r.out}`).toBe(0)
  })

  it('FAILS an INV evidence_ref the project does not carry, and is not fooled by a longer id', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\n- **INV-100:** something\n')
    writePlan({
      milestones: [
        ms({
          status: 'verified',
          exit_criteria: [
            { id: 'EC-01', description: 'something checkable', evidence_ref: 'INV-10' },
          ],
        }),
      ],
    })
    const r = runMs()
    expect(r.status, 'INV-10 must not be satisfied by INV-100').toBe(1)
    expect(r.out).toMatch(/does not resolve/)
  })

  // Exit 2, at PARITY with the self copy, which files unreadable YAML the same way. The two
  // copies must agree on their exit contract or "twin" means nothing. Worth noting: the emitted
  // use-case gate files an unreadable SSOT as 1 instead, which is a real inconsistency between two
  // gates written days apart — filed rather than fixed here, because changing a shipped gate's
  // exit code inside an emission commit is an unrelated behaviour change.
  it('reports a malformed sentinel block as an ERROR, never as an empty plan', () => {
    writeFileSync(join(dir, 'docs', 'MILESTONES.md'), '# Milestones\n\nno sentinels\n')
    const r = runMs()
    expect(r.status).toBe(2)
    expect(r.out).toMatch(/sentinel block/)
  })

  it('reports malformed JSON inside the fence — broken and empty must not share a verdict', () => {
    writeFileSync(
      join(dir, 'docs', 'MILESTONES.md'),
      '# Milestones\n\n<!-- MILESTONES_START -->\n```json\n{not json\n```\n<!-- MILESTONES_END -->\n',
    )
    const r = runMs()
    expect(r.status).toBe(2)
    expect(r.out).toMatch(/not valid JSON/)
  })

  it('--emit writes the projection only after every rule passes', () => {
    writePlan({ milestones: [ms()] })
    expect(runMs('--emit', join(dir, 'out.json')).status).toBe(0)
    const proj = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf-8'))
    expect(proj.schema).toBe('arbiter-milestones-v1')
    expect(proj.milestones).toHaveLength(1)
  })

  it('--emit writes NOTHING when a rule fails — an invalid plan cannot produce a projection', () => {
    writePlan({ milestones: [ms({ status: 'done' })] })
    expect(runMs('--emit', join(dir, 'out.json')).status).toBe(1)
    expect(existsSync(join(dir, 'out.json'))).toBe(false)
  })

  it('exits 2, not 1, when its schema is missing — the gate could not tell (INV-53)', () => {
    unlinkSync(join(dir, 'schemas', 'milestone.schema.json'))
    writePlan({ milestones: [ms()] })
    expect(runMs().status).toBe(2)
  })
})
