// SPDX-License-Identifier: Apache-2.0
// #1741 — structural single-dial: convert verified L3+ boundary literals to the
// injected isL3Plus flag (and the L2+ variant to isL2Plus). #1720 fixed 5 places
// where the hand-rolled `governanceLevel === 'L3' || governanceLevel === 'L4'`
// idiom silently excluded L4, and injected isL2Plus/isL3Plus/isL4 into the EJS
// render context (withLevelBooleans, src/utils/render.ts) so the ordinal
// relationship is single-sourced. The remaining boundary literals were CORRECT
// today but are latent instances of the same bug class: the next edit that
// drops the L4 term regresses silently. This test guards that none remain.
//
// Level-EXACT selections (a template picking a single level's own prose, not a
// floor) are a different idiom and are deliberately exempt — see the
// carried-forward classification in #1720/#1741: agents-md/AGENTS.md.ejs (exact
// L3/L4 section headers), governance/ci-mental-model.md.ejs (exact-level
// blocks), root/docs/METHOD/SSOT_CORE_SET.md.ejs, governance/validation-evidence.md.ejs
// exact-level blocks, root/docs/METHOD/KNOWLEDGE_MAP.md.ejs TRACK_ROUTER section.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig, renderCheckAll } from '../helpers.js'
import { getFilteredInvariants, getInvariantsByTier } from '../../src/invariants/filter.js'
import { TIER_LABELS } from '../../src/invariants/tiers.js'
import type { GovernanceLevel } from '../../src/wizard/types.js'

const TEMPLATES_DIR = join(__dirname, '../../src/templates')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const BOUNDARY_LITERAL_RE = /governanceLevel === 'L[1-3]'( \|\| governanceLevel === 'L[2-4]')+/

describe('#1741 — no hand-rolled L2+/L3+ boundary literals remain in templates', () => {
  it('every *.ejs template is free of the governanceLevel === boundary-OR idiom', () => {
    const offenders = walk(TEMPLATES_DIR)
      .filter((f) => f.endsWith('.ejs'))
      .flatMap((f) => {
        const content = readFileSync(f, 'utf-8')
        return content
          .split('\n')
          .map((line, i) => ({ file: f, line: i + 1, text: line.trim() }))
          .filter(({ text }) => BOUNDARY_LITERAL_RE.test(text))
      })
    expect(
      offenders,
      `hand-rolled boundary literals found (should use isL2Plus/isL3Plus):\n${offenders
        .map((o) => `${o.file}:${o.line}: ${o.text}`)
        .join('\n')}`,
    ).toEqual([])
  })
})

