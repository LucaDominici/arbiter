import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderApproval(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/03-human-approval.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('03-human-approval.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)(
    '$language: workflow name is "Human Approval Gate"',
    ({ language, buildTool }) => {
      const rendered = renderApproval({ language, buildTool })
      expect(rendered).toContain('name: Human Approval Gate')
    },
  )

  it.each(STACKS)(
    '$language: top-level permissions sets contents: read',
    ({ language, buildTool }) => {
      const rendered = renderApproval({ language, buildTool })
      expect(rendered).toContain('permissions:')
      expect(rendered).toContain('contents: read')
    },
  )

  it.each(STACKS)(
    '$language: apply-approval-label job has pull-requests: write',
    ({ language, buildTool }) => {
      const rendered = renderApproval({ language, buildTool })
      expect(rendered).toContain('apply-approval-label:')
      expect(rendered).toContain('pull-requests: write')
    },
  )

  it.each(STACKS)('$language: revoke-approval-label job present', ({ language, buildTool }) => {
    const rendered = renderApproval({ language, buildTool })
    expect(rendered).toContain('revoke-approval-label:')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderApproval({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Template is stack-independent ───────────────────────────────────────────

describe('03-human-approval.yml.ejs — stack independence', () => {
  it('typescript and java render byte-identical output', () => {
    const ts = renderApproval({ language: 'typescript', buildTool: 'npm' })
    const java = renderApproval({ language: 'java', buildTool: 'gradle' })
    expect(ts).toBe(java)
  })

  it('go and python render byte-identical output', () => {
    const go = renderApproval({ language: 'go', buildTool: 'go' })
    const python = renderApproval({ language: 'python', buildTool: 'pip' })
    expect(go).toBe(python)
  })

  it('rust and typescript render byte-identical output', () => {
    const rust = renderApproval({ language: 'rust', buildTool: 'cargo' })
    const ts = renderApproval({ language: 'typescript', buildTool: 'npm' })
    expect(rust).toBe(ts)
  })

  it('L1 and L3 governance render byte-identical output', () => {
    const l1 = renderApproval({ governanceLevel: 'L1' })
    const l3 = renderApproval({ governanceLevel: 'L3' })
    expect(l1).toBe(l3)
  })
})

// ─── Triple-check guard strings ───────────────────────────────────────────────

describe('03-human-approval.yml.ejs — triple-check anti-bot guards', () => {
  it('trigger on pull_request_review submitted', () => {
    const rendered = renderApproval({})
    expect(rendered).toContain('pull_request_review:')
    expect(rendered).toContain('types: [submitted]')
  })

  it('trigger on pull_request synchronize (stale-approval protection)', () => {
    const rendered = renderApproval({})
    expect(rendered).toContain('pull_request:')
    expect(rendered).toContain('types: [synchronize]')
  })

  it('guard: actor != author (self-approval blocked)', () => {
    const rendered = renderApproval({})
    expect(rendered).toContain(
      'github.event.review.user.login != github.event.pull_request.user.login',
    )
  })

  it('guard: actor is not a Bot', () => {
    const rendered = renderApproval({})
    expect(rendered).toContain("github.event.review.user.type != 'Bot'")
  })

  it("guard: review state is 'approved'", () => {
    const rendered = renderApproval({})
    expect(rendered).toContain("github.event.review.state == 'approved'")
  })

  it('apply job conditional checks event_name == pull_request_review', () => {
    const rendered = renderApproval({})
    expect(rendered).toContain("github.event_name == 'pull_request_review'")
  })

  it('revoke job conditional checks event_name == pull_request and action == synchronize', () => {
    const rendered = renderApproval({})
    expect(rendered).toContain("github.event_name == 'pull_request'")
    expect(rendered).toContain("github.event.action == 'synchronize'")
  })
})

// ─── Label operations ─────────────────────────────────────────────────────────

describe('03-human-approval.yml.ejs — label operations', () => {
  it('creates approved-by-human label with --force for idempotency', () => {
    const rendered = renderApproval({})
    expect(rendered).toContain('gh label create approved-by-human')
    expect(rendered).toContain('--force')
  })

  it('applies approved-by-human label via gh pr edit', () => {
    const rendered = renderApproval({})
    expect(rendered).toContain('--add-label approved-by-human')
  })

  it('removes approved-by-human label via gh pr edit on synchronize', () => {
    const rendered = renderApproval({})
    expect(rendered).toContain('--remove-label approved-by-human')
  })

  it('checks label presence before removing (no spurious API calls)', () => {
    const rendered = renderApproval({})
    expect(rendered).toContain('"approved-by-human"')
    const revokeSection = rendered.split('revoke-approval-label:')[1] ?? ''
    expect(revokeSection).toContain('grep -q')
  })
})
