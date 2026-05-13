import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { Language, GovernanceLevel } from '../../src/wizard/types.js'

/**
 * M11: Workflow commands — Claude command templates must be parameterized
 * by stack (5 languages), governance level (3 levels), and contain
 * the required structural sections.
 *
 * INV-11: Full matrix coverage.
 */

// Stack-specific gate commands expected in generated commands
const GATE_COMMANDS: Record<Language, string> = {
  typescript: 'npm run test',
  java: './gradlew test',
  rust: 'cargo test',
  go: 'go test ./...',
  python: 'pytest',
  unknown: 'echo',
}

const STACK_LANGUAGES: Language[] = ['typescript', 'java', 'rust', 'go', 'python']

function renderTask(
  language: Language = 'typescript',
  governanceLevel: GovernanceLevel = 'L2',
  decompositionBackend: 'github' | 'markdown' = 'github',
): string {
  const config = makeConfig('/tmp/test', {
    language,
    governanceLevel,
    testCommand: GATE_COMMANDS[language],
    decompositionBackend,
  })
  return renderTemplate('claude/commands/task.md.ejs', config as unknown as Record<string, unknown>)
}

function renderCommand(template: string): string {
  return renderTemplate(
    `claude/commands/${template}.ejs`,
    makeConfig('/tmp/test') as unknown as Record<string, unknown>,
  )
}

describe('claude commands: task.md — structural sections', () => {
  it('contains branch enforcement section', () => {
    const content = renderTask()
    expect(content).toMatch(/branch/i)
    expect(content).toMatch(/main|master/i)
  })

  it('contains plan gate with STOP', () => {
    const content = renderTask()
    expect(content).toMatch(/STOP/)
  })

  it('has PLAN/EXEC split', () => {
    const content = renderTask()
    expect(content).toMatch(/PHASE PLAN/)
    expect(content).toMatch(/PHASE EXEC/)
  })

  it('contains preflight section with flag parsing', () => {
    const content = renderTask()
    expect(content).toMatch(/Preflight/i)
    expect(content).toMatch(/skip-review/)
    expect(content).toMatch(/dry-run/)
  })

  it('contains tier classification (XS/S/Standard) at L2+', () => {
    const content = renderTask()
    expect(content).toMatch(/XS/)
    expect(content).toMatch(/Standard/)
  })

  it('contains state file writes (.task-id, .task-plan) and arbiter task advance', () => {
    const content = renderTask()
    expect(content).toMatch(/\.task-id/)
    expect(content).toMatch(/\.task-plan/)
    expect(content).toContain('arbiter task advance')
  })

  it('sets local exclude entries before writing task state', () => {
    const content = renderTask()
    const excludeIdx = content.indexOf('touch .git/info/exclude')
    const taskStateIdx = content.indexOf('echo "#NNN" > .claude/.task-id')
    expect(excludeIdx).toBeGreaterThan(-1)
    expect(taskStateIdx).toBeGreaterThan(excludeIdx)
    for (const pattern of [
      '.claude/.task-*',
      '.claude/plans/',
      '.agents-dispatched',
      '.arbiter/',
    ]) {
      expect(content).toContain(pattern)
    }
  })

  it('contains code review agent dispatch section at L2+', () => {
    const content = renderTask()
    expect(content).toMatch(/Silent failure hunter/)
    expect(content).toMatch(/agents-dispatched/)
    expect(content).toMatch(/Adversarial Verifier/)
  })

  it('contains worktree recommendation at L2+', () => {
    const content = renderTask()
    expect(content).toMatch(/wt-open/)
  })

  it('contains cleanup phase at L2+', () => {
    const content = renderTask()
    expect(content).toMatch(/Cleanup/i)
    expect(content).toMatch(/wt-close/)
  })

  it('contains issue read instruction (github backend uses gh issue view)', () => {
    const content = renderTask('typescript', 'L2', 'github')
    expect(content).toMatch(/gh issue view/i)
  })

  it('references AGENTS.md invariants', () => {
    const content = renderTask()
    expect(content).toMatch(/AGENTS\.md/)
  })

  it('contains gate execution section', () => {
    const content = renderTask()
    expect(content).toMatch(/gate|Gate/i)
  })

  it('contains commit section', () => {
    const content = renderTask()
    expect(content).toMatch(/commit|Commit/i)
  })

  it('contains PR creation section', () => {
    const content = renderTask()
    expect(content).toMatch(/PR|pull request|gh pr create/i)
  })

  it('contains branch validation (not main)', () => {
    const content = renderTask()
    expect(content).toMatch(/main|master/i)
  })
})

