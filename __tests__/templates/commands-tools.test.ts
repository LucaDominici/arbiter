import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { buildKnownLimitations } from '../../src/generators/codex-known-limitations.js'
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
