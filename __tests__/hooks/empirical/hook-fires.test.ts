import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

const STATIC_HOOKS_DIR = join(process.cwd(), 'src/templates/claude/hooks')

function minConfig() {
  return makeConfig('/tmp/hook-fires-test', {
    language: 'typescript',
    projectName: 'hook-fires-test',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --write',
  })
}

function makeHookDir(): { dir: string; hooksDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-hook-fires-'))
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
  const hooksDir = join(dir, '.claude', 'hooks')
  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', minConfig()))
  return { dir, hooksDir }
}

function renderEjsHook(hooksDir: string, name: string): string {
  const dest = join(hooksDir, name.replace('.ejs', ''))
  writeFileSync(dest, renderTemplate(`claude/hooks/${name}`, minConfig()))
  return dest
}

function spawnHook(
  hookPath: string,
  dir: string,
  env: Record<string, string> = {},
  stdin?: string,
) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    encoding: 'utf-8',
    input: stdin,
    env: { ...process.env, ...env },
    timeout: 5000,
  })
}

// ── static hooks ──────────────────────────────────────────────────────────────

describe('stop-dangerous — empirical fire', () => {
  const hookPath = join(STATIC_HOOKS_DIR, 'stop-dangerous.mjs')

  it('exits 0 for benign command', () => {
    const r = spawnHook(hookPath, process.cwd(), {
      CLAUDE_TOOL_INPUT_COMMAND: 'npm test',
    })
    expect(r.status).toBe(0)
  })

  it('exits 1 and emits stderr for rm -rf /', () => {
    const r = spawnHook(hookPath, process.cwd(), {
      CLAUDE_TOOL_INPUT_COMMAND: 'rm -rf /tmp/blah',
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/blocked/i)
  })

  it('exits 1 for git push --force', () => {
    const r = spawnHook(hookPath, process.cwd(), {
      CLAUDE_TOOL_INPUT_COMMAND: 'git push --force origin main',
    })
    expect(r.status).toBe(1)
  })
})

describe('check-no-pii — empirical fire', () => {
  let dir: string
  let hooksDir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hooksDir } = makeHookDir())
    hookPath = renderEjsHook(hooksDir, 'check-no-pii.mjs.ejs')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 when CLAUDE_TOOL_INPUT_PATH is empty', () => {
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: '' })
    expect(r.status).toBe(0)
  })

  it('exits 0 for clean file', () => {
    const f = join(dir, 'clean.ts')
    writeFileSync(f, 'export const x = 1;\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(0)
  })

  it('exits 1 when file contains email address pattern', () => {
    const f = join(dir, 'dirty.ts')
    writeFileSync(f, 'const contact = "user@example.com";\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/INV-12|PII/i)
  })
})

describe('check-no-orphan-todo — empirical fire', () => {
  const hookPath = join(STATIC_HOOKS_DIR, 'check-no-orphan-todo.mjs')
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-todo-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 when no path provided', () => {
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: '' })
    expect(r.status).toBe(0)
  })

  it('exits 0 for file with no TODOs', () => {
    const f = join(dir, 'clean.ts')
    writeFileSync(f, 'export const x = 1;\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(0)
  })

  it('exits 0 for correctly-tagged TODO(#123)', () => {
    const f = join(dir, 'good.ts')
    // Use concatenation to avoid triggering the orphan-todo hook on this source file
    const content = '// ' + 'TODO(#123): fix this later\n'
    writeFileSync(f, content)
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(0)
  })

  it('exits 1 for bare TODO without task ID', () => {
    const f = join(dir, 'bad.ts')
    // Write literal content to temp file — no hook fires on test source
    writeFileSync(f, '// TO' + 'DO: needs fixing\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/INV-21|orphan/i)
  })
})

