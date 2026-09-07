// INV-144: the architecture document is a filled structure, not a surviving skeleton.
// Every assertion below is tamper-shaped: the gate must go red on the defect AND green once the
// defect is removed, so a green run is evidence rather than the absence of a signal.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import {
  SLOTS,
  allSkeletonSlots,
  gapsByColumn,
  skeletonSlots,
  normalizeHeading,
  slotForHeading,
  splitSections,
  isStub,
  analyzeDocument,
  skeletonGaps,
} from '../../scripts/check-arc42-slots.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const GATE = join(ROOT, 'scripts/check-arc42-slots.mjs')

const created: string[] = []
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true })
})

// Derived from the REAL canvas skeleton, never hand-listed. The hand-listed nine-element version
// silently became a fiction the moment ARC-01 was added to the skeleton, and nothing failed —
// a fixture that grades itself proves nothing about the artifact it claims to model.
const CANVAS_SLOTS = analyzeDocument(
  readFileSync(join(ROOT, 'src/templates/docs/skeletons/arc42-canvas.md.ejs'), 'utf-8'),
).slots

function write(dir: string, rel: string, body: string): void {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

/** A section list rendered as markdown; `null` body means an unfilled (comment-only) section. */
function docOf(sections: [string, string | null][]): string {
  return sections.map(([h, b]) => `## ${h}\n\n${b === null ? '<!-- prompt -->' : b}\n`).join('\n')
}

const SLOT_HEADINGS: Record<string, string> = {
  'ARC-01': 'Introduction and Goals',
  'ARC-02': 'Constraints',
  'ARC-03': 'Context',
  'ARC-04': 'Solution strategy',
  'ARC-05': 'Building blocks',
  'ARC-06': 'Runtime',
  'ARC-07': 'Deployment',
  'ARC-08': 'Cross-cutting concepts',
  'ARC-09': 'Decisions',
  'ARC-10': 'Quality',
  'ARC-11': 'Risks',
  'ARC-12': 'Glossary',
}

function fixture(
  opts: {
    docSlots?: string[]
    stubSlots?: string[]
    skeleton?: string[] | null
    baseline?: Record<string, unknown> | null
    baselineRaw?: string
    arc42Row?: boolean
    docPresent?: boolean
  } = {},
): string {
  const {
    docSlots = CANVAS_SLOTS,
    stubSlots = [],
    skeleton = CANVAS_SLOTS,
    baseline = { stubs: 0, skeletonGaps: { solo: 3, small: 3, enterprise: 0 } },
    baselineRaw,
    arc42Row = true,
    docPresent = true,
  } = opts

  const dir = mkdtempSync(join(tmpdir(), 'arbiter-arc42-'))
  created.push(dir)

  write(
    dir,
    'standards/gold-doc-set.yml',
    arc42Row
      ? `checks:\n  - path: docs/architecture/arc42.md\n    tier: mandatory\n    applies: always\n    accept_any: ['docs/architecture/arc42.md']\n    template: arc42\n    purpose: arch.\n`
      : `checks:\n  - path: README.md\n    tier: mandatory\n    applies: always\n    purpose: readme.\n`,
  )
  // trunk-solo -> the 'solo' column -> the Canvas skeleton, with no floor to raise it.
  write(dir, 'arbiter.json', JSON.stringify({ collaborationMode: 'trunk-solo' }))
  write(dir, 'standards/doc-profile', 'overlays: []\nallow: []\n')

  if (skeleton !== null) {
    write(
      dir,
      'src/templates/docs/skeletons/arc42-canvas.md.ejs',
      docOf(skeleton.map((id) => [SLOT_HEADINGS[id], null] as [string, string | null])),
    )
    // A real arbiter ships BOTH skeletons, and ratchet #2 now evaluates every column — an absent
    // skeleton is twelve gaps, not a column to skip. A fixture with only the canvas would fail on
    // the enterprise column for a reason that has nothing to do with the case under test.
    write(
      dir,
      'src/templates/docs/skeletons/arc42-full.md.ejs',
      docOf(SLOTS.map((sl) => [sl.title, null] as [string, string | null])),
    )
  }
  if (docPresent) {
    write(
      dir,
      'docs/architecture/arc42.md',
      docOf(
        docSlots.map(
          (id) =>
            [SLOT_HEADINGS[id], stubSlots.includes(id) ? null : `Real content for ${id}.`] as [
              string,
              string | null,
            ],
        ),
      ),
    )
  }
  if (baselineRaw !== undefined) write(dir, 'scripts/data/arc42-baseline.json', baselineRaw)
  else if (baseline !== null) {
    write(dir, 'scripts/data/arc42-baseline.json', `${JSON.stringify(baseline, null, 2)}\n`)
  }
  return dir
}

function run(dir: string, ...args: string[]) {
  // --skeleton-root pins the skeletons to the FIXTURE, not to arbiter's real ones: in production
  // the two roots differ (arbiter's install vs. the governed tree being audited) and a test that
  // silently read the real skeletons would be asserting against arbiter, not against the fixture.
  const r = spawnSync('node', [GATE, '--dir', dir, '--skeleton-root', dir, ...args], {
    encoding: 'utf-8',
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

describe('normalizeHeading', () => {
  it('drops section numbering in every shape a real arc42 uses', () => {
    expect(normalizeHeading('3. Context & Scope')).toBe('context and scope')
    expect(normalizeHeading('5.1 Building Blocks')).toBe('building blocks')
    expect(normalizeHeading('ARC-03 — Context')).toBe('context')
  })

  it('treats a hyphen as typography, not meaning', () => {
    // The bug this pins: `Cross-cutting concepts` is the heading BOTH arbiter skeletons use, and a
    // matcher that only knew `crosscutting` reported the slot as absent.
    expect(normalizeHeading('Cross-cutting concepts')).toBe('cross cutting concepts')
    expect(normalizeHeading('Crosscutting Concepts')).toBe('crosscutting concepts')
  })

  it('strips trailing punctuation and collapses whitespace', () => {
    expect(normalizeHeading('  Quality   Requirements:  ')).toBe('quality requirements')
  })
})

describe('slotForHeading', () => {
  it('resolves every slot from the heading each arbiter skeleton actually writes', () => {
    for (const [id, heading] of Object.entries(SLOT_HEADINGS)) {
      expect(slotForHeading(heading), `${id} via "${heading}"`).toBe(id)
    }
  })

  it('resolves the numbered canonical headings arbiter uses in its own arc42', () => {
    expect(slotForHeading('1. Introduction & Goals')).toBe('ARC-01')
    expect(slotForHeading('8. Crosscutting Concepts')).toBe('ARC-08')
    expect(slotForHeading('11. Risks & Technical Debt')).toBe('ARC-11')
  })

  it('returns null for an addition — arc42 permits extra sections', () => {
    expect(slotForHeading('C4 — Context & Container')).toBeNull()
    expect(slotForHeading('Reading order')).toBeNull()
  })
})

describe('splitSections', () => {
  it('ignores a heading inside a fenced code block', () => {
    const md = ['## Real', 'body', '```md', '## Not a section', '```', '## Also real', 'x'].join(
      '\n',
    )
    expect(splitSections(md).map((s) => s.heading)).toEqual(['Real', 'Also real'])
  })

  it('keeps the fenced heading as part of the enclosing section body', () => {
    const md = ['## Real', '```md', '## Not a section', '```'].join('\n')
    expect(splitSections(md)[0].body).toContain('## Not a section')
  })
})

describe('isStub', () => {
  it('is true for a body that is only the skeleton prompt', () => {
    expect(isStub('\n<!-- System scope and boundary. -->\n')).toBe(true)
  })

  it('is true for a body that is exactly one placeholder token', () => {
    for (const token of ['TBD', 'todo', 'N/A', '—', '?', 'none']) expect(isStub(token)).toBe(true)
  })

  it('is false for prose that merely MENTIONS a placeholder', () => {
    // The false positives that killed the first keyword-scan design: prose ABOUT the marker.
    // The literal is assembled rather than spelled inline because scripts/debt-lib.mjs's
    // countTodos is a bare `\bTODO\b` line scan over .ts files — writing it out would add this
    // test's own prose to the repo's technical-debt count, which is precisely the false-positive
    // class under test here.
    const marker = ['TO', 'DO'].join('')
    expect(
      isStub(
        `The check-no-orphan-${marker.toLowerCase()} hook blocks a bare ${marker} with no id.`,
      ),
    ).toBe(false)
    expect(isStub('Technical debt: 14 items tracked, none of them TBD.')).toBe(false)
  })
})

describe('analyzeDocument', () => {
  it('reports the slots present and which of them are hollow', () => {
    const a = analyzeDocument(
      docOf([
        ['Context', 'real'],
        ['Constraints', null],
      ]),
    )
    expect(a.slots).toEqual(['ARC-02', 'ARC-03'])
    expect(a.stubs).toEqual(['ARC-02'])
  })

  it('counts a slot split across two headings as filled when either half has content', () => {
    const a = analyzeDocument(
      docOf([
        ['Risks', null],
        ['Technical debt', 'three items'],
      ]),
    )
    expect(a.slots).toEqual(['ARC-11'])
    expect(a.stubs).toEqual([])
  })
})

describe('skeletonGaps', () => {
  it('names the canonical slots a skeleton omits', () => {
    // Two, not three: the real canvas carries ARC-01. The hand-listed fixture said three and was
    // wrong from the moment the skeleton gained that section — see the derived CANVAS_SLOTS above.
    expect(skeletonGaps(CANVAS_SLOTS)).toEqual(['ARC-08', 'ARC-12'])
  })

  it('is empty for a skeleton carrying all twelve', () => {
    expect(skeletonGaps(SLOTS.map((s) => s.id))).toEqual([])
  })
})

describe('the gate', () => {
  it('passes a document that fills every slot its skeleton provides', () => {
    const r = run(fixture())
    expect(r.out).toContain('PASS')
    expect(r.code).toBe(0)
  })

  it('fails, naming the slot, when the document dropped one the skeleton provides', () => {
    const r = run(fixture({ docSlots: CANVAS_SLOTS.filter((id) => id !== 'ARC-06') }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('slot ARC-06 (Runtime View) is absent')
  })

  it('fails when a hollow section is ADDED above the baseline', () => {
    const r = run(
      fixture({
        stubSlots: ['ARC-04'],
        baseline: { stubs: 0, skeletonGaps: { solo: 3, small: 3, enterprise: 0 } },
      }),
    )
    expect(r.code).toBe(1)
    expect(r.out).toContain('1 hollow slot(s) (ARC-04)')
  })

  it('passes a hollow section the baseline already accounts for', () => {
    const r = run(
      fixture({
        stubSlots: ['ARC-04'],
        baseline: { stubs: 1, skeletonGaps: { solo: 3, small: 3, enterprise: 0 } },
      }),
    )
    expect(r.code).toBe(0)
  })

  it('fails when a slot is dropped from the skeleton, lowering the bar silently', () => {
    // The skeleton loses ARC-10; the document loses it too, so the instance check is clean. Only the
    // skeleton-gap ratchet catches it — which is the whole reason that second ratchet exists.
    const shrunk = CANVAS_SLOTS.filter((id) => id !== 'ARC-10')
    const r = run(
      fixture({
        skeleton: shrunk,
        docSlots: shrunk,
        baseline: { stubs: 0, skeletonGaps: { solo: 2, small: 2, enterprise: 0 } },
      }),
    )
    expect(r.code).toBe(1)
    expect(r.out).toContain('arc42 skeleton omits 3 canonical slot(s)')
  })

  it('fails when the emitted required set has drifted from the skeleton', () => {
    const r = run(
      fixture({
        baseline: {
          stubs: 0,
          skeletonGaps: { solo: 3, small: 3, enterprise: 0 },
          required: ['ARC-02', 'ARC-03'],
        },
      }),
    )
    expect(r.code).toBe(1)
    expect(r.out).toContain('has drifted from')
  })

  it('holds a governed project to the emitted required set when no skeleton exists', () => {
    const r = run(
      fixture({
        skeleton: null,
        docSlots: CANVAS_SLOTS.filter((id) => id !== 'ARC-06'),
        baseline: {
          stubs: 0,
          skeletonGaps: { solo: 3, small: 3, enterprise: 0 },
          required: CANVAS_SLOTS,
        },
      }),
    )
    expect(r.code).toBe(1)
    expect(r.out).toContain('slot ARC-06 (Runtime View) is absent')
  })

  it('refuses --update-baseline when the numbers rose', () => {
    const r = run(
      fixture({
        stubSlots: ['ARC-04'],
        baseline: { stubs: 0, skeletonGaps: { solo: 3, small: 3, enterprise: 0 } },
      }),
      '--update-baseline',
    )
    expect(r.code).toBe(1)
    expect(r.out).toContain('refusing --update-baseline')
  })

  it('accepts --update-baseline when the numbers fell, and records the required set', () => {
    const dir = fixture({
      baseline: { stubs: 4, skeletonGaps: { solo: 3, small: 3, enterprise: 0 } },
    })
    expect(run(dir, '--update-baseline').code).toBe(0)
    const written = JSON.parse(
      readFileSync(join(dir, 'scripts/data/arc42-baseline.json'), 'utf-8'),
    ) as { stubs: number; required: string[] }
    expect(written.stubs).toBe(0)
    expect(written.required).toEqual(CANVAS_SLOTS)
  })

  it('skips, not fails, when the project has no architecture document', () => {
    const r = run(fixture({ docPresent: false }))
    expect(r.code).toBe(0)
    expect(r.out).toContain('[SKIP]')
  })

  it('skips when the manifest has no arc42 row', () => {
    const r = run(fixture({ arc42Row: false }))
    expect(r.code).toBe(0)
    expect(r.out).toContain('no arc42 row')
  })

  it('skips when neither a skeleton nor an emitted required set exists', () => {
    const r = run(fixture({ skeleton: null, baseline: { stubs: 0 } }))
    expect(r.code).toBe(0)
    expect(r.out).toContain('[SKIP]')
  })

  it('errors (exit 2) on a malformed baseline rather than reporting a clean tree', () => {
    const r = run(fixture({ baselineRaw: '{ not json' }))
    expect(r.code).toBe(2)
    expect(r.out).toContain('ERROR')
  })

  it('is green on arbiter itself, and reports the real document, not the first alias listed', () => {
    const r = spawnSync('node', [GATE, '--json'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout) as { doc: string; column: string; violations: string[] }
    // accept_any lists docs/architecture/ARCHITECTURE.md first; the arc42 is the one that is
    // arc42-SHAPED, and picking by list order resolved a reading-order hub page instead.
    expect(parsed.doc).toBe('docs/architecture/arc42.md')
    // tier_floor: enterprise in standards/doc-profile raises the trunk-solo column.
    expect(parsed.column).toBe('enterprise')
    expect(parsed.violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The real artifacts. Everything above uses fixtures; these read what actually ships, which is
// the only thing that can catch a skeleton and its fixture drifting apart.
// ---------------------------------------------------------------------------

describe('the real skeletons (not fixtures)', () => {
  it('the canvas provides exactly the slots CANVAS_SLOTS derives, and never fewer than nine', () => {
    // Guards the drift that actually happened: ARC-01 was added to the skeleton and the
    // hand-listed fixture constant stayed at nine, invisibly.
    expect(CANVAS_SLOTS.length).toBeGreaterThanOrEqual(9)
    expect(CANVAS_SLOTS).toContain('ARC-01')
  })

  it('the full skeleton provides all twelve canonical slots', () => {
    const full = analyzeDocument(
      readFileSync(join(ROOT, 'src/templates/docs/skeletons/arc42-full.md.ejs'), 'utf-8'),
    ).slots
    expect(skeletonGaps(full)).toEqual([])
  })

  it('every shipped column resolves to a skeleton, and the canvas drops exactly two by design', () => {
    const gaps = gapsByColumn(allSkeletonSlots(ROOT))
    expect(Object.keys(gaps).sort()).toEqual(['enterprise', 'small', 'solo'])
    expect(gaps.enterprise).toEqual([])
    expect(gaps.solo).toEqual(['ARC-08', 'ARC-12'])
  })

  it('resolves skeletons from dist/ when src/ is absent — the PUBLISHED layout', () => {
    // #2480: SKELETON_FOR_COLUMN hardcoded src/templates, which exists only in a dev checkout.
    // Every consumer therefore got `required === null` and a permanent silent SKIP. No fixture
    // test could see this, because fixtures always pass --skeleton-root.
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-arc42-pkg-'))
    created.push(dir)
    mkdirSync(join(dir, 'dist'), { recursive: true })
    cpSync(join(ROOT, 'src/templates'), join(dir, 'dist/templates'), { recursive: true })
    expect(existsSync(join(dir, 'src'))).toBe(false)

    const { rel, slots } = skeletonSlots(dir, 'enterprise')
    expect(rel.startsWith('dist/templates')).toBe(true)
    expect(slots).not.toBeNull()
    expect(slots).toHaveLength(12)
  })

  it('prefers src/ over dist/ in a dev checkout, so an edited skeleton is not graded against a stale build', () => {
    expect(skeletonSlots(ROOT, 'enterprise').rel.startsWith('src/templates')).toBe(true)
  })
})

describe('defeats the review found', () => {
  it('a non-numeric stubs counter is an ERROR, never a silent bootstrap', () => {
    // `"stubs": "0"` — a two-character diff reading as a formatting nit — used to disable the
    // ratchet permanently while --json kept reporting baseline == stubs, i.e. health.
    const r = run(fixture({ baselineRaw: '{"stubs":"0"}' }))
    expect(r.code).toBe(2)
    expect(r.out).toContain('not a whole count')
  })

  it('a scalar skeletonGaps is an ERROR — it left every non-audited column unguarded', () => {
    const r = run(fixture({ baselineRaw: '{"stubs":0,"skeletonGaps":0}' }))
    expect(r.code).toBe(2)
    expect(r.out).toContain('not a per-column object')
  })

  it('a document carrying no slots at all is a violation, not a skip', () => {
    // "# Architecture / See the wiki." scored 0, skipped, exited 0 — and check-doc-set stayed
    // green because the file exists, so together they certified an empty document.
    const dir = fixture()
    write(dir, 'docs/architecture/arc42.md', '# Architecture\n\nSee the wiki.\n')
    const r = run(dir)
    expect(r.code).toBe(1)
    expect(r.out).toContain('carries none of the twelve arc42 slots')
  })

  it('the official arc42 v8 English headings all resolve', () => {
    // A document copied verbatim from arc42.org failed: the canonical section 11 title is
    // "Risks and Technical Debts", plural.
    expect(slotForHeading('11. Risks and Technical Debts')).toBe('ARC-11')
    expect(slotForHeading('Design Decisions')).toBe('ARC-09')
    expect(slotForHeading('Business Context')).toBe('ARC-03')
    expect(slotForHeading('Technical Context')).toBe('ARC-03')
    expect(slotForHeading('Quality Tree')).toBe('ARC-10')
  })

  it('a subsection heading cannot satisfy the slot its parent section owns', () => {
    // `## 1.2 Quality goals` has its numbering stripped; when `quality goals` was an ARC-10 alias
    // a filled subsection masked a hollow section 10 entirely.
    expect(slotForHeading('1.2 Quality goals')).not.toBe('ARC-10')
    expect(slotForHeading('Purpose')).not.toBe('ARC-01')
  })

  it('--update-baseline creates scripts/data/ instead of crashing on a project without it', () => {
    // A generated project has scripts/ but not scripts/data/; the unguarded write was an ENOENT
    // surfaced as a document violation.
    const dir = fixture({ baseline: null })
    expect(existsSync(join(dir, 'scripts/data'))).toBe(false)
    const r = run(dir, '--update-baseline')
    expect(r.code).toBe(0)
    expect(existsSync(join(dir, 'scripts/data/arc42-baseline.json'))).toBe(true)
  })

  it('seeds the baseline on a clean first run, so the ratchet is armed in a governed project', () => {
    // Tolerating the count only in memory meant no governed project ever grew a baseline, so
    // `allowed` was recomputed as "whatever it is today" forever.
    const dir = fixture({ baseline: null })
    expect(run(dir).code).toBe(0)
    const written = JSON.parse(
      readFileSync(join(dir, 'scripts/data/arc42-baseline.json'), 'utf-8'),
    ) as { stubs: number; skeletonGaps: Record<string, number> }
    expect(written.stubs).toBe(0)
    expect(typeof written.skeletonGaps).toBe('object')
  })

  it('the duplicate-slot rule holds in the FILLED-then-stub order too', () => {
    // The original test used stub-then-filled, which a naive last-wins implementation also
    // satisfies — the rule it named was never actually exercised.
    const a = analyzeDocument(
      docOf([
        ['Risks', 'three items'],
        ['Technical debt', null],
      ]),
    )
    expect(a.slots).toEqual(['ARC-11'])
    expect(a.stubs).toEqual([])
  })

  it('picks the most arc42-shaped candidate, not the first alias listed', () => {
    const dir = fixture()
    write(
      dir,
      'standards/gold-doc-set.yml',
      'checks:\n  - path: docs/architecture/HUB.md\n    tier: mandatory\n    applies: always\n' +
        "    accept_any: ['docs/architecture/HUB.md', 'docs/architecture/arc42.md']\n" +
        '    template: arc42\n    purpose: arch.\n',
    )
    write(dir, 'docs/architecture/HUB.md', '## Context\n\nA reading-order hub.\n')
    const r = run(dir, '--json')
    expect(r.code).toBe(0)
    expect(r.out).toContain('docs/architecture/arc42.md')
  })
})

// ---------------------------------------------------------------------------
// Round 2 of the adversarial review. Each of these was a live defeat of a fix from round 1 —
// the gate reported PASS (or a clean SKIP) on something a reviewer would call broken.
// ---------------------------------------------------------------------------

describe('round-2 defeats', () => {
  it('a fully commented-out document scores zero, not twelve', () => {
    // The worst of them: slicing sections BEFORE stripping HTML comments gave every slot a body
    // containing the unbalanced `-->` residue, which isStub read as content. A file that renders
    // as a single H1 earned a perfect 12/12.
    const inner = SLOTS.map((sl) => `## ${sl.title}\n\nx\n`).join('\n')
    const a = analyzeDocument(`# Architecture\n\n<!--\n${inner}\n-->\n`)
    expect(a.slots).toEqual([])
  })

  it("reads a document whose sections are `#`, the level arc42's own single-file template uses", () => {
    const md = SLOTS.map((sl) => `# ${sl.title}\n\nreal prose\n`).join('\n')
    const a = analyzeDocument(md)
    expect(a.slots).toHaveLength(12)
    expect(a.stubs).toEqual([])
  })

  it('still reads `##` when no heading matches a slot, rather than reinterpreting the level', () => {
    expect(splitSections('## Real\n\nbody\n\n## Also real\n\nbody').map((x) => x.heading)).toEqual([
      'Real',
      'Also real',
    ])
  })

  it('an unterminated fence does not swallow every heading after it', () => {
    const a = analyzeDocument('## Introduction\n\n```\n## Glossary\n\n## Runtime\n\nx')
    expect(a.slots.length).toBeGreaterThan(1)
  })

  it('a closed-ATX heading resolves', () => {
    expect(analyzeDocument('## Glossary ##\n\nx\n').slots).toEqual(['ARC-12'])
  })

  it('deleting a column from skeletonGaps is an ERROR, not a silent re-permit', () => {
    const r = run(fixture({ baselineRaw: '{"stubs":0,"skeletonGaps":{"solo":3,"small":3}}' }))
    expect(r.code).toBe(2)
    expect(r.out).toContain('every shipped column must be pinned')
  })

  it('an array skeletonGaps is an ERROR', () => {
    const r = run(fixture({ baselineRaw: '{"stubs":0,"skeletonGaps":[]}' }))
    expect(r.code).toBe(2)
  })

  it('an absent skeleton counts as twelve gaps, so deleting one cannot delete its column', () => {
    // gapsByColumn used to omit a null column entirely, which did not lower the bar — it removed
    // the bar for every project on that column.
    const gaps = gapsByColumn({ solo: null, small: ['ARC-01'], enterprise: SLOTS.map((x) => x.id) })
    expect(gaps.solo).toHaveLength(12)
    expect(gaps.enterprise).toEqual([])
  })

  it('does not grade a C4 model against arc42 — the manifest admits that format on purpose', () => {
    const dir = fixture()
    write(
      dir,
      'standards/gold-doc-set.yml',
      'checks:\n  - path: docs/architecture/c4-model.md\n    tier: mandatory\n    applies: always\n' +
        "    accept_any: ['docs/architecture/c4-model.md']\n    template: arc42\n    purpose: arch.\n",
    )
    write(dir, 'docs/architecture/c4-model.md', '# C4\n\n## System Landscape\n\nreal\n')
    const r = run(dir)
    expect(r.code).toBe(0)
    expect(r.out).toContain('non-arc42 architecture format')
  })

  it('the seed omits `required`, so promoting the tier is not reported as drift', () => {
    // `required` is column-specific; seeding it under one column made the next run after a tier
    // promotion claim the required set had "drifted" when only the column had changed.
    const dir = fixture({ baseline: null })
    expect(run(dir).code).toBe(0)
    const seeded = JSON.parse(
      readFileSync(join(dir, 'scripts/data/arc42-baseline.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(Object.keys(seeded).sort()).toEqual(['skeletonGaps', 'stubs'])
  })
})

describe('a ratchet counter is a whole count, not merely a number', () => {
  // Found by probing the round-2 fixes directly: `"0"` was rejected, but three shapes that are
  // *typeof number* still disabled the ratchet. Each is a value that reads as innocuous in a diff.
  const cases: Array<[string, string]> = [
    ['Infinity via 1e999', '{"stubs":1e999,"skeletonGaps":{"solo":3,"small":3,"enterprise":0}}'],
    ['a float', '{"stubs":0.5,"skeletonGaps":{"solo":3,"small":3,"enterprise":0}}'],
    ['null', '{"stubs":null,"skeletonGaps":{"solo":3,"small":3,"enterprise":0}}'],
    ['Infinity in a column', '{"stubs":0,"skeletonGaps":{"solo":1e999,"small":3,"enterprise":0}}'],
  ]
  for (const [label, raw] of cases) {
    it(`rejects ${label} with exit 2`, () => {
      expect(run(fixture({ baselineRaw: raw })).code).toBe(2)
    })
  }

  it('rejects an unknown column even when it is named __proto__', () => {
    // `'__proto__' in obj` is true for every object, so an `in` check let this key through; the
    // guard uses Object.hasOwn now.
    const raw = '{"stubs":0,"skeletonGaps":{"solo":3,"small":3,"enterprise":0,"__proto__":9}}'
    expect(run(fixture({ baselineRaw: raw })).code).toBe(2)
  })
})

describe('the section parser, probed the way round 2 probed it', () => {
  it('a longer fence is not closed by a shorter one', () => {
    expect(analyzeDocument('## Glossary\n\n````md\n```\n## Runtime\n```\n````\n').slots).toEqual([
      'ARC-12',
    ])
  })

  it('handles ~~~ fences and CRLF line endings', () => {
    expect(analyzeDocument('## Glossary\n\n~~~\n## Runtime\n~~~\n').slots).toEqual(['ARC-12'])
    expect(
      analyzeDocument('## Glossary\r\n\r\nreal\r\n\r\n## Runtime\r\n\r\nreal\r\n'),
    ).toBeTruthy()
    expect(
      analyzeDocument('## Glossary\r\n\r\nreal\r\n\r\n## Runtime\r\n\r\nreal\r\n').slots,
    ).toHaveLength(2)
  })

  it('a fence inside an HTML comment cannot toggle fence state', () => {
    expect(analyzeDocument('<!--\n```\n-->\n## Glossary\n\nreal\n').slots).toEqual(['ARC-12'])
  })

  it('picks the level the document actually uses when levels are mixed', () => {
    const md =
      SLOTS.slice(0, 10)
        .map((sl) => `## ${sl.title}\n\nx\n`)
        .join('') +
      SLOTS.slice(10)
        .map((sl) => `# ${sl.title}\n\nx\n`)
        .join('')
    expect(analyzeDocument(md).slots).toHaveLength(10)
  })

  it('a blockquoted heading is not a section', () => {
    expect(analyzeDocument('> ## Glossary\n\nx\n').slots).toEqual([])
  })
})
