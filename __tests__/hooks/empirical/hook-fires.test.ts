import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { generateClaude } from '../../../src/generators/claude.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'
import { describeSpawnResult } from '../../helpers/spawn-diag.js'

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

// Materialize a raw (non-EJS) hook verbatim into a fresh project hooks dir, alongside the
// rendered lib.mjs it now imports (resolveToolInputPath). Spawning a raw hook directly from
// src/templates/ would fail to resolve `./lib.mjs` (only lib.mjs.ejs lives there).
function makeRawHook(name: string): { dir: string; hooksDir: string; hookPath: string } {
  const { dir, hooksDir } = makeHookDir()
  const hookPath = join(hooksDir, name)
  writeFileSync(hookPath, readFileSync(join(STATIC_HOOKS_DIR, name), 'utf-8'))
  return { dir, hooksDir, hookPath }
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

function spawnCommandThroughStdin(hookPath: string, dir: string, command: string) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    encoding: 'utf-8',
    input: JSON.stringify({ tool_input: { command } }),
    // Claude Code supplies the Bash command in stdin JSON, not this compatibility env var.
    env: { ...process.env, CLAUDE_TOOL_INPUT_COMMAND: '' },
    timeout: 5000,
  })
}

// ── static hooks ──────────────────────────────────────────────────────────────

