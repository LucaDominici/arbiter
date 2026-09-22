import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { buildKnownLimitations } from '../../src/generators/codex-known-limitations.js'
import { renderAgentsMd } from '../../src/generators/agents-md.js'
import type { Language } from '../../src/wizard/types.js'

/**
 * M11: Workflow commands — every emitted tool file must include a workflow
 * section when generateWorkflow is enabled, and the content must be
 * stack-parameterized.
 *
 * INV-11: Full matrix coverage across tools and stacks. Since #2367 (ADR-119)
 * the emitted tool set is Claude and Codex only — the Cursor and Copilot
 * render cases were retired with their templates.
 */

const GATE_MAP: Record<string, string> = {
  typescript: 'npm run test',
  java: './gradlew test',
  rust: 'cargo test',
  go: 'go test ./...',
  python: 'pytest',
}

function renderCodexMd(language: Language, testCommand?: string): string {
  const config = makeConfig('/tmp/test', {
    language,
    testCommand: testCommand ?? GATE_MAP[language] ?? 'echo test',
  })
  // ADR-106 (#1966): CODEX.md's Known Limitations section is generated from
  // the Claude-track inventory — mirror generateCodex's render enrichment.
  return renderTemplate('codex/CODEX.md.ejs', {
    ...config,
    knownLimitations: buildKnownLimitations(config),
  } as unknown as Record<string, unknown>)
}

// INV-11: Full 5-stack matrix for each tool

const STACK_LANGUAGES: Language[] = ['typescript', 'java', 'rust', 'go', 'python']

describe('codex CODEX.md — workflow section', () => {
  it('includes workflow/task lifecycle section', () => {
    const content = renderCodexMd('typescript')
    expect(content).toMatch(/workflow|task lifecycle|start.task/i)
  })

  for (const lang of STACK_LANGUAGES) {
    it(`workflow references correct gate for ${lang}`, () => {
      const content = renderCodexMd(lang)
      expect(content).toContain(GATE_MAP[lang])
    })
  }

  it('uses the shared Ship plan instead of requiring a second Codex plan', () => {
    const content = renderCodexMd('typescript')
    expect(content).toContain('Ship')
    expect(content).not.toContain('.agents/plan/PLAN.json')
    expect(content).not.toMatch(/L1` before (?:each )?commit/i)
  })

  it('keeps Codex on the light local preflight and full CI authority', () => {
    const content = renderCodexMd('typescript')
    expect(content).toContain('node scripts/check-all.mjs preflight')
    expect(content).toMatch(/CI (?:runs|is)\s+the full gate/i)
    expect(content).not.toMatch(/L2 before push|L2` \| Run before push\/PR/i)
    expect(content).toMatch(/targeted test/i)
    expect(content).not.toMatch(/Run `npm run test` after each unit/i)
    expect(content).toMatch(/draft PR.*exact-head CI.*review.*ready.*merge/is)
  })

  it('keeps the generated CLI catalog on the same gate economy contract', () => {
    const content = renderTemplate(
      'documentation/cli-catalog.md.ejs',
      makeConfig('/tmp/test', { language: 'typescript' }) as unknown as Record<string, unknown>,
    )
    const prose = content.replace(/^>\s?/gm, '').replace(/\s+/g, ' ')
    expect(content).toContain('node scripts/check-all.mjs preflight')
    expect(prose).toMatch(/CI (?:runs|is) the full gate/i)
    expect(content).not.toMatch(/L1 once on the frozen candidate, and L2 before push/i)
  })

  it('keeps canonical AGENTS guidance on one local preflight and exact-head CI', () => {
    const content = renderAgentsMd(makeConfig('/tmp/test', { language: 'typescript' }))
    expect(content).toContain('node scripts/check-all.mjs preflight')
    expect(content).toMatch(/CI.*full gate.*exact (?:pushed )?SHA/is)
    expect(content).not.toMatch(/L2 \(full, pre-push\)|L2.*before push|Pre-push.*runs L2/i)
  })

  it('keeps generated governance guidance on the same gate economy contract', () => {
    const config = makeConfig('/tmp/test', {
      collaborationMode: 'trunk-solo',
      governanceLevel: 'L3',
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const surfaces = [
      renderTemplate('governance/ci-mental-model.md.ejs', config),
      renderTemplate('governance/solo-dev-exception.md.ejs', config),
    ]
    for (const content of surfaces) {
      expect(content).toContain('scripts/check-all.mjs preflight')
      expect(content).toMatch(/CI.*full gate.*exact (?:pushed )?SHA/is)
      expect(content).not.toMatch(/L2.*before push|L2 gate.*pre-push|L2.*every push/i)
    }
  })

  it('attributes the PR full-gate checklist to exact-head CI', () => {
    const config = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const surfaces = [
      renderTemplate('github/PULL_REQUEST_TEMPLATE.md.ejs', config),
      readFileSync(
        new URL('../../src/templates/github/PULL_REQUEST_TEMPLATE.md', import.meta.url),
        'utf8',
      ),
    ]
    for (const content of surfaces) {
      expect(content).toMatch(/exact-head CI.*check-all\.mjs L2/is)
      expect(content).not.toMatch(/check-all\.mjs L1` passes/i)
    }
  })

  it('lets the pre-push hook own the single local preflight', () => {
    const content = renderTemplate(
      'claude/commands/ship.md.ejs',
      makeConfig('/tmp/test', { language: 'typescript' }) as unknown as Record<string, unknown>,
    )
    expect(content).toMatch(/pre-push hook.*preflight/is)
    expect(content).not.toMatch(/Run `node scripts\/check-all\.mjs preflight`.*then push/is)
  })

  it('keeps Arbiter self-governance on the hook-owned preflight', () => {
    const agents = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8')
    const catalog = readFileSync(
      new URL('../../docs/internal/SYSTEM/INVARIANT-CATALOG.md', import.meta.url),
      'utf8',
    )
    const content = `${agents}\n${catalog}`
    expect(content).toMatch(/pre-push hook.*preflight/is)
    expect(content).toMatch(/CI.*full L2 gate.*exact/is)
    expect(content).not.toMatch(/preflight` before freezing|L1\s+# qualify the frozen/i)
    expect(content).not.toMatch(/preflight\s+# before push/i)
  })
})

describe('codex CODEX.md — Known Limitations parity section (#162)', () => {
  it('renders check-circular-deps in Known Limitations table', () => {
    const content = renderCodexMd('typescript')
    expect(content).toContain('check-circular-deps.mjs')
  })

  it('renders INV-01 in Known Limitations table', () => {
    const content = renderCodexMd('typescript')
    expect(content).toContain('INV-01')
  })

  it('renders madge workaround in Known Limitations table', () => {
    const content = renderCodexMd('typescript')
    expect(content).toContain('madge --circular src')
  })

  it('renders Known Limitations heading', () => {
    const content = renderCodexMd('typescript')
    expect(content).toContain('Known Limitations')
  })
})
