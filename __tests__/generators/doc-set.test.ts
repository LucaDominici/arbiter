// SPDX-License-Identifier: Apache-2.0
// T3 (gold-doc-capability Tranche 3, gold-doc-tranches-t3-t5.md §1) — real per-doc skeleton
// generator tests. Closes H5: before this file (and src/generators/doc-set.ts) existed, the ONLY
// body `arbiter doc-set` (or any --generate) could produce was a one-line
// "> **STUB — fill me in.**" banner (scripts/check-doc-set.mjs `stubFor()`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGoldKit } from '../../src/generators/gold-kit.js'
import { generateDocSetSkeletons, runDocSetPlanApply } from '../../src/generators/doc-set.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
  // Seed the manifest + profile the same way `init` would (registry.ts runs doc-set-skeletons
  // immediately after gold-kit) — the generator shells the REAL engine against this manifest.
  generateGoldKit(makeConfig(dir))
})

afterEach(() => {
  cleanupTestProject(dir)
})

function setOverlays(overlays: string[]): void {
  writeFileSync(
    join(dir, 'standards', 'doc-profile'),
    `overlays:\n${overlays.map((o) => `  - ${o}`).join('\n')}\nallow: []\n`,
  )
}

describe('generateDocSetSkeletons — real bodies, not a banner (RED before this file existed)', () => {
  it('scaffolds docs/architecture/ARCHITECTURE.md with real arc42 section headers, no STUB banner', () => {
    const result = generateDocSetSkeletons(makeConfig(dir))
    const path = join(dir, 'docs', 'architecture', 'ARCHITECTURE.md')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content).not.toContain('STUB — fill me in')
    expect(content).toContain('## Context')
    expect(content).toContain('## Building blocks')
    expect(content).toContain('## Decisions')
    const scaffolded = result.scaffolded.find((s) => s.template === 'arc42')
    expect(scaffolded?.action).toBe('created')
  })

  it('scaffolds docs/GLOSSARY.md as a term table (activates the pre-existing template: glossary binding)', () => {
    generateDocSetSkeletons(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'GLOSSARY.md'), 'utf-8')
    expect(content).not.toContain('STUB — fill me in')
    expect(content).toContain('| Term | Definition | Owner |')
  })

  it('scaffolds docs/technical-debt.md as a register table', () => {
    generateDocSetSkeletons(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'technical-debt.md'), 'utf-8')
    expect(content).toContain('| Item | Class | Interest | Plan |')
  })

  it('scaffolds docs/GOVERNANCE.md with decision-rights/gate-ladder/escalation headers', () => {
    generateDocSetSkeletons(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'GOVERNANCE.md'), 'utf-8')
    expect(content).toContain('## Decision rights')
    expect(content).toContain('## Gate ladder')
    expect(content).toContain('## Escalation')
  })

  it('every scaffolded .md skeleton carries conforming frontmatter (title/doc_version/last_review/...)', () => {
    generateDocSetSkeletons(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'GOVERNANCE.md'), 'utf-8')
    expect(content).toMatch(/^---\ntitle: 'GOVERNANCE'\n/)
    expect(content).toMatch(/doc_version: '0\.1\.0'/)
    expect(content).toMatch(/last_review: '\d{4}-\d{2}-\d{2}'/)
  })

  it('--plan (dryRun) writes nothing to disk but reports the would-scaffold rows', () => {
    const result = generateDocSetSkeletons(makeConfig(dir), { dryRun: true })
    expect(existsSync(join(dir, 'docs', 'architecture', 'ARCHITECTURE.md'))).toBe(false)
    expect(existsSync(join(dir, 'docs', 'GLOSSARY.md'))).toBe(false)
    const arc42 = result.scaffolded.find((s) => s.template === 'arc42')
    expect(arc42?.action).toBe('created') // prospective action, same shape as a real run
  })

  it('second --apply is idempotent (the row is now present, not missing — content is untouched)', () => {
    generateDocSetSkeletons(makeConfig(dir))
    const before = readFileSync(join(dir, 'docs', 'architecture', 'ARCHITECTURE.md'), 'utf-8')
    const second = generateDocSetSkeletons(makeConfig(dir))
    expect(readFileSync(join(dir, 'docs', 'architecture', 'ARCHITECTURE.md'), 'utf-8')).toBe(before)
    // The row satisfies presence now — no longer in missing[], and its real content is not an
    // untouched banner stub, so present[] correctly leaves it alone (no entry either way).
    expect(second.scaffolded.some((s) => s.template === 'arc42')).toBe(false)
  })
})