describe('stop-dangerous — empirical fire', () => {
  let dir: string
  let hookPath: string

  beforeEach(() => {
    // Raw .mjs hook copied verbatim alongside the rendered lib.mjs it now imports
    // (resolveToolInputCommand). Spawning from src/templates/ would fail to resolve ./lib.mjs.
    ;({ dir, hookPath } = makeRawHook('stop-dangerous.mjs'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 for benign command', () => {
    const r = spawnHook(hookPath, dir, {
      CLAUDE_TOOL_INPUT_COMMAND: 'npm test',
    })
    expect(r.status, describeSpawnResult(r)).toBe(0)
  })

  // Exit 2 is the only blocking code for a PreToolUse hook (#1631) — exit 1 prints
  // stderr but lets the dangerous command run. A safety guard must block via exit 2.
  it('exits 2 and emits stderr for rm -rf /', () => {
    const r = spawnHook(hookPath, dir, {
      CLAUDE_TOOL_INPUT_COMMAND: 'rm -rf /tmp/blah',
    })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/blocked/i)
  })

  it('exits 2 for git push --force', () => {
    const r = spawnHook(hookPath, dir, {
      CLAUDE_TOOL_INPUT_COMMAND: 'git push --force origin main',
    })
    expect(r.status).toBe(2)
  })

  it('blocks a redirect write to gate-pass.json delivered through stdin JSON', () => {
    const command = "echo '{}' > .arbiter/gate-pass.json"
    const r = spawnCommandThroughStdin(hookPath, dir, command)
    expect(r.status, r.stderr).toBe(2)
    expect(r.stderr).toContain('[arbiter]')
    expect(r.stderr).toContain('.arbiter/gate-pass.json')
  })

  it.each([
    ['append redirect', 'echo x >> .arbiter/gate-pass.json', '.arbiter/gate-pass.json'],
    ['copy', 'cp /tmp/fake.json .arbiter/gate-pass.json', '.arbiter/gate-pass.json'],
    ['move', 'mv /tmp/fake.json .arbiter/gate-pass.json', '.arbiter/gate-pass.json'],
    ['tee', 'tee .arbiter/gate-pass.json < /tmp/fake.json', '.arbiter/gate-pass.json'],
    ['sed in-place', "sed -i 's/false/true/' .arbiter/gate-pass.json", '.arbiter/gate-pass.json'],
    ['truncate', 'truncate -s 0 .arbiter/gate-pass.json', '.arbiter/gate-pass.json'],
    [
      'python inline',
      "python3 -c \"open('.arbiter/gate-pass.json','w').write('{}')\"",
      '.arbiter/gate-pass.json',
    ],
    [
      'node inline',
      "node -e \"require('fs').writeFileSync('.arbiter/gate-pass.json','{}')\"",
      '.arbiter/gate-pass.json',
    ],
    ['delete', 'rm .arbiter/gate-pass.json', '.arbiter/gate-pass.json'],
    ['append redirect', 'echo x >> .arbiter/status.json', '.arbiter/status.json'],
    ['copy', 'cp /tmp/fake.json .arbiter/status.json', '.arbiter/status.json'],
    ['move', 'mv /tmp/fake.json .arbiter/status.json', '.arbiter/status.json'],
    ['tee', 'tee .arbiter/status.json < /tmp/fake.json', '.arbiter/status.json'],
    ['sed in-place', "sed -i 's/false/true/' .arbiter/status.json", '.arbiter/status.json'],
    ['truncate', 'truncate -s 0 .arbiter/status.json', '.arbiter/status.json'],
    [
      'python inline',
      "python3 -c \"open('.arbiter/status.json','w').write('{}')\"",
      '.arbiter/status.json',
    ],
    [
      'node inline',
      "node -e \"require('fs').writeFileSync('.arbiter/status.json','{}')\"",
      '.arbiter/status.json',
    ],
    ['delete', 'rm .arbiter/status.json', '.arbiter/status.json'],
    ['append redirect', 'echo x >> .arbiter/evidence/x.json', '.arbiter/evidence/x.json'],
    ['copy', 'cp /tmp/fake.json .arbiter/evidence/x.json', '.arbiter/evidence/x.json'],
    ['move', 'mv /tmp/fake.json .arbiter/evidence/x.json', '.arbiter/evidence/x.json'],
    ['tee', 'tee .arbiter/evidence/x.json < /tmp/fake.json', '.arbiter/evidence/x.json'],
    ['sed in-place', "sed -i 's/false/true/' .arbiter/evidence/x.json", '.arbiter/evidence/x.json'],
    ['truncate', 'truncate -s 0 .arbiter/evidence/x.json', '.arbiter/evidence/x.json'],
    [
      'python inline',
      "python3 -c \"open('.arbiter/evidence/x.json','w').write('{}')\"",
      '.arbiter/evidence/x.json',
    ],
    [
      'node inline',
      "node -e \"require('fs').writeFileSync('.arbiter/evidence/x.json','{}')\"",
      '.arbiter/evidence/x.json',
    ],
    ['delete', 'rm .arbiter/evidence/x.json', '.arbiter/evidence/x.json'],
    ['compound redirect', 'cd foo && echo x > .arbiter/gate-pass.json', '.arbiter/gate-pass.json'],
    ['dot-slash redirect', 'echo x > ./.arbiter/status.json', '.arbiter/status.json'],
    [
      'absolute redirect',
      'echo x > /tmp/project/.arbiter/evidence/x.json',
      '.arbiter/evidence/x.json',
    ],
  ])('blocks protected %s writes', (_kind, command, protectedPath) => {
    const r = spawnCommandThroughStdin(hookPath, dir, command)
    expect(r.status, r.stderr).toBe(2)
    expect(r.stderr).toContain('[arbiter]')
    expect(r.stderr).toContain(protectedPath)
  })

  it.each([
    'git diff .arbiter/status.json && rm /tmp/scratch',
    'cp dist/a dist/b && ls .arbiter/evidence',
    'cp a b && cat .arbiter/status.json',
    'cat .arbiter/gate-pass.json',
    'cat .arbiter/gate-pass.json 2>&1',
    'jq . .arbiter/status.json',
    'jq . .arbiter/status.json 1>/dev/null',
    'ls .arbiter/evidence',
    'git diff .arbiter/status.json',
    'npm test',
    'git status',
  ])('allows read-only or unrelated command: %s', (command) => {
    const r = spawnCommandThroughStdin(hookPath, dir, command)
    expect(r.status, describeSpawnResult(r)).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('keeps the existing dangerous-command message unchanged', () => {
    const command = 'git reset --hard'
    const r = spawnCommandThroughStdin(hookPath, dir, command)
    expect(r.status).toBe(2)
    expect(r.stderr).toBe(`[arbiter] Blocked dangerous command: ${command}\n`)
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

  // Exit 2 feeds the violation back to Claude for a PostToolUse content guard (#1631);
  // exit 1 shows the user only and Claude never sees the leak.
  it('exits 2 when file contains email address pattern', () => {
    const f = join(dir, 'dirty.ts')
    writeFileSync(f, 'const contact = "user@example.com";\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/INV-12|PII/i)
  })
})

// ── stdin-JSON protocol (the actual Claude Code hook contract) ──────────────────
// Regression for the gate-integrity "no-op hook" blocker: Claude Code delivers tool
// input as a JSON object on stdin ({tool_input:{file_path}}). A hook that reads ONLY
// the CLAUDE_TOOL_INPUT_PATH env var saw nothing under this protocol and exited 0,
// silently letting violations through. These tests drive each hook the way Claude Code
// does — stdin JSON, NO env var — and assert it actually blocks. Without the
// resolveToolInputPath() stdin parse, every assertion below would see exit 0.

function spawnHookStdin(hookPath: string, dir: string, filePath: string) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    encoding: 'utf-8',
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } }),
    // Deliberately NO CLAUDE_TOOL_INPUT_PATH — only the stdin payload carries the path.
    env: { ...process.env, CLAUDE_TOOL_INPUT_PATH: '' },
    timeout: 5000,
  })
}

