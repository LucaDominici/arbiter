import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateDocs } from '../../src/generators/docs.js'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { generateStrideEnforcement } from '../../src/generators/stride-enforcement.js'
import { makeConfig } from '../helpers.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-docs-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('generateDocs — target doc generators (#2214)', () => {
  // Deliberately does NOT create a README.md. A virgin `arbiter init` target has no README,
  // and gen-llms-txt fails CLOSED (exit 2) on any config path that does not resolve — seeding
  // README.md made the emitted generator die on its very first run in a real target. Writing
  // one here would mask exactly the defect this test exists to catch.
  it('emits doc-index and llms.txt generators that RUN on a virgin L2 target', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# Agent instructions\n')
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateDocs(config)
    generateCheckAll(config)

    const indexGenerator = join(dir, 'scripts', 'gen-doc-index.mjs')
    const llmsGenerator = join(dir, 'scripts', 'gen-llms-txt.mjs')
    expect(existsSync(indexGenerator)).toBe(true)
    expect(existsSync(llmsGenerator)).toBe(true)
    expect(existsSync(join(dir, 'llms-txt.config.json'))).toBe(true)

    const index = spawnSync('node', [indexGenerator], { cwd: dir, encoding: 'utf-8' })
    expect(index.status, index.stderr).toBe(0)
    const llms = spawnSync('node', [llmsGenerator], { cwd: dir, encoding: 'utf-8' })
    expect(llms.status, llms.stderr).toBe(0)
    expect(existsSync(join(dir, 'llms.txt'))).toBe(true)
  })

  // Both drift checks must be guarded on their OUTPUT artifact, never on the script: an
  // unguarded --check reds every virgin target on day one, because arbiter init does not
  // pre-generate docs/INDEX.md or llms.txt. Shipping red-by-construction enforcement to
  // targets is the failure mode #2214 removes, not one to reintroduce.
  it('guards both doc drift checks on their output artifact, never red on day one', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateCheckAll(config)
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain("['scripts/gen-doc-index.mjs', '--check']")
    expect(checkAll).toContain("existsSync('docs/INDEX.md')")
    expect(checkAll).toContain("existsSync('llms.txt')")
  })
})

describe('generateDocs — ADR template (#192)', () => {
  it('emits ADR-000_template.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'adr', 'ADR-000_template.md'))).toBe(true)
  })

  it('emits ADR-000_template.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'adr', 'ADR-000_template.md'))).toBe(true)
  })

  it('does not emit ADR template at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'adr', 'ADR-000_template.md'))).toBe(false)
  })
})

describe('generateDocs — SECURE_CODING_CHECKLIST (#203)', () => {
  it('emits SECURE_CODING_CHECKLIST.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'SECURE_CODING_CHECKLIST.md'))).toBe(true)
  })

  it('emits SECURE_CODING_CHECKLIST.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'SECURE_CODING_CHECKLIST.md'))).toBe(true)
  })

  it('does not emit SECURE_CODING_CHECKLIST.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'SECURE_CODING_CHECKLIST.md'))).toBe(false)
  })
})

describe('generateDocs — CODING_STANDARDS (#206)', () => {
  it('emits CODING_STANDARDS.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'CODING_STANDARDS.md'))).toBe(true)
  })

  it('emits CODING_STANDARDS.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'CODING_STANDARDS.md'))).toBe(true)
  })

  it('does not emit CODING_STANDARDS.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'CODING_STANDARDS.md'))).toBe(false)
  })

  it('skipIfExists on docs/CODING_STANDARDS.md (#206, CANON-11)', () => {
    const docsDir = join(dir, 'docs')
    mkdirSync(docsDir, { recursive: true })
    const target = join(docsDir, 'CODING_STANDARDS.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateDocs — MASTER_TEST_PLAN (#209)', () => {
  it('emits MASTER_TEST_PLAN.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'MASTER_TEST_PLAN.md'))).toBe(true)
  })

  it('emits MASTER_TEST_PLAN.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'MASTER_TEST_PLAN.md'))).toBe(true)
  })

  it('does not emit MASTER_TEST_PLAN.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'MASTER_TEST_PLAN.md'))).toBe(false)
  })

  it('skipIfExists on docs/MASTER_TEST_PLAN.md (#209, CANON-11)', () => {
    const docsDir = join(dir, 'docs')
    mkdirSync(docsDir, { recursive: true })
    const target = join(docsDir, 'MASTER_TEST_PLAN.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateDocs — ISO27001_ANNEX_A (#217)', () => {
  it('emits docs/SECURITY/ISO27001_ANNEX_A.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'ISO27001_ANNEX_A.md'))).toBe(true)
  })

  it('does not emit ISO27001_ANNEX_A.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'ISO27001_ANNEX_A.md'))).toBe(false)
  })

  it('does not emit ISO27001_ANNEX_A.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'ISO27001_ANNEX_A.md'))).toBe(false)
  })

  // #1732 Step 3: the L3 boundary was a hand-rolled `=== 'L3'` literal that
  // silently excluded L4 (the same bug class as #1720). L4 is the strictest
  // tier and should inherit the L3 compliance annex, not lose it.
  it('emits docs/SECURITY/ISO27001_ANNEX_A.md at L4 (#1732)', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L4' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'ISO27001_ANNEX_A.md'))).toBe(true)
  })
})