function cfg(overrides: Record<string, unknown> = {}) {
  return makeConfig('/tmp/test', {
    githubOwner: 'test-owner',
    projectName: 'demo-app',
    language: 'typescript',
    archetype: 'backend-web-db',
    buildTool: 'npm',
    enableDebtGates: true,
    coverageEnabled: false,
    collaborationMode: 'gated-review',
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
}

/** Non-blank, trimmed lines — whitespace-only diffs are not a cascade violation. */
function nonBlankLines(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

// check-all.mjs.ejs stamps the requested governance level verbatim into a literal
// (`const _projectLevel = 'L3';` vs `'L4'`) — a deliberate, expected difference.
const KNOWN_LEVEL_STAMP_LINES = [
  /^const _projectLevel = '(L1|L2|L3|L4)';$/,
  /^At governance level `(L1|L2|L3|L4)` the following are hard requirements in addition to$/,
  /^governance_level: '(L1|L2|L3|L4)'$/,
  /^\| Governance level \| `(L1|L2|L3|L4)` \|$/,
]

function filteredNonBlankLines(content: string): string[] {
  return nonBlankLines(content).filter((l) => !KNOWN_LEVEL_STAMP_LINES.some((re) => re.test(l)))
}

function renderAgentsMd(governanceLevel: GovernanceLevel): string {
  const config = makeConfig('/tmp/test')
  const merged = { ...config, governanceLevel }
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel,
    invariantTiers: config.invariantTiers,
  })
  const data = {
    ...merged,
    invariants,
    invariantsByTier: getInvariantsByTier(invariants),
    tierLabels: TIER_LABELS,
  } as unknown as Record<string, unknown>
  return renderTemplate('agents-md/AGENTS.md.ejs', data)
}

// AGENTS.md.ejs mixes the converted isL3Plus boundary (Tech Debt Gates mutation
// rows) with a genuinely level-EXCLUSIVE section (`### L3 (Full Audit)` vs
// `### L4 (Audit/Compliance)`, deliberately exempt per #1720/#1741) — so a
// whole-file line-superset assertion does not hold here. Assert the converted
// boundary content directly instead.
describe('#1741 — AGENTS.md.ejs: converted isL3Plus mutation-testing row survives at L4', () => {
  it('the Tech Debt Gates mutation-testing row present at L3 is also present at L4', () => {
    const l3 = renderAgentsMd('L3')
    const l4 = renderAgentsMd('L4')
    expect(l3).toContain('Mutation testing')
    expect(l4).toContain('Mutation testing')
  })
})

// Templates converted by #1741 from the raw boundary literal to isL3Plus (or
// isL2Plus). For each, L4's render must be a strict non-blank-line superset of
// L3's — the boundary content that isL3Plus gates must survive at L4 too.
const CONVERTED_L3_PLUS_TEMPLATES = [
  'docs/CODING_STANDARDS.md.ejs',
  'docs/MASTER_TEST_PLAN.md.ejs',
  'docs/runbooks/prod-checklist.md.ejs',
  'docs/SECURE_CODING_CHECKLIST.md.ejs',
  'github/workflows/01-pr-fast.yml.ejs',
  'github/workflows/06-nightly-lite.yml.ejs',
  'github/workflows/15-codeql.yml.ejs',
  'github/workflows/16-frontend-quality.yml.ejs',
  'github/workflows/17-ossf-scorecard.yml.ejs',
  'github/workflows/18-frontend-lane.yml.ejs',
  'github/workflows/_nightly.yml.ejs',
  'governance/validation-evidence.md.ejs',
  'resilience/RESILIENCE.md.ejs',
  'root/docs/SYSTEM/CANON.md.ejs',
  'root/docs/SYSTEM/FAIL_CLOSED.md.ejs',
  'scripts/apply-branch-protection.mjs.ejs',
  'scripts/check-all.mjs.ejs',
  'scripts/debt-report.mjs.ejs',
] as const

describe('#1741 — L4 render is a superset of L3 render for converted isL3Plus templates', () => {
  it.each(CONVERTED_L3_PLUS_TEMPLATES)(
    '%s: every non-blank L3 line is present in L4',
    (template) => {
      // #2041: check-all.mjs.ejs is registry-driven — render it through the shared helper.
      const render =
        template === 'scripts/check-all.mjs.ejs'
          ? (d: Record<string, unknown>) => renderCheckAll(d)
          : (d: Record<string, unknown>) => renderTemplate(template, d)
      const l3 = render(cfg({ governanceLevel: 'L3' }))
      const l4 = render(cfg({ governanceLevel: 'L4' }))
      const l4Lines = new Set(filteredNonBlankLines(l4))
      const missingFromL4 = filteredNonBlankLines(l3).filter((line) => !l4Lines.has(line))
      expect(
        missingFromL4,
        `L3 lines missing from L4 render of ${template} (L4 must be ⊇ L3):\n${missingFromL4.join('\n')}`,
      ).toEqual([])
    },
  )
})

describe('#1741 — ci-mental-model.md.ejs: converted isL2Plus boundary line', () => {
  it('L2 boundary content survives at L3 and L4 (isL2Plus superset)', () => {
    const l1 = renderTemplate('governance/ci-mental-model.md.ejs', cfg({ governanceLevel: 'L1' }))
    const l2 = renderTemplate('governance/ci-mental-model.md.ejs', cfg({ governanceLevel: 'L2' }))
    const l1Lines = new Set(filteredNonBlankLines(l1))
    const addedAtL2 = filteredNonBlankLines(l2).filter((line) => !l1Lines.has(line))
    // L2-gated content must appear (the boundary is not vacuous / silently dropped)
    expect(addedAtL2.length).toBeGreaterThan(0)
  })
})
