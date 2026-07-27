import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

function configFor() {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
    buildTool: 'npm',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --write',
  })
}

const VALID_SURVEY = `
## Existing Code Survey

- **Target:** \`src/new-widget.ts\`
- **Decision:** \`new file justified\`

### Evidence
- \`grep "export.*Widget" src/\` → \`(no match)\`
- \`grep "widget" src/\` → \`(no match)\`
- \`ls src/generators/\` → \`(none similar)\`

### Rationale
Widget handles a new responsibility that has no overlap with existing generators or commands. Grepped for "Widget", "widget", and "generate" across all src/ files — found no similar export or pattern. The new file is justified because it introduces a distinct abstraction that cannot be folded into any existing module without semantic pollution.
`.trim()

function setup(phase: string, planContent: string | null, planPath?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-plan-anchor-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  // Create src/foo.ts so existsSync check early-exits for the base tests
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'foo.ts'), 'export const foo = 1;\n')

  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', configFor()))

  const hookPath = join(hooksDir, 'pre-edit-plan-anchor.mjs')
  writeFileSync(hookPath, renderTemplate('claude/hooks/pre-edit-plan-anchor.mjs.ejs', configFor()))

  const resolvedPlanPath = planPath ?? join(dir, '.claude', 'plans', 'task.md')
  if (planContent !== null) {
    mkdirSync(join(dir, '.claude', 'plans'), { recursive: true })
    writeFileSync(resolvedPlanPath, planContent)
    writeTaskStateFile(dir, { taskId: '#1', phase, plan: resolvedPlanPath, branch: 'main' })
  } else {
    writeTaskStateFile(dir, { taskId: '#1', phase, branch: 'main' })
  }

  return { dir, hookPath }
}

function run(hookPath: string, cwd: string, extraEnv: Record<string, string> = {}) {
  return spawnSync('node', [hookPath], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, CLAUDE_TOOL_INPUT_PATH: 'src/foo.ts', ...extraEnv },
  })
}

