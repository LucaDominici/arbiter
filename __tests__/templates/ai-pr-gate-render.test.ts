// SPDX-License-Identifier: Apache-2.0
// CANON-18: render tests for AI-PR gate workflow templates (#884)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const STACKS = [
  { language: 'typescript', buildTool: 'npm' },
  { language: 'java', buildTool: 'gradle' },
  { language: 'go', buildTool: 'go' },
  { language: 'python', buildTool: 'pip' },
  { language: 'rust', buildTool: 'cargo' },
] as const

const LEVELS = ['L1', 'L2', 'L3'] as const

function renderLabelOnApprove(overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    'github/workflows/_label-on-approve.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

function renderAiDraftCheck(overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    'github/workflows/_ai-draft-check.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

function renderPrStaleness(overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    'github/workflows/_pr-staleness.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

function renderPrTemplate(overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    'github/PULL_REQUEST_TEMPLATE.md.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── _label-on-approve.yml.ejs (CANON-18) ────────────────────────────────────

describe('_label-on-approve.yml.ejs — structural invariants (CANON-18)', () => {
  it.each(STACKS)('$language: workflow name is "_label-on-approve"', ({ language, buildTool }) => {
    const rendered = renderLabelOnApprove({ language, buildTool })
    expect(rendered).toContain('name: _label-on-approve')
  })

  it.each(STACKS)(
    '$language: triggers on pull_request_review submitted',
    ({ language, buildTool }) => {
      const rendered = renderLabelOnApprove({ language, buildTool })
      expect(rendered).toContain('pull_request_review')
      expect(rendered).toContain('submitted')
    },
  )

  it.each(STACKS)(
    '$language: top-level permissions sets contents: read',
    ({ language, buildTool }) => {
      const rendered = renderLabelOnApprove({ language, buildTool })
      expect(rendered).toContain('permissions:')
      expect(rendered).toContain('contents: read')
    },
  )

  it.each(STACKS)(
    '$language: guards against bot reviewers and self-review',
    ({ language, buildTool }) => {
      const rendered = renderLabelOnApprove({ language, buildTool })
      expect(rendered).toContain('user.type')
      expect(rendered).toContain('user.login')
    },
  )

  it.each(STACKS)('$language: applies approved-by-human label', ({ language, buildTool }) => {
    const rendered = renderLabelOnApprove({ language, buildTool })
    expect(rendered).toContain('approved-by-human')
  })

  it.each(LEVELS)('%s governance level renders without error', (level) => {
    expect(() => renderLabelOnApprove({ governanceLevel: level })).not.toThrow()
  })
})

// ─── _ai-draft-check.yml.ejs (CANON-18) ──────────────────────────────────────

describe('_ai-draft-check.yml.ejs — structural invariants (CANON-18)', () => {
  it.each(STACKS)('$language: workflow name is "_ai-draft-check"', ({ language, buildTool }) => {
    const rendered = renderAiDraftCheck({ language, buildTool })
    expect(rendered).toContain('name: _ai-draft-check')
  })

  it.each(STACKS)(
    '$language: triggers on pull_request with labeled/unlabeled',
    ({ language, buildTool }) => {
      const rendered = renderAiDraftCheck({ language, buildTool })
      expect(rendered).toContain('pull_request')
      expect(rendered).toContain('labeled')
      expect(rendered).toContain('unlabeled')
    },
  )

  it.each(STACKS)(
    '$language: top-level permissions sets contents: read',
    ({ language, buildTool }) => {
      const rendered = renderAiDraftCheck({ language, buildTool })
      expect(rendered).toContain('permissions:')
      expect(rendered).toContain('contents: read')
    },
  )

  it.each(STACKS)('$language: checks for bot author via user.type', ({ language, buildTool }) => {
    const rendered = renderAiDraftCheck({ language, buildTool })
    expect(rendered).toContain('user.type')
  })

  it.each(STACKS)('$language: asserts approved-by-human label', ({ language, buildTool }) => {
    const rendered = renderAiDraftCheck({ language, buildTool })
    expect(rendered).toContain('approved-by-human')
  })

  it.each(LEVELS)('%s governance level renders without error', (level) => {
    expect(() => renderAiDraftCheck({ governanceLevel: level })).not.toThrow()
  })
})

// ─── _pr-staleness.yml.ejs (CANON-18) ────────────────────────────────────────

describe('_pr-staleness.yml.ejs — structural invariants (CANON-18)', () => {
  it.each(STACKS)('$language: workflow name is "_pr-staleness"', ({ language, buildTool }) => {
    const rendered = renderPrStaleness({ language, buildTool })
    expect(rendered).toContain('name: _pr-staleness')
  })

  it.each(STACKS)('$language: uses cron schedule', ({ language, buildTool }) => {
    const rendered = renderPrStaleness({ language, buildTool })
    expect(rendered).toContain('cron:')
    expect(rendered).toContain('schedule:')
  })

  it.each(STACKS)(
    '$language: top-level permissions sets contents: read',
    ({ language, buildTool }) => {
      const rendered = renderPrStaleness({ language, buildTool })
      expect(rendered).toContain('permissions:')
      expect(rendered).toContain('contents: read')
    },
  )

  it.each(STACKS)('$language: checks for no-stale label exemption', ({ language, buildTool }) => {
    const rendered = renderPrStaleness({ language, buildTool })
    expect(rendered).toContain('no-stale')
    expect(rendered).toContain('stale')
  })

  it.each(LEVELS)('%s governance level renders without error', (level) => {
    expect(() => renderPrStaleness({ governanceLevel: level })).not.toThrow()
  })
})

// ─── PULL_REQUEST_TEMPLATE.md.ejs (CANON-18) ─────────────────────────────────

describe('PULL_REQUEST_TEMPLATE.md.ejs — structural invariants (CANON-18)', () => {
  it.each(LEVELS)('%s: renders Pipeline Artifacts section', (level) => {
    const rendered = renderPrTemplate({ governanceLevel: level })
    expect(rendered).toContain('Pipeline Artifacts')
  })

  it.each(LEVELS)('%s: renders Gate Checklist', (level) => {
    const rendered = renderPrTemplate({ governanceLevel: level })
    expect(rendered).toContain('Gate Checklist')
  })

  it('L2: renders AI-PR Gate section (INV-91)', () => {
    const rendered = renderPrTemplate({ governanceLevel: 'L2' })
    expect(rendered).toContain('approved-by-human')
    expect(rendered).toContain('INV-91')
  })

  it('L3: renders AI-PR Gate section (INV-91)', () => {
    const rendered = renderPrTemplate({ governanceLevel: 'L3' })
    expect(rendered).toContain('approved-by-human')
    expect(rendered).toContain('INV-91')
  })

  it('L1: does not render AI-PR Gate section', () => {
    const rendered = renderPrTemplate({ governanceLevel: 'L1' })
    expect(rendered).not.toContain('INV-91')
  })

  it('L2: renders L2 gate command', () => {
    const rendered = renderPrTemplate({ governanceLevel: 'L2' })
    expect(rendered).toContain('check-all.mjs L2')
  })

  it('L1: does not include L2 gate command', () => {
    const rendered = renderPrTemplate({ governanceLevel: 'L1' })
    expect(rendered).not.toContain('check-all.mjs L2')
  })

  it.each(STACKS)('$language governance levels render without error', ({ language, buildTool }) => {
    for (const level of LEVELS) {
      expect(() => renderPrTemplate({ language, buildTool, governanceLevel: level })).not.toThrow()
    }
  })
})
