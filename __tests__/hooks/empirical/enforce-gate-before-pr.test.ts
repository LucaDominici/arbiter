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
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
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
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
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
    expect(result.stderr).toContain('draft PR')
    expect(result.stderr).toContain('ci-receipt.mjs')
  })

  it('exits 2 when marker head_sha does not match current HEAD', () => {
    const dir = track(setupGitRepo())
    writeMarker(dir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: test"' }, dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('stale')
    expect(result.stderr).toContain('draft PR')
    expect(result.stderr).toContain('ci-receipt.mjs')
  })

  it('exits 0 when marker head_sha matches current HEAD', () => {
    const dir = track(setupGitRepo())
    const sha = currentHead(dir)
    writeMarker(dir, sha)
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: test"' }, dir)
    expect(result.status).toBe(0)
  })

  it('exits 0 when ci-pass.json matches current HEAD', () => {
    const dir = track(setupGitRepo())
    const arbiterDir = join(dir, '.arbiter')
    mkdirSync(arbiterDir, { recursive: true })
    writeFileSync(
      join(arbiterDir, 'ci-pass.json'),
      JSON.stringify({
        sha: currentHead(dir),
        conclusion: 'success',
        runUrl: 'https://github.com/example/repo/actions/runs/1',
        checkedAt: new Date().toISOString(),
      }),
    )
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: test"' }, dir)
    expect(result.status).toBe(0)
  })

  it('allows a draft PR without either receipt and prints the advisory', () => {
    const dir = track(setupGitRepo())
    const result = runHook(
      { CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --draft --title "feat: test"' },
      dir,
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('DRAFT')
  })

  it('treats a quoted standalone draft flag as the same argv flag', () => {
    const dir = track(setupGitRepo())
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create "--draft" --fill' }, dir)
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('DRAFT')
  })

  it('uses the final explicit draft value when it is true', () => {
    const dir = track(setupGitRepo())
    const result = runHook(
      { CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --draft=false --draft --fill' },
      dir,
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('DRAFT')
  })

  it.each([
    ['false-valued draft flag', 'gh pr create --draft=false --fill'],
    ['final false-valued draft flag', 'gh pr create --draft --draft=false --fill'],
    ['draft text inside an argument', 'gh pr create --body "a --draft description" --fill'],
    ['draft flag as an option value', 'gh pr create --body "--draft" --fill'],
    ['draft consumed as a body value', 'gh pr create --body --draft --fill'],
    ['wrapped ready command', 'gh pr create --draft && (gh pr ready)'],
    ['command-substituted ready command', 'gh pr create --draft && $(gh pr ready)'],
  ])('does not exempt %s', (_label, command) => {
    const dir = track(setupGitRepo())
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: command }, dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('ci-pass.json')
  })

  it('blocks gh pr ready without either receipt', () => {
    const dir = track(setupGitRepo())
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'gh pr ready 1' }, dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('ci-pass.json')
  })

  it.each([
    ['stale gate marker', 'gate-pass.json', 'stale'],
    ['malformed gate marker', 'gate-pass.json', '{ invalid json }'],
    ['stale CI receipt', 'ci-pass.json', JSON.stringify({ sha: 'stale' })],
    ['malformed CI receipt', 'ci-pass.json', '{ invalid json }'],
  ])('allows draft creation before parsing a %s', (_label, path, contents) => {
    const dir = track(setupGitRepo())
    const arbiterDir = join(dir, '.arbiter')
    mkdirSync(arbiterDir, { recursive: true })
    if (contents === 'stale') writeMarker(dir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    else writeFileSync(join(arbiterDir, path), contents)
    const result = runHook(
      { CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: overlap" --draft' },
      dir,
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('DRAFT')
  })

  it('does not let draft creation exempt a chained gh pr ready', () => {
    const dir = track(setupGitRepo())
    const result = runHook(
      {
        CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --draft --title "feat: overlap" && gh pr ready',
      },
      dir,
    )
    expect(result.status).toBe(2)
  })

  it.each([
    [
      'stale',
      'ordinary create',
      JSON.stringify({ sha: 'stale' }),
      'gh pr create --title "feat: strict"',
    ],
    ['malformed', 'ordinary create', '{ invalid json }', 'gh pr create --title "feat: strict"'],
    ['stale', 'ready', JSON.stringify({ sha: 'stale' }), 'gh pr ready'],
    ['malformed', 'ready', '{ invalid json }', 'gh pr ready'],
  ])('keeps %s CI receipts fail-closed for %s', (_state, _operation, receipt, command) => {
    const dir = track(setupGitRepo())
    const arbiterDir = join(dir, '.arbiter')
    mkdirSync(arbiterDir, { recursive: true })
    writeFileSync(join(arbiterDir, 'ci-pass.json'), receipt)
    expect(runHook({ CLAUDE_TOOL_INPUT_COMMAND: command }, dir).status).toBe(2)
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
