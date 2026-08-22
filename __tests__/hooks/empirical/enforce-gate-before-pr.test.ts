import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, materializeGateEvidenceLib, writeGatePassEvidence } from '../../helpers.js'

const RAW_HOOK_PATH = resolve(
  import.meta.dirname,
  '../../../src/templates/claude/hooks/enforce-gate-before-pr.mjs',
)

// The hook imports ./lib.mjs (resolveToolInputCommand, #1565). Materialize the raw hook
// alongside a rendered lib.mjs in each repo's .claude/hooks/ so the import resolves —
// spawning straight from src/templates/ would fail (only lib.mjs.ejs lives there).
function materializeHook(dir: string): string {
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  const cfg = makeConfig(dir, { language: 'typescript', projectName: 'gate-pr-test' })
  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', cfg))
  const hookPath = join(hooksDir, 'enforce-gate-before-pr.mjs')
  writeFileSync(hookPath, readFileSync(RAW_HOOK_PATH, 'utf-8'))
  // #2328: the hook verifies the marker through scripts/lib/gate-evidence.mjs,
  // co-emitted into every project by generateCheckAll.
  materializeGateEvidenceLib(dir)
  return hookPath
}

function runHook(env: NodeJS.ProcessEnv, dir: string): ReturnType<typeof spawnSync> {
  return spawnSync('node', [join(dir, '.claude', 'hooks', 'enforce-gate-before-pr.mjs')], {
    env: { ...process.env, ...env },
    cwd: dir,
    encoding: 'utf-8',
  })
}

function setupGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-gate-pr-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
  materializeHook(dir)
  return dir
}

function currentHead(dir: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim()
}

function writeMarker(dir: string, headSha: string): void {
  // #2328: a real schema-v2 marker for this checkout, with only head_sha planted.
  writeGatePassEvidence(dir, { taskId: 'unknown', overrides: { head_sha: headSha } })
}

const dirs: string[] = []
function track(dir: string): string {
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('enforce-gate-before-pr hook', () => {
  it('exits 0 for non-gh-pr-create commands', () => {
    const dir = track(setupGitRepo())
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'git push origin HEAD' }, dir)
    expect(result.status).toBe(0)
  })

  it('exits 0 for commands that mention gh but not pr create', () => {
    const dir = track(setupGitRepo())
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'gh pr list' }, dir)
    expect(result.status).toBe(0)
  })

  it('exits 2 when gate-pass.json is missing', () => {
    const dir = track(setupGitRepo())
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: test"' }, dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('gate-pass.json')
    expect(result.stderr).toContain('check-all.mjs')
  })

  it('exits 2 when marker head_sha does not match current HEAD', () => {
    const dir = track(setupGitRepo())
    writeMarker(dir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: test"' }, dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('stale')
    expect(result.stderr).toContain('check-all.mjs')
  })

  it('exits 0 when marker head_sha matches current HEAD', () => {
    const dir = track(setupGitRepo())
    const sha = currentHead(dir)
    writeMarker(dir, sha)
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: test"' }, dir)
    expect(result.status).toBe(0)
  })

  it('exits 0 and logs bypass when ARBITER_SKIP_GATE_MARKER=1', () => {
    const dir = track(setupGitRepo())
    // No marker written — would normally exit 2
    const result = runHook(
      {
        CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: test"',
        ARBITER_SKIP_GATE_MARKER: '1',
      },
      dir,
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('ARBITER_SKIP_GATE_MARKER')
  })

  it('exits 2 when gate-pass.json is malformed JSON', () => {
    const dir = track(setupGitRepo())
    const arbiterDir = join(dir, '.arbiter')
    mkdirSync(arbiterDir, { recursive: true })
    writeFileSync(join(arbiterDir, 'gate-pass.json'), '{ invalid json }')
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: test"' }, dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('invalid')
  })

  it('exits 0 for gh pr create with flags in various positions', () => {
    const dir = track(setupGitRepo())
    const sha = currentHead(dir)
    writeMarker(dir, sha)
    const result = runHook(
      {
        CLAUDE_TOOL_INPUT_COMMAND:
          'gh pr create --title "feat: something" --body "Fixes #123" --base main',
      },
      dir,
    )
    expect(result.status).toBe(0)
  })
})