describe('pre-edit-plan-anchor', () => {
  it('exits 0 when phase is not an impl phase (plan missing)', () => {
    const { dir, hookPath } = setup('plan', null)
    try {
      expect(run(hookPath, dir).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when red phase and plan is unknown', () => {
    const { dir, hookPath } = setup('red', null)
    try {
      const result = run(hookPath, dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('PLAN ANCHOR')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when red phase and plan path does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-plan-anchor-'))
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
    const hooksDir = join(dir, '.claude', 'hooks')
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(
      join(hooksDir, 'lib.mjs'),
      renderTemplate('claude/hooks/lib.mjs.ejs', configFor()),
    )
    const hookPath = join(hooksDir, 'pre-edit-plan-anchor.mjs')
    writeFileSync(
      hookPath,
      renderTemplate('claude/hooks/pre-edit-plan-anchor.mjs.ejs', configFor()),
    )
    writeTaskStateFile(dir, {
      taskId: '#1',
      phase: 'red',
      plan: '/nonexistent/path/to/plan.md',
      branch: 'main',
    })
    try {
      const result = run(hookPath, dir)
      expect(result.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 and injects plan when red phase and valid plan', () => {
    const { dir, hookPath } = setup('red', '# My Plan\nStep 1: do something\n')
    try {
      const result = run(hookPath, dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('ACTIVE PLAN')
      expect(result.stdout).toContain('Step 1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when ARBITER_PLAN_BYPASS=1 even in red with no plan', () => {
    const { dir, hookPath } = setup('red', null)
    try {
      expect(run(hookPath, dir, { ARBITER_PLAN_BYPASS: '1' }).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-7 disarms stale branch state on main with a causal diagnostic', () => {
    const { dir, hookPath } = setup('red', '# stale plan\n')
    try {
      writeTaskStateFile(dir, {
        taskId: '#2120',
        phase: 'red',
        plan: '.claude/plans/task.md',
        branch: 'tmp-red',
      })
      const result = run(hookPath, dir)
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('.claude/.task/status.json')
      expect(result.stderr).toContain('#2120')
      expect(result.stderr).toContain('.claude/plans/task.md')
      expect(result.stderr).toContain('tmp-red')
      expect(result.stderr).toContain('main')
      expect(result.stderr).toMatch(/task init|realign/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-7 keeps a coherent trunk-solo task on main governed', () => {
    const { dir, hookPath } = setup('red', null)
    try {
      writeTaskStateFile(dir, { taskId: '#2135', phase: 'red', branch: 'main' })
      const result = run(hookPath, dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('#2135')
      expect(result.stderr).toContain('main')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-7 keeps a coherent task branch governed', () => {
    const { dir, hookPath } = setup('red', null)
    try {
      execFileSync('git', ['checkout', '-b', 'task/#2135-probe'], { cwd: dir, stdio: 'ignore' })
      writeTaskStateFile(dir, {
        taskId: '#2135',
        phase: 'red',
        branch: 'task/#2135-probe',
      })
      expect(run(hookPath, dir).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-7 fails closed when the current Git branch cannot be resolved', () => {
    const { dir, hookPath } = setup('red', '# plan\n')
    try {
      writeTaskStateFile(dir, { taskId: '#2135', phase: 'red', branch: 'main' })
      rmSync(join(dir, '.git'), { recursive: true, force: true })
      const result = run(hookPath, dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/branch.*resolve|git/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('pre-edit-plan-anchor — CANON-16 survey gate', () => {
  it('exits 0 for new src/ file with valid Survey in plan', () => {
    const { dir, hookPath } = setup('red', `# Plan\n\n${VALID_SURVEY}\n`)
    try {
      const result = run(hookPath, dir, {
        CLAUDE_TOOL_INPUT_PATH: 'src/new-widget.ts',
      })
      expect(result.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 for new src/ file with no Survey section', () => {
    const { dir, hookPath } = setup('red', '# Plan\n\nNo survey here.\n')
    try {
      const result = run(hookPath, dir, {
        CLAUDE_TOOL_INPUT_PATH: 'src/new-widget.ts',
      })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('CANON-16')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when Survey Target does not match the file being written', () => {
    const wrongSurvey = VALID_SURVEY.replace(
      '- **Target:** `src/new-widget.ts`',
      '- **Target:** `src/other-file.ts`',
    )
    const { dir, hookPath } = setup('red', `# Plan\n\n${wrongSurvey}\n`)
    try {
      const result = run(hookPath, dir, {
        CLAUDE_TOOL_INPUT_PATH: 'src/new-widget.ts',
      })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('CANON-16')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when Survey has fewer than 3 evidence rows', () => {
    const thinSurvey = VALID_SURVEY.replace(
      '- `grep "widget" src/` → `(no match)`\n- `ls src/generators/` → `(none similar)`',
      '',
    )
    const { dir, hookPath } = setup('red', `# Plan\n\n${thinSurvey}\n`)
    try {
      const result = run(hookPath, dir, {
        CLAUDE_TOOL_INPUT_PATH: 'src/new-widget.ts',
      })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('CANON-16')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when Survey Rationale is under 200 chars', () => {
    const stubSurvey = VALID_SURVEY.replace(/### Rationale\n[\s\S]*/, '### Rationale\nNeeded.\n')
    const { dir, hookPath } = setup('red', `# Plan\n\n${stubSurvey}\n`)
    try {
      const result = run(hookPath, dir, {
        CLAUDE_TOOL_INPUT_PATH: 'src/new-widget.ts',
      })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('CANON-16')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 for existing src/ file (existsSync early-exit)', () => {
    const { dir, hookPath } = setup('red', '# Plan\n\nNo survey here.\n')
    try {
      // src/foo.ts is created by setup()
      const result = run(hookPath, dir, {
        CLAUDE_TOOL_INPUT_PATH: 'src/foo.ts',
      })
      expect(result.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 for new file outside src/ (scope guard)', () => {
    const { dir, hookPath } = setup('red', '# Plan\n\nNo survey.\n')
    try {
      const result = run(hookPath, dir, {
        CLAUDE_TOOL_INPUT_PATH: 'scripts/new-script.mjs',
      })
      expect(result.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 for new test file (exclusion guard)', () => {
    const { dir, hookPath } = setup('red', '# Plan\n\nNo survey.\n')
    try {
      const result = run(hookPath, dir, {
        CLAUDE_TOOL_INPUT_PATH: 'src/__tests__/new.test.ts',
      })
      expect(result.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
