import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runInit } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import { runDiff } from '../../src/commands/diff.js'
import { loadConfig } from '../../src/utils/config.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-update-test-'))
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Test'], {
    cwd: dir,
    stdio: 'ignore',
  })
}

describe('arbiter update', () => {
  let dir: string

  beforeEach(async () => {
    dir = tmpDir()
    initGit(dir)
    await runInit({
      yes: true,
      tools: 'claude,codex',
      level: 'L2',
      dir,
      noVerify: true,
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('saves arbiter.json during init', () => {
    const config = loadConfig(dir)
    expect(config).not.toBeNull()
    expect(config!.tools).toEqual(['claude', 'codex'])
    expect(config!.governanceLevel).toBe('L2')
  })

  it('update leaves AGENTS.md byte-identical and writes no backup (#1077 idempotence)', async () => {
    const agentsPath = join(dir, 'AGENTS.md')
    const before = readFileSync(agentsPath, 'utf-8')

    await runUpdate({ dir, github: false })

    const after = readFileSync(agentsPath, 'utf-8')
    // Content unchanged because config is unchanged.
    expect(after).toBe(before)
    // #1077: writeFile now skips byte-identical content, so an idempotent update
    // does NOT back up or rewrite AGENTS.md. (Previously this created a churned
    // .arbiter-backup on every run — the F6 non-idempotence bug.)
    expect(existsSync(agentsPath + '.arbiter-backup')).toBe(false)
  })

  it('update DOES back up AGENTS.md when its content actually changed (#1077)', async () => {
    const agentsPath = join(dir, 'AGENTS.md')
    // Simulate user edit so the regenerated content differs from disk.
    writeFileSync(agentsPath, 'user-edited AGENTS.md\n', 'utf-8')

    await runUpdate({ dir, github: false })

    // Now content differs → backup is written, file replaced.
    expect(existsSync(agentsPath + '.arbiter-backup')).toBe(true)
    expect(readFileSync(agentsPath + '.arbiter-backup', 'utf-8')).toBe('user-edited AGENTS.md\n')
  })

  // T1 (convergence playbook, anti-erosion): `.claude/hooks/*.mjs` are safety-
  // class — they now ADOPT by default instead of freezing a customization
  // forever (the exact erosion case this tranche exists to kill). See the
  // full red-path coverage in `__tests__/integration/update-adopt.test.ts`.
  // This supersedes the old "update preserves existing hooks" expectation.
  it('update ADOPTS a customized safety-class hook by default (T1 anti-erosion)', async () => {
    const hookPath = join(dir, '.claude', 'hooks', 'stop-dangerous.mjs')
    const original = readFileSync(hookPath, 'utf-8')

    // Modify the hook to simulate customization
    writeFileSync(hookPath, original + '\n# Custom modification', 'utf-8')

    await runUpdate({ dir, github: false })

    const after = readFileSync(hookPath, 'utf-8')
    expect(after).not.toContain('# Custom modification')
    expect(after).toBe(original)
  })

  it('update preserves an existing customization on a NON-safety-class skipIfExists file', async () => {
    const filePath = join(dir, 'scripts', 'check-collab-mode-wired.mjs')
    const original = readFileSync(filePath, 'utf-8')

    writeFileSync(filePath, original + '\n// Custom modification', 'utf-8')

    await runUpdate({ dir, github: false })

    const after = readFileSync(filePath, 'utf-8')
    expect(after).toContain('// Custom modification')
  })

  // #2056: a selective regen driven by a config change that maps (via
  // src/config/diff.ts PATH_TO_KEYS) to generators OTHER than agents-md/claude
  // must STILL refresh the governance sections those two own — Iron Laws in
  // AGENTS.md and the ARBITER_* deny list in .claude/settings.json — otherwise a
  // routine `arbiter update` (e.g. toggling securityScanning) leaves stale
  // governance content in place, the root cause behind the downstream-consumer
  // staleness #2040 was filed for.
  it('selective regen for an unrelated config change still refreshes AGENTS.md Iron Laws + settings.json deny-list (#2056)', async () => {
    const agentsPath = join(dir, 'AGENTS.md')
    const settingsPath = join(dir, '.claude', 'settings.json')
    const IRON_LAW = 'Worktree Isolation Is Mandatory For Parallel Agents'
    const DENY_ENTRY = 'ARBITER_GATE_BYPASS'

    // Prime once so a config snapshot exists — otherwise the first `arbiter
    // update` has no snapshot and always full-regens (which trivially includes
    // agents-md/claude). The selective-regen path this test targets only runs
    // when a snapshot is present to diff against.
    await runUpdate({ dir, github: false })

    // Sanity: a freshly-initialized project carries both governance sections.
    expect(readFileSync(agentsPath, 'utf-8')).toContain(IRON_LAW)
    expect(readFileSync(settingsPath, 'utf-8')).toContain(DENY_ENTRY)

    // Simulate governance sections that predate a template update (stale on disk).
    writeFileSync(
      agentsPath,
      readFileSync(agentsPath, 'utf-8').replace(IRON_LAW, 'STALE PLACEHOLDER'),
      'utf-8',
    )
    writeFileSync(
      settingsPath,
      readFileSync(settingsPath, 'utf-8').replace(DENY_ENTRY, 'STALE_PLACEHOLDER'),
      'utf-8',
    )

    // Change an UNRELATED config field whose PATH_TO_KEYS mapping does NOT include
    // agents-md/claude (features.securityScanning → ['security']) → selective regen.
    const configPath = join(dir, 'arbiter.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      features: Record<string, boolean>
    }
    config.features.securityScanning = !config.features.securityScanning
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

    await runUpdate({ dir, github: false })

    // Both governance artifacts refreshed despite the diff mapping only to `security`.
    expect(readFileSync(agentsPath, 'utf-8')).toContain(IRON_LAW)
    expect(readFileSync(settingsPath, 'utf-8')).toContain(DENY_ENTRY)
  })

  it('update regenerates experimental tool files when present in config (cursor/copilot)', async () => {
    // ADR-095: cursor/copilot are experimental — no longer init-able via the
    // CLI (`parseTools` rejects them) — but their generators are RETAINED. A
    // config that already lists them (legacy or internal) must still be
    // regenerated by `update`. Seed the tools via arbiter.json, not the CLI.
    const configPath = join(dir, 'arbiter.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { tools: string[] }
    config.tools = ['claude', 'codex', 'cursor', 'copilot']
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

    await runUpdate({ dir, github: false })

    expect(existsSync(join(dir, '.cursorrules'))).toBe(true)
    expect(existsSync(join(dir, '.github', 'copilot-instructions.md'))).toBe(true)
  })
})

describe('arbiter diff', () => {
  let dir: string

  beforeEach(async () => {
    dir = tmpDir()
    initGit(dir)
    await runInit({
      yes: true,
      tools: 'claude,codex',
      level: 'L2',
      dir,
      noVerify: true,
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('shows = for unchanged files', () => {
    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(' '))

    try {
      runDiff({ dir })
    } finally {
      console.log = originalLog
    }

    const unchangedLines = output.filter((l) => l.includes('(unchanged)'))
    expect(unchangedLines.length).toBeGreaterThan(0)
  })

  it('shows ~ when content differs', () => {
    // Modify AGENTS.md to create a diff
    const agentsPath = join(dir, 'AGENTS.md')
    writeFileSync(agentsPath, 'Modified content\n', 'utf-8')

    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(' '))

    try {
      runDiff({ dir })
    } finally {
      console.log = originalLog
    }

    const updateLines = output.filter((l) => l.includes('(would update)'))
    expect(updateLines.length).toBeGreaterThan(0)
  })

  it('exits with error when no arbiter.json', () => {
    const freshDir = tmpDir()
    initGit(freshDir)

    const originalExit = process.exit
    let exitCode: number | undefined
    process.exit = ((code: number) => {
      exitCode = code
      throw new Error('exit')
    }) as never

    try {
      runDiff({ dir: freshDir })
    } catch {
      // Expected — our mock throws to halt execution
    } finally {
      process.exit = originalExit
      rmSync(freshDir, { recursive: true, force: true })
    }

    // Canonical convention: missing config is an error (blocker) → exit 2.
    expect(exitCode).toBe(2)
  })
})

describe('ai-rulez detection', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('skips tool-specific configs when .ai-rulez/ exists', async () => {
    // Create .ai-rulez directory before init
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(dir, '.ai-rulez'), { recursive: true })

    await runInit({
      yes: true,
      tools: 'claude,codex',
      level: 'L2',
      dir,
      noVerify: true,
    })

    // AGENTS.md should still be generated
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)

    // Tool-specific configs should NOT be generated
    expect(existsSync(join(dir, '.claude', 'CLAUDE.md'))).toBe(false)
    expect(existsSync(join(dir, '.agents', 'CODEX.md'))).toBe(false)
  })
})

// #2120: `diff` must not disagree with `update` about the adopt classes. Both
// commands resolve the SAME prospective action (that is the #1077 F1/F7
// contract), but `diff` opened its generation session without an adopt
// predicate — so a hand-edited file that `update` force-adopts was reported as
// a preserved "withheld template fix" with a reconcile hint, when the very next
// `update` would overwrite it. The provenance test (#2120) widened that lie
// from the safety/gate-spine classes to `AGENTS.md` and `.claude/settings.json`
// too, which `diff` used to report truthfully as `changed`.
describe('#2120: diff and update agree on the adopt classes', () => {
  let dir: string

  beforeEach(async () => {
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function diffJson(): { files: { key: string; status: string }[] } {
    const writes: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((s: unknown): boolean => {
      writes.push(String(s))
      return true
    }) as typeof process.stdout.write
    // runDiff exits 1 whenever there is anything to act on — expected here.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    try {
      runDiff({ dir, json: true })
    } finally {
      process.stdout.write = origWrite
      exitSpy.mockRestore()
    }
    return (JSON.parse(writes.join('')) as { data: { files: { key: string; status: string }[] } })
      .data
  }

  it.each([
    ['AGENTS.md', 'governance class (#2056 force-render)'],
    ['.claude/hooks/stop-dangerous.mjs', 'safety class'],
  ])('reports %s as changed, not withheld — update adopts it (%s)', async (target) => {
    writeFileSync(join(dir, target), '// hand-edited\n')

    const entry = diffJson().files.find((f) => f.key === target)
    expect(entry?.status).toBe('changed')

    // …and the claim is true: the very next update does overwrite it.
    await runUpdate({ dir, github: false })
    expect(readFileSync(join(dir, target), 'utf-8')).not.toBe('// hand-edited\n')
  })

  // #2119 put the gate spine on this side of the line: `diff` must call it
  // withheld, because a bare `update` no longer writes it.
  it.each([
    ['scripts/check-collab-mode-wired.mjs', 'leaf check — no adopt policy covers it'],
    ['scripts/check-all.mjs', 'gate spine — opt-in only since #2119'],
  ])('reports %s as withheld, and update leaves it alone (%s)', async (target) => {
    writeFileSync(join(dir, target), '// hand-edited\n')

    expect(diffJson().files.find((f) => f.key === target)?.status).toBe('withheld')

    await runUpdate({ dir, github: false })
    expect(readFileSync(join(dir, target), 'utf-8')).toBe('// hand-edited\n')
  })
})