describe('generateDocSetSkeletons — the ADR dir/glob row (targetOverride)', () => {
  it('writes docs/ADR/ADR-000_template.md (uppercase, matching the glob row), reusing the ADR template', () => {
    const result = generateDocSetSkeletons(makeConfig(dir, { projectName: 'acme-widgets' }))
    const path = join(dir, 'docs', 'ADR', 'ADR-000_template.md')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('# ADR-NNN: Title')
    expect(content).toContain('**Project:** acme-widgets')
    const scaffolded = result.scaffolded.find((s) => s.template === 'adr-seed')
    expect(scaffolded?.path).toBe('docs/ADR/ADR-000_template.md')
  })
})

describe('generateDocSetSkeletons — banner-upgrade path (§1.2c)', () => {
  it('upgrades a byte-equal engine banner stub to the real skeleton', () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    // Scaffold the banner exactly the way the engine's own --generate does, so this is a true
    // byte-equal engine artifact, not a hand-authored approximation of one.
    const engineStub = [
      '---',
      "title: 'GOVERNANCE'",
      "doc_version: '0.1.0'",
      'status: draft',
      `last_review: '2020-01-01'`, // an earlier day — upgrade must not require same-day
      "owner: ''",
      "canonical_id: ''",
      "tags: ['audience/dev', 'kind/reference']",
      'related: []',
      '---',
      '',
      '# GOVERNANCE',
      '',
      '> **STUB — fill me in.** Scaffolded by `check-doc-set --generate` to satisfy the gold doc-set. Governance model — how decisions and gates work.',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'docs', 'GOVERNANCE.md'), engineStub)

    const result = generateDocSetSkeletons(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'GOVERNANCE.md'), 'utf-8')
    expect(content).not.toContain('STUB — fill me in')
    expect(content).toContain('## Decision rights')
    const scaffolded = result.scaffolded.find((s) => s.path === 'docs/GOVERNANCE.md')
    expect(
      scaffolded?.action === 'replaced' || scaffolded?.action === 'backed-up-and-replaced',
    ).toBe(true)
  })

  it('withholds (never touches) a banner stub with one hand-edited character', () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const handEdited = [
      '---',
      "title: 'GOVERNANCE'",
      "doc_version: '0.1.0'",
      'status: draft',
      `last_review: '${today}'`,
      "owner: ''",
      "canonical_id: ''",
      "tags: ['audience/dev', 'kind/reference']",
      'related: []',
      '---',
      '',
      '# GOVERNANCE',
      '',
      // one character changed from the real banner ("Governance." -> "Governance!") — must
      // withhold, not just "still contains the STUB phrase" (a substring check would wrongly
      // overwrite this).
      '> **STUB — fill me in.** Scaffolded by `check-doc-set --generate` to satisfy the gold doc-set. Governance model — how decisions and gates work!',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'docs', 'GOVERNANCE.md'), handEdited)

    const result = generateDocSetSkeletons(makeConfig(dir))
    expect(readFileSync(join(dir, 'docs', 'GOVERNANCE.md'), 'utf-8')).toBe(handEdited)
    // Present + not a byte-equal stub -> never touched at all, not even a bookkeeping write.
    expect(result.scaffolded.some((s) => s.path === 'docs/GOVERNANCE.md')).toBe(false)
  })
})

describe('generateDocSetSkeletons — right-sizing is inherited from the engine, never re-derived', () => {
  it('the SLO/threat-model rows never appear (and are never scaffolded) while `deploys`/`customer-data` are off', () => {
    setOverlays([]) // gold-kit default has-plugin-api/has-api left OFF too by this override
    const result = generateDocSetSkeletons(makeConfig(dir))
    expect(result.scaffolded.some((s) => s.template === 'slo')).toBe(false)
    expect(result.scaffolded.some((s) => s.template === 'threat-model')).toBe(false)
    expect(existsSync(join(dir, 'docs', 'operations', 'slo.md'))).toBe(false)
  })

  it('scaffolds docs/operations/slo.md with SLO section headers once `deploys` is enabled', () => {
    setOverlays(['deploys'])
    generateDocSetSkeletons(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'operations', 'slo.md'), 'utf-8')
    expect(content).toContain('## Objectives')
    expect(content).toContain('## SLIs')
    expect(content).toContain('## Error budget')
  })
})

