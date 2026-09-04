import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { buildKnownLimitations } from '../../src/generators/codex-known-limitations.js'
import type { Language, GovernanceLevel } from '../../src/wizard/types.js'

/**
 * M11: Workflow commands — Claude command templates must be parameterized
 * by stack (5 languages), governance level (3 levels), and contain
 * the required structural sections.
 *
 * INV-11: Full matrix coverage.
 * #1216: /ship is the single orchestration narrative; /task is the low-level engine.
 */

// Stack-specific gate commands expected in generated commands
const GATE_COMMANDS: Record<Language, string> = {
  typescript: 'npm run test',
  java: './gradlew test',
  kotlin: './gradlew test',
  rust: 'cargo test',
  go: 'go test ./...',
  python: 'pytest',
  multi: 'npm run test',
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

function renderShip(
  language: Language = 'typescript',
  governanceLevel: GovernanceLevel = 'L2',
  collaborationMode: string = 'peer-review',
  mergeMode: string = 'pr-ff',
): string {
  const config = makeConfig('/tmp/test', {
    language,
    governanceLevel,
    testCommand: GATE_COMMANDS[language],
    collaborationMode: collaborationMode as 'trunk-solo' | 'peer-review' | 'gated-review',
  })
  // mergeMode is resolved separately — inject directly into render context
  return renderTemplate('claude/commands/ship.md.ejs', {
    ...(config as unknown as Record<string, unknown>),
    mergeMode,
  })
}

function renderClaudeMd(governanceLevel: GovernanceLevel = 'L2'): string {
  const config = makeConfig('/tmp/test', { governanceLevel })
  return renderTemplate('claude/CLAUDE.md.ejs', config as unknown as Record<string, unknown>)
}

function renderCodexMd(): string {
  const config = makeConfig('/tmp/test')
  // ADR-106 (#1966): CODEX.md's Known Limitations section is generated from
  // the Claude-track inventory — mirror generateCodex's render enrichment.
  return renderTemplate('codex/CODEX.md.ejs', {
    ...config,
    knownLimitations: buildKnownLimitations(config),
  } as unknown as Record<string, unknown>)
}

function renderCodexExecProtocol(): string {
  const config = makeConfig('/tmp/test')
  // ADR-106 (#1966): the codex exec protocol is DERIVED from the canonical
  // claude template (the parallel codex copy was removed).
  return renderTemplate(
    'claude/rules/90-exec-protocol.md.ejs',
    config as unknown as Record<string, unknown>,
  )
}

function renderCommand(template: string): string {
  return renderTemplate(
    `claude/commands/${template}.ejs`,
    makeConfig('/tmp/test') as unknown as Record<string, unknown>,
  )
}

// ---------------------------------------------------------------------------
// task.md — engine/CLI reference (#1216: trimmed to engine, not orchestrator)
// ---------------------------------------------------------------------------

describe('claude commands: task.md — engine/CLI reference (#1216)', () => {
  it('top banner points at /ship as the orchestration entrypoint', () => {
    const content = renderTask()
    expect(content).toContain('/ship')
  })

  it('initialises the unified task document via arbiter task init/advance', () => {
    const content = renderTask()
    expect(content).toContain('arbiter task init')
    expect(content).toContain('arbiter task advance')
  })

  it('contains tech-debt filing subcommand', () => {
    const content = renderTask()
    expect(content).toContain('arbiter task record-tech-debt')
  })

  it('references AGENTS.md invariants', () => {
    const content = renderTask()
    expect(content).toMatch(/AGENTS\.md/)
  })

  it('no EJS leaks in default render', () => {
    const content = renderTask()
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  it('no EJS leaks in either decompositionBackend render', () => {
    for (const backend of ['github', 'markdown'] as const) {
      const content = renderTask('typescript', 'L2', backend)
      expect(content).not.toContain('<%')
      expect(content).not.toContain('%>')
    }
  })
})

// ---------------------------------------------------------------------------
// ship.md — sole orchestration narrative (#1216)
// ---------------------------------------------------------------------------

describe('claude commands: ship.md — orchestration entrypoint (#1216)', () => {
  it('is framed as the orchestration entrypoint, not as "alongside" /task', () => {
    const content = renderShip()
    // The old "sits alongside /task, it does not replace it" framing must be gone
    expect(content).not.toMatch(/sits alongside.*task.*does not replace/i)
    // And /ship must be framed as the entrypoint
    expect(content).toMatch(/orchestrat/i)
  })

  it('contains arbiter task init shell command explicitly in preflight', () => {
    const content = renderShip()
    expect(content).toContain('arbiter task init')
  })

  // #2343 — this test used to REQUIRE the .git/info/exclude step. That step appended
  // '.arbiter/' to a file git consults before .gitignore, which defeats every negation
  // the repo's own .gitignore relies on (.gitignore uses '.arbiter/**' deliberately) and
  // broke __tests__/scripts/rework-log.test.ts. .git/info/exclude is also shared across
  // every worktree, so one run poisoned all of them. The assertion is inverted: the
  // instruction must stay gone, and the local-only paths it was meant to cover are still
  // named so the guidance itself is not lost.
  it('local-only state: never writes .arbiter/ into .git/info/exclude (#2343)', () => {
    const content = renderShip()
    expect(content).not.toContain('.git/info/exclude')
    for (const pattern of ['.claude/.task-*', '.claude/.task/', '.claude/plans/', '.arbiter/']) {
      expect(content).toContain(pattern)
    }
  })

  it('red-team section includes evidence path .arbiter/evidence/redteam/', () => {
    const content = renderShip('typescript', 'L2')
    expect(content).toContain('.arbiter/evidence/redteam/')
  })

  it('red-team section includes redTeamFindings forward-link with auditorHint', () => {
    const content = renderShip('typescript', 'L2')
    expect(content).toMatch(/redTeamFindings|auditorHint/i)
  })

  it('refactor section writes agents-dispatched.json sidecar (branch+sha)', () => {
    const content = renderShip()
    expect(content).toContain('.arbiter/agents-dispatched.json')
    expect(content).toMatch(/branch.*sha|sha.*branch/i)
  })

  it('uses one authoritative dispatch sidecar for cross-model review', () => {
    const content = renderShip()
    expect(
      content.match(
        /fs\.renameSync\(tempPath, path\.join\(dirPath, 'agents-dispatched\.json'\)\)/g,
      ) ?? [],
    ).toHaveLength(1)
    expect(content).not.toMatch(/> \.arbiter\/agents-dispatched\.json/)
    expect(content).toContain('O_NOFOLLOW')
    expect(content).toContain('manual block writes the complete reviewer')
    expect(content).toContain('codex-reviewer')
    expect(content).toContain('external_review_fulfilled')
    expect(content).toContain('if [ "$task_tier" = Standard ]; then')
    expect(content).toContain('evidence/cross-model')
    expect(content).toMatch(/agents.*codex-reviewer|codex-reviewer.*agents/)
  })

  it('refactor section includes acceptance-criteria PASS/FAIL/NOT-TESTED', () => {
    const content = renderShip()
    expect(content).toMatch(/PASS.*FAIL.*NOT.?TESTED|acceptance.?criteri/i)
  })

  // #1345: the Complete-section done-evidence invocation is gated on the evidence
  // harness — the SAME condition under which scripts/done-evidence.mjs is emitted,
  // so the playbook never instructs running a script that was not shipped.
  it('complete section runs done-evidence.mjs when the evidence harness is on', () => {
    const config = makeConfig('/tmp/test', { governanceLevel: 'L2', enableEvidenceHarness: true })
    const content = renderTemplate(
      'claude/commands/ship.md.ejs',
      config as unknown as Record<string, unknown>,
    )
    expect(content).toContain('done-evidence.mjs')
  })

  it('complete section omits done-evidence.mjs when the evidence harness is off (#1345)', () => {
    const config = makeConfig('/tmp/test', { governanceLevel: 'L2', enableEvidenceHarness: false })
    const content = renderTemplate(
      'claude/commands/ship.md.ejs',
      config as unknown as Record<string, unknown>,
    )
    expect(content).not.toContain('done-evidence.mjs')
  })

  it('complete section closes the issue (gh issue close, or manual for markdown backend)', () => {
    const content = renderShip('typescript', 'L2')
    expect(content).toMatch(/gh issue close|Mark the work item done manually/i)
  })

  it('complete section advances to complete phase', () => {
    const content = renderShip()
    expect(content).toContain('arbiter task advance --to complete')
  })

  it('contains cleanup / worktree close', () => {
    const content = renderShip('typescript', 'L2')
    expect(content).toMatch(/arbiter wt close/i)
  })

  it('contains Silent failure hunter in code-review dispatch', () => {
    const content = renderShip('typescript', 'L2')
    expect(content).toMatch(/Silent failure hunter/i)
  })

  it('contains Adversarial Verifier', () => {
    const content = renderShip('typescript', 'L2')
    expect(content).toMatch(/Adversarial Verifier/i)
  })

  it('contains PR section (merge step)', () => {
    const content = renderShip()
    expect(content).toMatch(/PR|gh pr create/i)
  })

  it('contains gate execution (check-all.mjs)', () => {
    const content = renderShip()
    expect(content).toMatch(/check-all\.mjs/)
  })

  it('no EJS leaks in default (peer-review) render', () => {
    const content = renderShip()
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  it('no EJS leaks in trunk-solo+pr-ff render', () => {
    const content = renderShip('typescript', 'L2', 'trunk-solo', 'pr-ff')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  it('trunk-solo+direct: emits git push origin HEAD:main', () => {
    const content = renderShip('typescript', 'L2', 'trunk-solo', 'direct')
    expect(content).toContain('git push origin HEAD:main')
  })

  it('peer-review (non-direct): does NOT emit git push origin HEAD:main in merge step', () => {
    const content = renderShip('typescript', 'L2', 'peer-review', 'pr-ff')
    expect(content).not.toContain('git push origin HEAD:main')
  })

  it('trunk-solo: uses 1 self-review agent in refactor phase', () => {
    const content = renderShip('typescript', 'L2', 'trunk-solo', 'pr-ff')
    // Phase-map refactor row should indicate trunk-solo count (1), not tier count (4)
    expect(content).toMatch(/trunk.?solo.*1|1.*self.?review/i)
  })

  it('trunk-solo external candidate replaces its single seat without growing the panel', () => {
    const content = renderShip('typescript', 'L2', 'trunk-solo', 'pr-ff')
    expect(content).toContain('if [ "$task_tier" = Standard ]; then')
    expect(content).not.toContain('while (candidate.length < total)')
  })
})

describe('claude commands: ship.md — stack parameterization', () => {
  for (const lang of STACK_LANGUAGES) {
    it(`gate command for ${lang} = ${GATE_COMMANDS[lang]}`, () => {
      const content = renderShip(lang)
      expect(content).toContain(GATE_COMMANDS[lang])
    })
  }
})

describe('claude commands: ship.md — governance level gating', () => {
  it('L2 includes code review agents section', () => {
    const content = renderShip('typescript', 'L2')
    expect(content).toMatch(/Adversarial Verifier/)
    expect(content).toMatch(/agents-dispatched/)
  })

  it('L2 includes red-team review', () => {
    const content = renderShip('typescript', 'L2')
    expect(content).toContain('.arbiter/evidence/redteam/')
  })

  it('L2 includes worktree recommendation', () => {
    const content = renderShip('typescript', 'L2')
    expect(content).toMatch(/wt-open/)
  })
})

describe('claude commands: ship.md — merge step branching', () => {
  it('peer-review mode: merge step uses gh pr create/merge', () => {
    const content = renderShip('typescript', 'L2', 'peer-review', 'pr-ff')
    expect(content).toContain('gh pr create')
    expect(content).toContain('gh pr merge --merge')
    expect(content).not.toContain('--admin')
    expect(content).not.toContain('gh pr merge --rebase')
  })

  it('trunk-solo pr-ff uses the exact-SHA watcher, never a GitHub PR merge method', () => {
    const content = renderShip('typescript', 'L2', 'trunk-solo', 'pr-ff')
    expect(content).toContain('gh pr create')
    expect(content).toContain('scripts/pr-merge-watch.mjs')
    expect(content).not.toContain('gh pr merge')
  })

  // #2150 AC-4 (the half that survives here): the non-solo arc keeps its GitHub PR
  // merge — without a trusted updater it is the only landing path a consumer has —
  // but it now DECLARES that it does not land the exact gated SHA, instead of
  // letting the reader assume the trunk-solo guarantee carries over.
  it.each([['peer-review'], ['gated-review']])(
    '%s arc declares openly that main != gatedHeadSha and names the deferred issue',
    (mode) => {
      const content = renderShip('typescript', 'L2', mode, 'pr-ff')
      expect(content).toContain('main != gatedHeadSha')
      expect(content).toContain('#2289')
      expect(content).not.toContain('--admin')
    },
  )

  it('trunk-solo does NOT carry the non-solo disclaimer', () => {
    const content = renderShip('typescript', 'L2', 'trunk-solo', 'pr-ff')
    expect(content).not.toContain('main != gatedHeadSha')
  })
})

// ---------------------------------------------------------------------------
// CLAUDE.md slash table — /ship as orchestrator (#1216)
// ---------------------------------------------------------------------------

describe('claude CLAUDE.md — /ship in slash-command table (#1216)', () => {
  it('slash table contains a /ship row', () => {
    const content = renderClaudeMd()
    expect(content).toMatch(/\|\s*`?\/ship/)
  })

  it('/ship row describes it as the orchestration entrypoint', () => {
    const content = renderClaudeMd()
    expect(content).toMatch(/\/ship.*orchestrat|orchestrat.*\/ship/i)
  })

  it('no EJS leaks in default render', () => {
    const content = renderClaudeMd()
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ---------------------------------------------------------------------------
// Codex parity — /ship as orchestrator in codex surfaces (#1216)
// ---------------------------------------------------------------------------

describe('codex CODEX.md — /ship in command table (#1216)', () => {
  it('contains a /ship entry in the command/slash table', () => {
    const content = renderCodexMd()
    expect(content).toMatch(/\/ship|ship/)
  })

  it('no EJS leaks', () => {
    const content = renderCodexMd()
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

describe('codex rules/90-exec-protocol — /ship as orchestration path (#1216)', () => {
  it('references /ship for orchestration', () => {
    const content = renderCodexExecProtocol()
    expect(content).toMatch(/\/ship|ship/)
  })

  it('no EJS leaks', () => {
    const content = renderCodexExecProtocol()
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ---------------------------------------------------------------------------
// Worktree helpers (unchanged)
// ---------------------------------------------------------------------------

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