describe('claude commands: task.md — governance level gating', () => {
  it('L1 does NOT include code review agent section', () => {
    const content = renderTask('typescript', 'L1')
    expect(content).not.toMatch(/Adversarial Verifier/)
    expect(content).not.toMatch(/agents-dispatched/)
  })

  it('L1 does NOT include cleanup phase', () => {
    const content = renderTask('typescript', 'L1')
    expect(content).not.toMatch(/\bCleanup\b/)
  })

  it('L1 does NOT include worktree recommendation', () => {
    const content = renderTask('typescript', 'L1')
    expect(content).not.toMatch(/wt-open/)
  })

  it('L2 includes code review agents and verifier', () => {
    const content = renderTask('typescript', 'L2')
    expect(content).toMatch(/Adversarial Verifier/)
    expect(content).toMatch(/agents-dispatched/)
  })

  it('L3 includes verification criteria section', () => {
    const content = renderTask('typescript', 'L3')
    expect(content).toMatch(/Verification criteria/)
    expect(content).toMatch(/SSOT updates/)
  })
})

describe('claude commands: task.md — stack parameterization', () => {
  for (const lang of STACK_LANGUAGES) {
    it(`gate command for ${lang} = ${GATE_COMMANDS[lang]}`, () => {
      const content = renderTask(lang)
      expect(content).toContain(GATE_COMMANDS[lang])
    })
  }
})

describe('claude commands: task.md — decompositionBackend branching (CANON-04/13)', () => {
  it('github backend: Phase 0 uses gh issue view', () => {
    const content = renderTask('typescript', 'L2', 'github')
    expect(content).toContain('gh issue view NNN')
    expect(content).not.toContain('arbiter work show')
  })

  it('markdown backend: Phase 0 uses arbiter work show', () => {
    const content = renderTask('typescript', 'L2', 'markdown')
    expect(content).toContain('arbiter work show')
    expect(content).not.toContain('gh issue view NNN')
  })

  it('github backend: Phase 10 uses gh pr create/merge', () => {
    const content = renderTask('typescript', 'L2', 'github')
    expect(content).toContain('gh pr create')
    expect(content).toContain('gh pr merge')
  })

  it('markdown backend: Phase 10 uses arbiter work close', () => {
    const content = renderTask('typescript', 'L2', 'markdown')
    expect(content).toContain('arbiter work close')
    expect(content).not.toContain('gh pr create')
  })

  it('github backend L2+: Phase 11 uses gh issue close', () => {
    const content = renderTask('typescript', 'L2', 'github')
    expect(content).toContain('gh issue close NNN')
  })

  it('markdown backend L2+: Phase 11 uses arbiter work close', () => {
    const content = renderTask('typescript', 'L2', 'markdown')
    const matches = (content.match(/arbiter work close/g) ?? []).length
    expect(matches).toBeGreaterThanOrEqual(1)
    expect(content).not.toContain('gh issue close')
  })

  it('no EJS leaks in either backend render', () => {
    for (const backend of ['github', 'markdown'] as const) {
      const content = renderTask('typescript', 'L2', backend)
      expect(content).not.toContain('<%')
      expect(content).not.toContain('%>')
    }
  })
})

describe('claude commands: worktree helpers', () => {
  it('renders wt-open without EJS leaks and invokes arbiter wt open', () => {
    const content = renderCommand('wt-open.md')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
    expect(content).toContain('arbiter wt open <TASK_ID> [SLUG]')
  })

  it('renders wt-close without EJS leaks and invokes arbiter wt close', () => {
    const content = renderCommand('wt-close.md')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
    expect(content).toContain('arbiter wt close <TASK_ID>')
  })
})