describe('generateDocSetSkeletons — tier-variant resolution (arc42 canvas vs full)', () => {
  it('solo/trunk-solo gets the arc42 Canvas (no C4 section)', () => {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'trunk-solo' }))
    generateDocSetSkeletons(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'architecture', 'ARCHITECTURE.md'), 'utf-8')
    expect(content).toContain('Arc42 Canvas')
    expect(content).not.toContain('C4 — Context & Container')
  })

  it('enterprise/gated-review gets the full arc42 with the C4 Context/Container section', () => {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'gated-review' }))
    generateDocSetSkeletons(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'architecture', 'ARCHITECTURE.md'), 'utf-8')
    expect(content).toContain('## C4 — Context & Container')
  })
})

describe('generateDocSetSkeletons — unbound rows (no catalog binding) are reported, never guessed', () => {
  it('a missing row whose template: id has no catalog entry lands in `unbound`, nothing is written', () => {
    const manifest = `version: '1.1.0'
profile: tooling
checks:
  - path: docs/mystery.md
    tier: recommended
    applies: always
    template: not-a-real-catalog-id
    purpose: A row whose template id was never bound (typo/future work).
`
    mkdirSync(join(dir, 'standards'), { recursive: true })
    writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), manifest)
    const result = generateDocSetSkeletons(makeConfig(dir))
    expect(result.unbound).toContain('docs/mystery.md')
    expect(existsSync(join(dir, 'docs', 'mystery.md'))).toBe(false)
  })

  it('a missing row with NO template: field at all lands in `unbound` too (engine --generate banner is the only fallback)', () => {
    const manifest = `version: '1.1.0'
profile: tooling
checks:
  - path: README.md
    tier: mandatory
    applies: always
`
    mkdirSync(join(dir, 'standards'), { recursive: true })
    writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), manifest)
    const result = generateDocSetSkeletons(makeConfig(dir))
    expect(result.unbound).toContain('README.md')
  })
})

describe('runDocSetPlanApply — the arbiter doc-set --plan/--apply CLI path', () => {
  it('--plan (apply: false) writes nothing', () => {
    const result = runDocSetPlanApply({ repo: dir })
    expect(existsSync(join(dir, 'docs', 'GLOSSARY.md'))).toBe(false)
    expect(result.scaffolded.length).toBeGreaterThan(0)
  })

  it('--apply writes real skeletons and reports the resolved tier column', () => {
    const result = runDocSetPlanApply({ repo: dir, apply: true })
    expect(existsSync(join(dir, 'docs', 'GLOSSARY.md'))).toBe(true)
    expect(result.tierColumn).toBe('small') // no arbiter.json in this fixture -> peer-review default
  })

  it('a fresh init --dry-run edge (no manifest on disk yet) degrades to an honest no-op, not a phantom plan', () => {
    const fresh = createTestProject('typescript')
    try {
      const result = runDocSetPlanApply({ repo: fresh })
      expect(result.scaffolded).toEqual([])
      expect(result.unbound).toEqual([])
      expect(result.tierColumn).toBeUndefined()
    } finally {
      cleanupTestProject(fresh)
    }
  })

  it('--apply exits non-zero for missing unbound rows, while --plan remains advisory (#2214)', () => {
    const manifest = join(dir, 'standards', 'unbound-doc-set.yml')
    writeFileSync(
      manifest,
      `version: '1.1.0'\nprofile: tooling\nchecks:\n  - path: docs/mystery.md\n    tier: mandatory\n    applies: always\n`,
    )
    const cli = join(process.cwd(), 'dist', 'cli.js')
    const plan = spawnSync('node', [cli, 'doc-set', dir, '--plan', '--manifest', manifest], {
      encoding: 'utf-8',
    })
    const apply = spawnSync('node', [cli, 'doc-set', dir, '--apply', '--manifest', manifest], {
      encoding: 'utf-8',
    })

    expect(plan.status, plan.stderr).toBe(0)
    expect(apply.status, apply.stderr).not.toBe(0)
    expect(apply.stdout).toContain('scripts/check-doc-set.mjs --generate')
  })
})