describe('generateDocs — POST_MERGE_REVIEW_TEMPLATE (#218)', () => {
  it('emits docs/testing/POST_MERGE_REVIEW_TEMPLATE.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'testing', 'POST_MERGE_REVIEW_TEMPLATE.md'))).toBe(true)
  })

  it('emits docs/testing/POST_MERGE_REVIEW_TEMPLATE.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'testing', 'POST_MERGE_REVIEW_TEMPLATE.md'))).toBe(true)
  })

  it('does not emit POST_MERGE_REVIEW_TEMPLATE.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'testing', 'POST_MERGE_REVIEW_TEMPLATE.md'))).toBe(false)
  })
})

describe('generateDocs — runbooks scaffold (#897)', () => {
  it('emits docs/runbooks/rollback.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'runbooks', 'rollback.md'))).toBe(true)
  })

  it('emits docs/runbooks/troubleshooting.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'runbooks', 'troubleshooting.md'))).toBe(true)
  })

  it('emits docs/runbooks/prod-checklist.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'runbooks', 'prod-checklist.md'))).toBe(true)
  })

  it('emits docs/runbooks/deployment.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'runbooks', 'deployment.md'))).toBe(true)
  })

  it('emits runbooks at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'runbooks', 'rollback.md'))).toBe(true)
  })

  it('does not emit runbooks at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'runbooks'))).toBe(false)
  })

  it('skipIfExists on docs/runbooks/rollback.md (#897, CANON-11)', () => {
    const runbooksDir = join(dir, 'docs', 'runbooks')
    mkdirSync(runbooksDir, { recursive: true })
    const target = join(runbooksDir, 'rollback.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateDocs — docs/SECURITY/ scaffold (#897)', () => {
  // #1578/#1592: STRIDE.md has a single owner — the stride-enforcement generator.
  // generateDocs must NOT emit it (a second emit to the same path is the exact
  // double-emit the #1578 conformance guard rejects). These tests pin the
  // sole-emitter contract so the duplicate cannot silently come back.
  it.each(['L2', 'L3'] as const)('generateDocs does NOT emit STRIDE.md at %s', (level) => {
    generateDocs(makeConfig(dir, { governanceLevel: level }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'STRIDE.md'))).toBe(false)
  })

  it.each(['L2', 'L3'] as const)('stride-enforcement emits STRIDE.md at %s', (level) => {
    generateStrideEnforcement(makeConfig(dir, { governanceLevel: level }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'STRIDE.md'))).toBe(true)
  })

  it('stride-enforcement does not emit STRIDE.md at L1', () => {
    generateStrideEnforcement(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'STRIDE.md'))).toBe(false)
  })

  it('emits docs/SECURITY/RISK_ASSESSMENT.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'RISK_ASSESSMENT.md'))).toBe(true)
  })

  it('does not emit docs/SECURITY/RISK_ASSESSMENT.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'RISK_ASSESSMENT.md'))).toBe(false)
  })

  it('does not emit docs/SECURITY/RISK_ASSESSMENT.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'RISK_ASSESSMENT.md'))).toBe(false)
  })

  it('skipIfExists on docs/SECURITY/STRIDE.md (#897, CANON-11)', () => {
    const secDir = join(dir, 'docs', 'SECURITY')
    mkdirSync(secDir, { recursive: true })
    const target = join(secDir, 'STRIDE.md')
    writeFileSync(target, 'PREEXISTING')
    generateStrideEnforcement(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

// #1592: docs.ts and stride-enforcement.ts both render security/STRIDE.md.ejs.
// A case-divergent path pair (docs/security vs docs/SECURITY) orphans the gate on
// Linux and double-keys the write manifest on case-insensitive FSes. Guard the
// whole class: no two emitted paths across the always-on generators may collide
// under toLowerCase() unless they are the SAME exact path (an intended
// byte-identical idempotent re-emit, classified `skipped`).
describe('generateDocs + generateStrideEnforcement — no case-divergent path collisions (#1592)', () => {
  for (const level of ['L2', 'L3', 'L4'] as const) {
    it(`no two emitted paths differ only by case at ${level}`, () => {
      const cfg = makeConfig(dir, { governanceLevel: level })
      const paths = [
        ...generateDocs(cfg).files.map((f) => f.path),
        ...generateStrideEnforcement(cfg).files.map((f) => f.path),
      ]
      const byLower = new Map<string, Set<string>>()
      for (const p of paths) {
        const key = p.toLowerCase()
        if (!byLower.has(key)) byLower.set(key, new Set())
        byLower.get(key)!.add(p)
      }
      const collisions = [...byLower.values()]
        .filter((variants) => variants.size > 1)
        .map((variants) => [...variants].join(' <-> '))
      expect(collisions, `case-divergent path collision(s):\n  ${collisions.join('\n  ')}`).toEqual(
        [],
      )
    })
  }
})

describe('generateDocs — steering docs scaffold (#1268)', () => {
  for (const f of ['structure', 'tech', 'product']) {
    it(`emits docs/steering/${f}.md at L2`, () => {
      generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
      expect(existsSync(join(dir, 'docs', 'steering', `${f}.md`))).toBe(true)
    })
    it(`emits docs/steering/${f}.md at L3`, () => {
      generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
      expect(existsSync(join(dir, 'docs', 'steering', `${f}.md`))).toBe(true)
    })
    it(`does not emit docs/steering/${f}.md at L1`, () => {
      generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
      expect(existsSync(join(dir, 'docs', 'steering', `${f}.md`))).toBe(false)
    })
  }

  it('skipIfExists on docs/steering/structure.md (#1268, CANON-11)', () => {
    const steeringDir = join(dir, 'docs', 'steering')
    mkdirSync(steeringDir, { recursive: true })
    const target = join(steeringDir, 'structure.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateDocs — atomic-task-list scaffold (#1268)', () => {
  it('emits docs/specs/atomic-task-list.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'specs', 'atomic-task-list.md'))).toBe(true)
  })

  it('does not emit docs/specs/atomic-task-list.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'specs', 'atomic-task-list.md'))).toBe(false)
  })

  it('skipIfExists on docs/specs/atomic-task-list.md (#1268, CANON-11)', () => {
    const specsDir = join(dir, 'docs', 'specs')
    mkdirSync(specsDir, { recursive: true })
    const target = join(specsDir, 'atomic-task-list.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateDocs — bug triage/verification scaffold (#1268)', () => {
  for (const f of ['bug-analysis', 'bug-report', 'bug-verification']) {
    it(`emits docs/bugs/${f}.md at L2`, () => {
      generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
      expect(existsSync(join(dir, 'docs', 'bugs', `${f}.md`))).toBe(true)
    })
    it(`does not emit docs/bugs/${f}.md at L1`, () => {
      generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
      expect(existsSync(join(dir, 'docs', 'bugs', `${f}.md`))).toBe(false)
    })
  }

  it('skipIfExists on docs/bugs/bug-analysis.md (#1268, CANON-11)', () => {
    const bugsDir = join(dir, 'docs', 'bugs')
    mkdirSync(bugsDir, { recursive: true })
    const target = join(bugsDir, 'bug-analysis.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateDocs — COMMANDS.md CLI catalog (#728)', () => {
  it('emits docs/COMMANDS.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'COMMANDS.md'))).toBe(true)
  })

  it('emits docs/COMMANDS.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'COMMANDS.md'))).toBe(true)
  })

  it('does not emit docs/COMMANDS.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'COMMANDS.md'))).toBe(false)
  })

  it('skipIfExists on docs/COMMANDS.md (#728, CANON-11)', () => {
    const docsDir = join(dir, 'docs')
    mkdirSync(docsDir, { recursive: true })
    const target = join(docsDir, 'COMMANDS.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })

  it('COMMANDS.md contains project build/test/lint/format commands', () => {
    generateDocs(
      makeConfig(dir, {
        governanceLevel: 'L2',
        buildCommand: 'npm run build',
        testCommand: 'npm test',
        lintCommand: 'npm run lint',
        formatCommand: 'npx prettier --check .',
      }),
    )
    const content = readFileSync(join(dir, 'docs', 'COMMANDS.md'), 'utf-8')
    expect(content).toContain('npm run build')
    expect(content).toContain('npm test')
    expect(content).toContain('npm run lint')
    expect(content).toContain('npx prettier --check .')
  })

  it('COMMANDS.md contains gate commands', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'docs', 'COMMANDS.md'), 'utf-8')
    expect(content).toContain('check-all.mjs')
  })
})