describe('check-no-pii — stdin-JSON protocol (no env var)', () => {
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

  it('exits 2 on a violating file delivered via stdin JSON', () => {
    const f = join(dir, 'dirty.ts')
    writeFileSync(f, 'const contact = "user@example.com";\n')
    const r = spawnHookStdin(hookPath, dir, f)
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/INV-12|PII/i)
  })

  it('exits 0 on a clean file delivered via stdin JSON', () => {
    const f = join(dir, 'clean.ts')
    writeFileSync(f, 'export const x = 1;\n')
    const r = spawnHookStdin(hookPath, dir, f)
    expect(r.status).toBe(0)
  })
})

// ── dispatcher end-to-end (the path generated projects actually run) ─────────────
// Generated projects do NOT wire each hook directly in settings.json — settings.json.ejs
// registers ONE command per event: `node .claude/hooks/hooks.mjs <Event:Matcher>`. The
// dispatcher buffers fd 0 ONCE and re-feeds it to every handler via spawnSync({ input }).
// The prior stdin-JSON tests above drive leaf hooks DIRECTLY, so they never exercise that
// buffer-and-forward step. This regression renders the real dispatcher + lib.mjs + a
// registered handler and pipes a violation through `hooks.mjs PostToolUse:Edit|Write` —
// the exact invocation Claude Code makes in a generated repo. If the dispatcher ever stops
// forwarding stdin (e.g. `input: stdinData` dropped, or the buffer regresses), the handler
// sees an empty path and exits 0, and this test goes red.
describe('hooks.mjs dispatcher — forwards stdin JSON to handlers end-to-end', () => {
  let dir: string
  let hooksDir: string
  let dispatcherPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-hook-fires-'))
    // Generate into the fixture directory so fail-closed dispatcher references all exist.
    generateClaude(
      makeConfig(dir, {
        language: 'typescript',
        projectName: 'hook-fires-test',
        governanceLevel: 'L1',
      }),
    )
    hooksDir = join(dir, '.claude', 'hooks')
    renderEjsHook(hooksDir, 'check-no-pii.mjs.ejs')
    dispatcherPath = join(hooksDir, 'hooks.mjs')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function spawnDispatcher(filePath: string) {
    return spawnSync('node', [dispatcherPath, 'PostToolUse:Edit|Write'], {
      cwd: dir,
      encoding: 'utf-8',
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } }),
      // No env var — only the stdin payload carries the path, exactly like Claude Code.
      env: { ...process.env, CLAUDE_TOOL_INPUT_PATH: '' },
      timeout: 10000,
    })
  }

  it('aborts the chain with non-zero exit when a handler blocks a violation', () => {
    const f = join(dir, 'dirty.ts')
    writeFileSync(f, '// ' + 'TODO: missing task id\n')
    const r = spawnDispatcher(f)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/INV-21|orphan/i)
  })

  it('exits 0 through the dispatcher for a clean file', () => {
    const f = join(dir, 'clean.ts')
    writeFileSync(f, 'export const x = 1;\n')
    const r = spawnDispatcher(f)
    expect(r.status, describeSpawnResult(r)).toBe(0)
  })
})

describe('check-no-placeholders — stdin-JSON protocol (no env var)', () => {
  let dir: string
  let hookPath: string

  beforeEach(() => {
    const setup = makeHookDir()
    dir = setup.dir
    hookPath = renderEjsHook(setup.hooksDir, 'check-no-placeholders.mjs.ejs')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 2 on a placeholder-laden file delivered via stdin JSON', () => {
    const f = join(dir, 'wip.ts')
    // Concatenate to avoid this very hook firing on the test source.
    writeFileSync(f, '// FIX' + 'ME: finish this\n')
    const r = spawnHookStdin(hookPath, dir, f)
    expect(r.status).toBe(2)
  })

  it('fails closed when an applicable source path cannot be read', () => {
    const unreadable = join(dir, 'unreadable.ts')
    mkdirSync(unreadable)
    expect(spawnHookStdin(hookPath, dir, unreadable).status).toBe(2)
  })
})

