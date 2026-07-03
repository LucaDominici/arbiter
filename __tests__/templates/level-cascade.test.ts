// SPDX-License-Identifier: Apache-2.0
// #1720 — governance level is supposed to be a single dial: L4 ⊇ L3 ⊇ L2 ⊇ L1.
// Five templates hand-rolled the L3+ boundary as a literal `governanceLevel === 'L3'`
// (or `=== 'L3' || === 'L3'`-shaped variants), silently EXCLUDING L4 and downgrading
// L4 below L3. This test is the durable regression guard: for exactly the 5 fixed
// templates, every non-blank line rendered at L3 must also appear at L4 (L4 is a
// strict superset of L3's content), so a future guard that omits L4 fails loudly here
// instead of shipping invisible (the presence-only check-ci-tiers gate cannot catch it).
//
// Scope guard: this is NOT a blanket invariant across all templates. Some templates
// have per-level EXCLUSIVE sections (ci-mental-model.md.ejs, AGENTS.md.ejs,
// TESTING_POLICY.md.ejs) where L3 and L4 each own a distinct paragraph — those
// legitimately violate line-superset and are deliberately excluded here.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Record<string, unknown> = {}) {
  return makeConfig('/tmp/test', {
    githubOwner: 'test-owner',
    projectName: 'demo-app',
    language: 'typescript',
    archetype: 'backend-web-db',
    buildTool: 'npm',
    enableDebtGates: true,
    coverageEnabled: false,
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
}

// check-all.mjs.ejs stamps the requested governance level verbatim into a literal
// (`const _projectLevel = 'L3';` vs `'L4'`) — a deliberate, expected difference, not
// a hand-rolled boundary bug. Excluded so it doesn't false-fail the superset check.
const KNOWN_LEVEL_STAMP_LINES = [/^const _projectLevel = '(L1|L2|L3|L4)';$/]

/** Non-blank, trimmed lines — whitespace-only diffs are not a cascade violation. */
function nonBlankLines(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !KNOWN_LEVEL_STAMP_LINES.some((re) => re.test(l)))
}

const FIXED_TEMPLATES = [
  'github/workflows/05-release.yml.ejs',
  'root/CODEOWNERS.ejs',
  'root/docs/METHOD/KNOWLEDGE_MAP.md.ejs',
  'scripts/check-all.mjs.ejs',
  'scripts/check-fail-closed-audit.mjs.ejs',
] as const

describe('#1720 — L4 is a strict superset of L3 for the 5 fixed templates', () => {
  it.each(FIXED_TEMPLATES)('%s: every non-blank L3 line is present in L4', (template) => {
    const l3 = renderTemplate(template, cfg({ governanceLevel: 'L3' }))
    const l4 = renderTemplate(template, cfg({ governanceLevel: 'L4' }))
    const l4Lines = new Set(nonBlankLines(l4))
    const missingFromL4 = nonBlankLines(l3).filter((line) => !l4Lines.has(line))
    expect(
      missingFromL4,
      `L3 lines missing from L4 render of ${template} (L4 must be ⊇ L3):\n${missingFromL4.join('\n')}`,
    ).toEqual([])
  })
})
