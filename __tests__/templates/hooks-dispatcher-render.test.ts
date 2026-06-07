import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { Language, GovernanceLevel } from '../../src/wizard/types.js'

/**
 * Tests for hooks/hooks.mjs.ejs — the event dispatcher (#248).
 * Verifies: no EJS leaks, config table present, conditional handlers correct.
 */

function configFor(
  lang: Language = 'typescript',
  level: GovernanceLevel = 'L1',
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return makeConfig('/tmp/test', {
    language: lang,
    governanceLevel: level,
    ...extra,
  }) as unknown as Record<string, unknown>
}

describe('hooks/hooks.mjs.ejs — dispatcher template (#248)', () => {
  it('renders without EJS tag leaks for typescript L1', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L1'))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('renders without EJS tag leaks for all languages', () => {
    const langs: Language[] = ['typescript', 'java', 'rust', 'go', 'python']
    for (const lang of langs) {
      const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor(lang, 'L1'))
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    }
  })

  it('contains HANDLERS config table', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor())
    expect(out).toContain('const HANDLERS')
  })

  it('contains all base event keys', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor())
    expect(out).toContain('PreToolUse:Bash')
    expect(out).toContain('PreToolUse:Edit|Write')
    expect(out).toContain('PostToolUse:Bash')
    expect(out).toContain('PostToolUse:Edit|Write')
    expect(out).toContain('PreCompact')
  })

  it('dispatches stop-dangerous.mjs for PreToolUse:Bash', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor())
    expect(out).toContain('stop-dangerous.mjs')
  })

  it('dispatches enforce-read-only.mjs for PreToolUse:Edit|Write', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor())
    expect(out).toContain('enforce-read-only.mjs')
  })

  it('dispatches check-no-placeholders.mjs at L1', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L1'))
    expect(out).toContain('check-no-placeholders.mjs')
  })

  it('does NOT include check-no-unused-exports.mjs for non-TypeScript', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('rust', 'L1'))
    expect(out).not.toContain('check-no-unused-exports.mjs')
  })

  it('includes check-no-unused-exports.mjs for TypeScript', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L1'))
    expect(out).toContain('check-no-unused-exports.mjs')
  })

  it('includes UserPromptSubmit key at L2', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L2'))
    expect(out).toContain('UserPromptSubmit')
    expect(out).toContain('guard-task-completion.mjs')
    expect(out).toContain('skill-forced-eval.mjs')
  })

  it('does NOT include UserPromptSubmit key at L1', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L1'))
    expect(out).not.toContain('UserPromptSubmit')
    expect(out).not.toContain('guard-task-completion.mjs')
  })

  it('includes the Stop event + stop-evidence-guard.mjs at L2 (#1212/INV-114)', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L2'))
    expect(out).toContain("'Stop'")
    expect(out).toContain('stop-evidence-guard.mjs')
  })

  it('does NOT include the Stop event at L1 (#1212)', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L1'))
    expect(out).not.toContain('stop-evidence-guard.mjs')
    expect(out).not.toContain("'Stop'")
  })

  it('includes post-edit-dispatch.mjs at L2', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L2'))
    expect(out).toContain('post-edit-dispatch.mjs')
  })

  it('does NOT include post-edit-dispatch.mjs at L1', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L1'))
    expect(out).not.toContain('post-edit-dispatch.mjs')
  })

  it('includes debug-state-on-failure.mjs at L2', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L2'))
    expect(out).toContain('debug-state-on-failure.mjs')
  })

  it('does NOT include debug-state-on-failure.mjs at L1', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L1'))
    expect(out).not.toContain('debug-state-on-failure.mjs')
  })

  it('reads event key from process.argv[2]', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor())
    expect(out).toContain('process.argv[2]')
  })

  it('buffers stdin for all handlers', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor())
    expect(out).toContain('stdinData')
    expect(out).toContain('readFileSync(0)')
  })

  it('spawns handlers via spawnSync', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor())
    expect(out).toContain('spawnSync')
  })

  it('aborts chain on first non-zero exit', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor())
    expect(out).toContain('process.exit(result.status)')
  })

  it('includes check-no-pii.mjs when enableSecurityScanning is true', () => {
    const out = renderTemplate(
      'claude/hooks/hooks.mjs.ejs',
      configFor('typescript', 'L1', { enableSecurityScanning: true }),
    )
    expect(out).toContain('check-no-pii.mjs')
  })

  it('does NOT include check-no-pii.mjs when enableSecurityScanning is false', () => {
    const out = renderTemplate(
      'claude/hooks/hooks.mjs.ejs',
      configFor('typescript', 'L1', { enableSecurityScanning: false }),
    )
    expect(out).not.toContain('check-no-pii.mjs')
  })

  it('interpolates projectName', () => {
    const out = renderTemplate(
      'claude/hooks/hooks.mjs.ejs',
      makeConfig('/tmp/test', {
        projectName: 'my-proj',
        governanceLevel: 'L1',
      }) as unknown as Record<string, unknown>,
    )
    expect(out).toContain('my-proj')
  })
})

describe('hooks/hooks.mjs.ejs — ExitPlanMode handler (#1210)', () => {
  it('includes PostToolUse:ExitPlanMode key at L2', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L2'))
    expect(out).toContain('PostToolUse:ExitPlanMode')
  })

  it('includes exitplanmode-banner.mjs in dispatcher at L2', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L2'))
    expect(out).toContain('exitplanmode-banner.mjs')
  })

  it('does NOT include PostToolUse:ExitPlanMode at L1', () => {
    const out = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor('typescript', 'L1'))
    expect(out).not.toContain('PostToolUse:ExitPlanMode')
    expect(out).not.toContain('exitplanmode-banner.mjs')
  })
})