describe('check-no-orphan-todo — empirical fire', () => {
  let dir: string
  let hookPath: string

  beforeEach(() => {
    const setup = makeHookDir()
    dir = setup.dir
    hookPath = renderEjsHook(setup.hooksDir, 'check-no-orphan-todo.mjs.ejs')
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

  it('exits 2 for bare TODO without task ID', () => {
    const f = join(dir, 'bad.ts')
    // Write literal content to temp file — no hook fires on test source
    writeFileSync(f, '// TO' + 'DO: needs fixing\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/INV-21|orphan/i)
  })

  it('fails closed when an applicable source path cannot be read', () => {
    const unreadable = join(dir, 'unreadable.ts')
    mkdirSync(unreadable)
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: unreadable })
    expect(r.status).toBe(2)
  })
})

describe('enforce-read-only — empirical fire', () => {
  let dir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hookPath } = makeRawHook('enforce-read-only.mjs'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 for non-protected file', () => {
    const r = spawnHook(hookPath, dir, {
      CLAUDE_TOOL_INPUT_PATH: 'src/foo.ts',
    })
    expect(r.status).toBe(0)
  })

  // A protected-file match must BLOCK via exit 2 (#1631); exit 1 let the edit proceed —
  // the guard blocked nothing and was additionally inverted vs the fail-closed path.
  it('exits 2 when AGENTS.md is targeted', () => {
    const r = spawnHook(hookPath, dir, {
      CLAUDE_TOOL_INPUT_PATH: '/project/AGENTS.md',
    })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/read-only/i)
  })

  it('exits 2 when package-lock.json is targeted', () => {
    const r = spawnHook(hookPath, dir, {
      CLAUDE_TOOL_INPUT_PATH: 'package-lock.json',
    })
    expect(r.status).toBe(2)
  })

  // INV-96 (#1537): an unresolvable path must BLOCK (exit 2), not fall through to allow.
  it('exits 2 (fail-closed) when the edit path is unresolvable/empty', () => {
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: '' }, '')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/fail-closed|unresolvable/i)
  })
})

// ── Bash command hooks — stdin-JSON protocol (no env var) ───────────────────────
// Regression for #1565: under the real Claude Code hook protocol the Bash tool payload
// arrives as JSON on stdin ({ tool_input: { command } }) and NOTHING sets the
// CLAUDE_TOOL_INPUT_COMMAND env var (only the Codex adapter does). A command hook that
// reads ONLY process.env.CLAUDE_TOOL_INPUT_COMMAND sees '' and silently no-ops. These
// tests drive each command hook the way Claude Code does — stdin JSON, NO env var — and
// assert it actually fires. Without resolveToolInputCommand()'s stdin parse, every
// assertion below regresses to the (broken) no-op exit 0.

function spawnCommandHookStdin(hookPath: string, dir: string, command: string) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    encoding: 'utf-8',
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    // Deliberately NO CLAUDE_TOOL_INPUT_COMMAND — only the stdin payload carries the command.
    env: { ...process.env, CLAUDE_TOOL_INPUT_COMMAND: '' },
    timeout: 5000,
  })
}

describe('stop-dangerous (raw hook) — stdin-JSON protocol (no env var)', () => {
  let dir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hookPath } = makeRawHook('stop-dangerous.mjs'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 2 for rm -rf / delivered via stdin JSON', () => {
    const r = spawnCommandHookStdin(hookPath, dir, 'rm -rf /')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/blocked/i)
  })

  it('exits 2 for git push --force delivered via stdin JSON', () => {
    const r = spawnCommandHookStdin(hookPath, dir, 'git push --force origin main')
    expect(r.status).toBe(2)
  })

  it('exits 0 for a benign command delivered via stdin JSON', () => {
    const r = spawnCommandHookStdin(hookPath, dir, 'npm test')
    expect(r.status).toBe(0)
  })
})

