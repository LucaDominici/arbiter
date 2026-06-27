import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderHeartbeat(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/09-heartbeat.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('09-heartbeat.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: workflow name is "Heartbeat (T6)"', ({ language, buildTool }) => {
    const rendered = renderHeartbeat({ language, buildTool })
    expect(rendered).toContain('name: Heartbeat (T6)')
  })

  it.each(STACKS)(
    '$language: top-level permissions include contents: read and issues: write',
    ({ language, buildTool }) => {
      const rendered = renderHeartbeat({ language, buildTool })
      expect(rendered).toContain('contents: read')
      expect(rendered).toContain('issues: write')
    },
  )

  it.each(STACKS)('$language: assert-nightly-freshness job present', ({ language, buildTool }) => {
    const rendered = renderHeartbeat({ language, buildTool })
    expect(rendered).toContain('assert-nightly-freshness:')
  })

  it.each(STACKS)('$language: assert-weekly-freshness job present', ({ language, buildTool }) => {
    const rendered = renderHeartbeat({ language, buildTool })
    expect(rendered).toContain('assert-weekly-freshness:')
  })

  it.each(STACKS)('$language: assert-monthly-freshness job present', ({ language, buildTool }) => {
    const rendered = renderHeartbeat({ language, buildTool })
    expect(rendered).toContain('assert-monthly-freshness:')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderHeartbeat({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Template is stack-independent ───────────────────────────────────────────

describe('09-heartbeat.yml.ejs — stack independence', () => {
  it('typescript and java render byte-identical output', () => {
    const ts = renderHeartbeat({ language: 'typescript', buildTool: 'npm' })
    const java = renderHeartbeat({ language: 'java', buildTool: 'gradle' })
    expect(ts).toBe(java)
  })

  it('L1 and L3 governance render byte-identical output', () => {
    const l1 = renderHeartbeat({ governanceLevel: 'L1' })
    const l3 = renderHeartbeat({ governanceLevel: 'L3' })
    expect(l1).toBe(l3)
  })
})

// ─── Trigger and schedule ─────────────────────────────────────────────────────

describe('09-heartbeat.yml.ejs — trigger and schedule', () => {
  it('cron schedule is 06:00 UTC daily', () => {
    const rendered = renderHeartbeat({})
    expect(rendered).toContain("cron: '0 6 * * *'")
  })

  it('workflow_dispatch trigger present', () => {
    const rendered = renderHeartbeat({})
    expect(rendered).toContain('workflow_dispatch:')
  })

  it('concurrency group is heartbeat with cancel-in-progress', () => {
    const rendered = renderHeartbeat({})
    expect(rendered).toContain('group: heartbeat')
    expect(rendered).toContain('cancel-in-progress: true')
  })
})

// ─── Freshness thresholds ─────────────────────────────────────────────────────

describe('09-heartbeat.yml.ejs — freshness threshold assertions', () => {
  it('nightly threshold is 26 hours', () => {
    const rendered = renderHeartbeat({})
    const nightlySection = rendered.split('assert-nightly-freshness:')[1] ?? ''
    const endOfSection = nightlySection.split('assert-weekly-freshness:')[0]
    expect(endOfSection).toContain('26')
  })

  it('weekly threshold is 8 days', () => {
    const rendered = renderHeartbeat({})
    const weeklySection = rendered.split('assert-weekly-freshness:')[1] ?? ''
    const endOfSection = weeklySection.split('assert-monthly-freshness:')[0]
    expect(endOfSection).toContain('8')
  })

  it('monthly threshold is 35 days', () => {
    const rendered = renderHeartbeat({})
    const monthlySection = rendered.split('assert-monthly-freshness:')[1] ?? ''
    expect(monthlySection).toContain('35')
  })

  it('nightly checks 06-nightly.yml workflow', () => {
    const rendered = renderHeartbeat({})
    expect(rendered).toContain('06-nightly.yml')
  })

  it('weekly checks 07-weekly.yml workflow', () => {
    const rendered = renderHeartbeat({})
    expect(rendered).toContain('07-weekly.yml')
  })

  it('monthly checks 08-monthly.yml workflow', () => {
    const rendered = renderHeartbeat({})
    expect(rendered).toContain('08-monthly.yml')
  })
})

// ─── Issue filing on failure ──────────────────────────────────────────────────

describe('09-heartbeat.yml.ejs — issue filing on failure', () => {
  it('files issue on nightly freshness failure', () => {
    const rendered = renderHeartbeat({})
    const nightlySection = rendered.split('assert-nightly-freshness:')[1] ?? ''
    const endOfSection = nightlySection.split('assert-weekly-freshness:')[0]
    expect(endOfSection).toContain('gh issue create')
    expect(endOfSection).toContain('heartbeat-nightly-missed')
  })

  it('files issue on weekly freshness failure', () => {
    const rendered = renderHeartbeat({})
    const weeklySection = rendered.split('assert-weekly-freshness:')[1] ?? ''
    const endOfSection = weeklySection.split('assert-monthly-freshness:')[0]
    expect(endOfSection).toContain('gh issue create')
    expect(endOfSection).toContain('heartbeat-weekly-missed')
  })

  it('files issue on monthly freshness failure', () => {
    const rendered = renderHeartbeat({})
    const monthlySection = rendered.split('assert-monthly-freshness:')[1] ?? ''
    expect(monthlySection).toContain('gh issue create')
    expect(monthlySection).toContain('heartbeat-monthly-missed')
  })

  it('deduplicates issue filing (checks for existing open issue first)', () => {
    const rendered = renderHeartbeat({})
    expect(rendered).toContain('gh issue list')
    expect(rendered).toContain('--state open')
  })

  it('issue filing steps run with if: always() for open-or-close pattern', () => {
    const rendered = renderHeartbeat({})
    const issueSteps = rendered.split('if: always()').length - 1
    expect(issueSteps).toBeGreaterThanOrEqual(3)
  })
})