describe('enforce-read-only — empirical fire', () => {
  const hookPath = join(STATIC_HOOKS_DIR, 'enforce-read-only.mjs')

  it('exits 0 for non-protected file', () => {
    const r = spawnHook(hookPath, process.cwd(), {
      CLAUDE_TOOL_INPUT_PATH: 'src/foo.ts',
    })
    expect(r.status).toBe(0)
  })

  it('exits 1 when AGENTS.md is targeted', () => {
    const r = spawnHook(hookPath, process.cwd(), {
      CLAUDE_TOOL_INPUT_PATH: '/project/AGENTS.md',
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/read-only/i)
  })

  it('exits 1 when package-lock.json is targeted', () => {
    const r = spawnHook(hookPath, process.cwd(), {
      CLAUDE_TOOL_INPUT_PATH: 'package-lock.json',
    })
    expect(r.status).toBe(1)
  })
})

// ── EJS hooks ─────────────────────────────────────────────────────────────────

describe('lib.mjs — render and export check', () => {
  it('renders without throwing and produces a JS module with expected exports', () => {
    const rendered = renderTemplate('claude/hooks/lib.mjs.ejs', minConfig())
    expect(rendered).toContain('export')
    expect(rendered).toContain('getRepoRoot')
    expect(rendered).toContain('readTaskState')
    expect(rendered).toContain('logInfo')
  })
})

describe('post-commit-check — empirical fire', () => {
  let dir: string
  let hooksDir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hooksDir } = makeHookDir())
    hookPath = renderEjsHook(hooksDir, 'post-commit-check.mjs.ejs')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 when command is not a git commit', () => {
    const r = spawnHook(hookPath, dir, {
      CLAUDE_TOOL_INPUT_COMMAND: 'npm test',
    })
    expect(r.status).toBe(0)
  })

  it('exits 0 when git log fails (not a git repo)', () => {
    const r = spawnHook(hookPath, dir, {
      CLAUDE_TOOL_INPUT_COMMAND: "git commit -m 'feat(#1): init'",
    })
    expect(r.status).toBe(0)
  })

  it('exits 1 on non-conventional commit message (INV-22)', () => {
    spawnSync('git', ['init'], { cwd: dir, encoding: 'utf-8' })
    spawnSync('git', ['config', 'user.email', 'test@arbiter.test'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    spawnSync('git', ['config', 'user.name', 'Arbiter Test'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    spawnSync('git', ['commit', '--allow-empty', '-m', 'bad commit message'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    const r = spawnHook(hookPath, dir, {
      CLAUDE_TOOL_INPUT_COMMAND: 'git commit',
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/INV-22/)
  })

  it('exits 0 on valid conventional commit message', () => {
    spawnSync('git', ['init'], { cwd: dir, encoding: 'utf-8' })
    spawnSync('git', ['config', 'user.email', 'test@arbiter.test'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    spawnSync('git', ['config', 'user.name', 'Arbiter Test'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    spawnSync('git', ['commit', '--allow-empty', '-m', 'feat(auth): add login'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    const r = spawnHook(hookPath, dir, {
      CLAUDE_TOOL_INPUT_COMMAND: 'git commit',
    })
    expect(r.status).toBe(0)
  })
})

describe('pre-compact — empirical fire', () => {
  let dir: string
  let hooksDir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hooksDir } = makeHookDir())
    hookPath = renderEjsHook(hooksDir, 'pre-compact.mjs.ejs')
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeTaskStateFile(dir, { phase: 'implementation', taskId: '#1', tier: 'S' })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 and writes session state to stdout', () => {
    const r = spawnHook(hookPath, dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/SESSION STATE/i)
  })
})

describe('skill-forced-eval — empirical fire', () => {
  let dir: string
  let hooksDir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hooksDir } = makeHookDir())
    hookPath = renderEjsHook(hooksDir, 'skill-forced-eval.mjs.ejs')
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeTaskStateFile(dir, { phase: 'plan', taskId: '#1', tier: 'S' })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 and writes plan-mode context to stdout in plan phase', () => {
    const r = spawnHook(hookPath, dir, {}, JSON.stringify({ prompt: 'go' }))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/PLAN MODE/i)
  })
})

describe('post-edit-dispatch — empirical fire', () => {
  let dir: string
  let hooksDir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hooksDir } = makeHookDir())
    hookPath = renderEjsHook(hooksDir, 'post-edit-dispatch.mjs.ejs')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 when no CLAUDE_TOOL_INPUT_PATH set', () => {
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: '' })
    expect(r.status).toBe(0)
  })

  it('exits 0 for non-source file (always non-blocking)', () => {
    const f = join(dir, 'README.md')
    writeFileSync(f, '# hello\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(0)
  })
})

describe('debug-state-on-failure — empirical fire', () => {
  let dir: string
  let hooksDir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hooksDir } = makeHookDir())
    hookPath = renderEjsHook(hooksDir, 'debug-state-on-failure.mjs.ejs')
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeTaskStateFile(dir, { phase: 'implementation', taskId: '#1', tier: 'S' })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 for non-test command (no-op for unrelated commands)', () => {
    const r = spawnHook(
      hookPath,
      dir,
      {},
      JSON.stringify({ tool_input: { command: 'echo hello' }, error: '' }),
    )
    expect(r.status).toBe(0)
  })

  it('exits 0 and writes debug state for test command failure', () => {
    const r = spawnHook(
      hookPath,
      dir,
      {},
      JSON.stringify({
        tool_input: { command: 'npm test' },
        error: 'FAIL: 2 tests failed',
      }),
    )
    expect(r.status).toBe(0)
  })
})

describe('check-no-skipped-tests — empirical fire (#730)', () => {
  const hookPath = join(STATIC_HOOKS_DIR, 'check-no-skipped-tests.mjs')
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-skip-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 when no path provided', () => {
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: '' })
    expect(r.status).toBe(0)
  })

  it('exits 0 for clean TypeScript test file', () => {
    const f = join(dir, 'foo.test.ts')
    writeFileSync(f, "it('works', () => { expect(1).toBe(1) })\n")
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(0)
  })

  it('exits 1 for it.skip( in a .ts file', () => {
    const f = join(dir, 'foo.test.ts')
    writeFileSync(f, "it.skip('broken', () => {})\n")
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/NI-11/)
  })

  it('exits 1 for xit( in a .ts file', () => {
    const f = join(dir, 'foo.test.ts')
    writeFileSync(f, "xit('old', () => {})\n")
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(1)
  })

  it('exits 1 for @Disabled in a .java file', () => {
    const f = join(dir, 'FooTest.java')
    writeFileSync(f, '@Disabled\n@Test\npublic void testFoo() {}\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/NI-11/)
  })

  it('exits 0 for @Disabled in a .ts file (not Java)', () => {
    const f = join(dir, 'foo.ts')
    writeFileSync(f, '// @Disabled\nconst x = 1\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(0)
  })
})