describe('enforce-gate-before-pr (raw hook) — stdin-JSON protocol (no env var)', () => {
  let dir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hookPath } = makeRawHook('enforce-gate-before-pr.mjs'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 2 (blocks) for gh pr create with no gate-pass marker via stdin JSON', () => {
    const r = spawnCommandHookStdin(hookPath, dir, 'gh pr create --fill')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/GATE GUARD/)
  })

  it('exits 0 for a non-pr command via stdin JSON', () => {
    const r = spawnCommandHookStdin(hookPath, dir, 'git status')
    expect(r.status).toBe(0)
  })
})

describe('post-commit-check — stdin-JSON protocol (no env var)', () => {
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

  it('exits 2 on a non-conventional commit message delivered via stdin JSON', () => {
    spawnSync('git', ['init'], { cwd: dir, encoding: 'utf-8' })
    spawnSync('git', ['config', 'user.email', 'test@arbiter.test'], { cwd: dir, encoding: 'utf-8' })
    spawnSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir, encoding: 'utf-8' })
    spawnSync('git', ['commit', '--allow-empty', '-m', 'bad commit message'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    const r = spawnCommandHookStdin(hookPath, dir, 'git commit -m "bad commit message"')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/INV-22/)
  })

  it('exits 0 when the stdin command is not a git commit', () => {
    const r = spawnCommandHookStdin(hookPath, dir, 'npm test')
    expect(r.status).toBe(0)
  })
})

describe('wiki-on-commit — stdin-JSON protocol (no env var)', () => {
  let dir: string
  let hooksDir: string
  let hookPath: string

  function gitCommit(message: string, addPath?: string) {
    if (addPath) spawnSync('git', ['add', addPath], { cwd: dir, encoding: 'utf-8' })
    spawnSync('git', ['commit', '--allow-empty', '-m', message], { cwd: dir, encoding: 'utf-8' })
  }

  beforeEach(() => {
    ;({ dir, hooksDir } = makeHookDir())
    hookPath = renderEjsHook(hooksDir, 'wiki-on-commit.mjs.ejs')
    spawnSync('git', ['init'], { cwd: dir, encoding: 'utf-8' })
    spawnSync('git', ['config', 'user.email', 'test@arbiter.test'], { cwd: dir, encoding: 'utf-8' })
    spawnSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir, encoding: 'utf-8' })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('recognizes a git commit via stdin JSON and runs gen-wiki (exit 1 when script is absent)', () => {
    // Two commits; the last touches docs/*.md, and wiki/ exists but scripts/gen-wiki.mjs
    // does NOT — so once the command is recognized the hook reaches gen-wiki and fails.
    // Before #1565 the empty command short-circuited to exit 0 and never got here.
    gitCommit('feat: init')
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'foo.md'), '# foo\n')
    gitCommit('docs: add foo', 'docs/foo.md')
    mkdirSync(join(dir, 'wiki'), { recursive: true })
    const r = spawnCommandHookStdin(hookPath, dir, 'git commit -m "docs: add foo"')
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/wiki-on-commit/)
  })

  it('exits 0 when the stdin command is not a git commit', () => {
    const r = spawnCommandHookStdin(hookPath, dir, 'ls -la')
    expect(r.status).toBe(0)
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

  it('exits 2 on non-conventional commit message (INV-22)', () => {
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
    expect(r.status).toBe(2)
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
    const r = spawnHook(
      hookPath,
      dir,
      {},
      JSON.stringify({ session_id: 'hook-fires-plan', prompt: 'go' }),
    )
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
  let dir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hookPath } = makeRawHook('check-no-skipped-tests.mjs'))
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

  // PostToolUse content guard must block via exit 2 so Claude sees the violation (#1631).
  it('exits 2 for it.skip( in a .ts file', () => {
    const f = join(dir, 'foo.test.ts')
    writeFileSync(f, "it.skip('broken', () => {})\n")
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/NI-11/)
  })

  it('exits 2 for xit( in a .ts file', () => {
    const f = join(dir, 'foo.test.ts')
    writeFileSync(f, "xit('old', () => {})\n")
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(2)
  })

  it('exits 2 for @Disabled in a .java file', () => {
    const f = join(dir, 'FooTest.java')
    writeFileSync(f, '@Disabled\n@Test\npublic void testFoo() {}\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/NI-11/)
  })

  it('exits 0 for @Disabled in a .ts file (not Java)', () => {
    const f = join(dir, 'foo.ts')
    writeFileSync(f, '// @Disabled\nconst x = 1\n')
    const r = spawnHook(hookPath, dir, { CLAUDE_TOOL_INPUT_PATH: f })
    expect(r.status).toBe(0)
  })
})
