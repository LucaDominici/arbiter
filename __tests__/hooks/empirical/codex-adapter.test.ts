import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig } from '../../helpers.js'

const ADAPTER = join(process.cwd(), 'src/templates/codex/codex-adapter.mjs')

const TPL_DIR = join(process.cwd(), 'src/templates/claude/hooks')

// Hooks that import ./lib.mjs (resolveToolInputPath) must be spawned from a directory where
// lib.mjs is a sibling. Materialize the hooks-under-test + rendered lib.mjs into one temp dir.
let HOOKS_DIR = ''
let ORPHAN_TODO_HOOK = ''
let SSOT_GUARD_HOOK = ''
// stop-dangerous.mjs now imports ./lib.mjs (resolveToolInputCommand, #1565), so it too must be
// materialized alongside a rendered lib.mjs — spawning from src/templates/ would fail to resolve it.
let STOP_DANGEROUS_HOOK = ''

beforeAll(() => {
  HOOKS_DIR = mkdtempSync(join(tmpdir(), 'arbiter-codex-hooks-'))
  mkdirSync(HOOKS_DIR, { recursive: true })
  writeFileSync(
    join(HOOKS_DIR, 'lib.mjs'),
    renderTemplate(
      'claude/hooks/lib.mjs.ejs',
      makeConfig(process.cwd(), { projectName: 'arbiter' }),
    ),
  )
  for (const name of [
    'check-no-orphan-todo.mjs',
    'pre-edit-ssot-guard.mjs',
    'stop-dangerous.mjs',
  ]) {
    const content =
      name === 'check-no-orphan-todo.mjs'
        ? renderTemplate(
            'claude/hooks/check-no-orphan-todo.mjs.ejs',
            makeConfig(process.cwd(), { projectName: 'arbiter', language: 'typescript' }),
          )
        : readFileSync(join(TPL_DIR, name), 'utf-8')
    writeFileSync(join(HOOKS_DIR, name), content)
  }
  ORPHAN_TODO_HOOK = join(HOOKS_DIR, 'check-no-orphan-todo.mjs')
  SSOT_GUARD_HOOK = join(HOOKS_DIR, 'pre-edit-ssot-guard.mjs')
  STOP_DANGEROUS_HOOK = join(HOOKS_DIR, 'stop-dangerous.mjs')
})

function runAdapter(stdinPayload: object, hookPath: string, extraEnv: Record<string, string> = {}) {
  const baseEnv = { ...process.env }
  delete baseEnv['ARBITER_SSOT_BYPASS']
  return spawnSync('node', [ADAPTER, hookPath], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf-8',
    env: { ...baseEnv, ...extraEnv },
  })
}

function makeApplyPatchPayload(patchCommand: string) {
  return {
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: patchCommand },
    cwd: process.cwd(),
    session_id: 'test-session',
  }
}

function makeBashPayload(command: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'bash',
    tool_input: { command },
    cwd: process.cwd(),
    session_id: 'test-session',
  }
}

describe('codex-adapter', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-adapter-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ── apply_patch → file-path extraction ───────────────────────────────────

  it('extracts path from apply_patch diff and sets CLAUDE_TOOL_INPUT_PATH for hook', () => {
    const file = join(dir, 'test.ts')
    // Construct fixture content without literal bare TODO to avoid triggering the hook on this source file
    writeFileSync(file, `// ${'TODO'}: bare todo without task id\n`)

    const patch = `*** Begin Patch\n*** Update File: ${file}\n@@\n-old line\n+new line\n*** End Patch`

    const result = runAdapter(makeApplyPatchPayload(patch), ORPHAN_TODO_HOOK)
    // Hook fires and finds orphan TODO — blocks via exit 2 (#1631)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('INV-21')
  })

  it('exits 0 when apply_patch file has no orphan TODO', () => {
    const file = join(dir, 'clean.ts')
    writeFileSync(file, 'const x = 1;\n')

    const patch = `*** Begin Patch\n*** Update File: ${file}\n@@\n-const x = 1;\n+const x = 2;\n*** End Patch`

    const result = runAdapter(makeApplyPatchPayload(patch), ORPHAN_TODO_HOOK)
    expect(result.status).toBe(0)
  })

  it('exits 0 when apply_patch patch has no file path', () => {
    const payload = makeApplyPatchPayload('malformed patch with no file path')
    const result = runAdapter(payload, ORPHAN_TODO_HOOK)
    expect(result.status).toBe(0)
  })

  // ── bash → command extraction ─────────────────────────────────────────────

  it('sets CLAUDE_TOOL_INPUT_COMMAND for bash tool and delegates to hook', () => {
    const payload = makeBashPayload('rm -rf /')
    const result = runAdapter(payload, STOP_DANGEROUS_HOOK)
    // stop-dangerous blocks rm -rf / — exit 2 (#1631)
    expect(result.status).toBe(2)
  })

  it('exits 0 for bash tool with safe command', () => {
    const payload = makeBashPayload('echo hello')
    const result = runAdapter(payload, STOP_DANGEROUS_HOOK)
    expect(result.status).toBe(0)
  })

  // ── stdin parsing edge cases ──────────────────────────────────────────────

  it('exits 0 gracefully when stdin is empty', () => {
    const result = spawnSync('node', [ADAPTER, ORPHAN_TODO_HOOK], {
      input: '',
      encoding: 'utf-8',
      env: { ...process.env },
    })
    expect(result.status).toBe(0)
  })

  it('exits 0 gracefully when stdin is not JSON', () => {
    const result = spawnSync('node', [ADAPTER, ORPHAN_TODO_HOOK], {
      input: 'not-json',
      encoding: 'utf-8',
      env: { ...process.env },
    })
    expect(result.status).toBe(0)
  })

  it('exits 0 for unknown tool_name', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'unknown_tool',
      tool_input: {},
      cwd: process.cwd(),
      session_id: 'test-session',
    }
    const result = runAdapter(payload, ORPHAN_TODO_HOOK)
    expect(result.status).toBe(0)
  })

  // ── multi-file patches ────────────────────────────────────────────────────

  it('runs hook for each file in a multi-file apply_patch', () => {
    const file1 = join(dir, 'a.ts')
    const file2 = join(dir, 'b.ts')
    writeFileSync(file1, `// ${'TODO'}: orphan\n`)
    writeFileSync(file2, 'const ok = true;\n')

    const patch = `*** Begin Patch\n*** Update File: ${file1}\n@@\n-old\n+new\n*** Update File: ${file2}\n@@\n-old\n+new\n*** End Patch`

    const result = runAdapter(makeApplyPatchPayload(patch), ORPHAN_TODO_HOOK)
    // file1 has orphan TODO — should block via exit 2 (#1631)
    expect(result.status).toBe(2)
  })

  it('detects violation in second file when first file is clean', () => {
    const file1 = join(dir, 'clean.ts')
    const file2 = join(dir, 'dirty.ts')
    writeFileSync(file1, 'const x = 1;\n')
    writeFileSync(file2, `// ${'TODO'}: orphan in second file\n`)

    const patch = `*** Begin Patch\n*** Update File: ${file1}\n@@\n-old\n+new\n*** Update File: ${file2}\n@@\n-old\n+new\n*** End Patch`

    const result = runAdapter(makeApplyPatchPayload(patch), ORPHAN_TODO_HOOK)
    // file2 has orphan TODO — loop must iterate past index 0
    expect(result.status).toBe(2)
  })

  it('captures Move to rename target for hook checks', () => {
    // Rename patch where destination is an SSOT file — guard must fire
    const patch = `*** Begin Patch\n*** Update File: src/foo.ts\n*** Move to: AGENTS.md\n@@\n-old\n+new\n*** End Patch`
    const result = runAdapter(makeApplyPatchPayload(patch), SSOT_GUARD_HOOK)
    // SSOT guard should exit 2 because AGENTS.md is the rename destination
    expect(result.status).toBe(2)
  })

  it('handles Add File directive', () => {
    const file = join(dir, 'new-file.ts')
    writeFileSync(file, `// ${'TODO'}: orphan in new file\n`)
    const patch = `*** Begin Patch\n*** Add File: ${file}\n+new content\n*** End Patch`
    const result = runAdapter(makeApplyPatchPayload(patch), ORPHAN_TODO_HOOK)
    expect(result.status).toBe(2)
  })
})

// ── #2385: Claude-shaped stdin payload + widened bridge ──────────────────────

/** Writes a hook that dumps its stdin payload + the legacy env vars to `outFile`. */
function writeProbeHook(dir: string, outFile: string): string {
  const hook = join(dir, 'probe-hook.mjs')
  writeFileSync(
    hook,
    [
      `import { readFileSync, writeFileSync } from 'node:fs'`,
      `let stdin = ''`,
      `try { stdin = readFileSync(0, 'utf-8') } catch { stdin = '' }`,
      `writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({`,
      `  stdin,`,
      `  path: process.env.CLAUDE_TOOL_INPUT_PATH ?? null,`,
      `  command: process.env.CLAUDE_TOOL_INPUT_COMMAND ?? null,`,
      `}))`,
    ].join('\n'),
  )
  return hook
}

function readProbe(outFile: string): {
  payload: Record<string, unknown>
  path: string | null
  command: string | null
} {
  const raw = JSON.parse(readFileSync(outFile, 'utf-8')) as {
    stdin: string
    path: string | null
    command: string | null
  }
  return {
    payload: JSON.parse(raw.stdin) as Record<string, unknown>,
    path: raw.path,
    command: raw.command,
  }
}

describe('codex-adapter stdin payload bridge (#2385)', () => {
  let dir: string
  let out: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-payload-'))
    out = join(dir, 'probe.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('pipes a Claude-shaped Edit payload on stdin for an apply_patch Update File', () => {
    const hook = writeProbeHook(dir, out)
    const patch = `*** Begin Patch\n*** Update File: src/foo.ts\n@@\n-a\n+b\n*** End Patch`
    const result = runAdapter(
      { ...makeApplyPatchPayload(patch), transcript_path: '/tmp/t.jsonl' },
      hook,
    )
    expect(result.status).toBe(0)

    const { payload, path, command } = readProbe(out)
    expect(payload.tool_name).toBe('Edit')
    expect(payload.tool_input).toEqual({ file_path: 'src/foo.ts' })
    expect(payload.hook_event_name).toBe('PostToolUse')
    expect(payload.cwd).toBe(process.cwd())
    expect(payload.session_id).toBe('test-session')
    // Fields the Codex payload carries must survive — stop-finding-loss reads transcript_path
    expect(payload.transcript_path).toBe('/tmp/t.jsonl')
    // Legacy env channel stays populated for env-reading hooks
    expect(path).toBe('src/foo.ts')
    expect(command).toBeNull()
  })

  it('maps an Add File directive to tool_name Write', () => {
    const hook = writeProbeHook(dir, out)
    const patch = `*** Begin Patch\n*** Add File: src/new.ts\n+x\n*** End Patch`
    runAdapter(makeApplyPatchPayload(patch), hook)
    const { payload } = readProbe(out)
    expect(payload.tool_name).toBe('Write')
    expect(payload.tool_input).toEqual({ file_path: 'src/new.ts' })
  })

  it('pipes a Claude-shaped Bash payload on stdin and keeps the legacy env var', () => {
    const hook = writeProbeHook(dir, out)
    const result = runAdapter(makeBashPayload('echo hi'), hook)
    expect(result.status).toBe(0)

    const { payload, path, command } = readProbe(out)
    expect(payload.tool_name).toBe('Bash')
    expect(payload.tool_input).toEqual({ command: 'echo hi' })
    expect(payload.hook_event_name).toBe('PreToolUse')
    expect(command).toBe('echo hi')
    expect(path).toBeNull()
  })

  it('forwards a non-tool event (UserPromptSubmit) payload unchanged, once', () => {
    const hook = writeProbeHook(dir, out)
    const result = runAdapter(
      {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'ship it',
        cwd: process.cwd(),
        session_id: 'test-session',
      },
      hook,
    )
    expect(result.status).toBe(0)
    const { payload } = readProbe(out)
    expect(payload.hook_event_name).toBe('UserPromptSubmit')
    expect(payload.prompt).toBe('ship it')
    expect(payload.tool_name).toBeUndefined()
  })

  it('takes hook_event_name from --event when the payload omits it', () => {
    const hook = writeProbeHook(dir, out)
    const result = spawnSync('node', [ADAPTER, '--event', 'PreToolUse', hook], {
      input: JSON.stringify({ tool_name: 'bash', tool_input: { command: 'ls' } }),
      encoding: 'utf-8',
      env: { ...process.env },
    })
    expect(result.status).toBe(0)
    const { payload } = readProbe(out)
    expect(payload.hook_event_name).toBe('PreToolUse')
  })

  it('propagates a hook exit code of 2 and a clean 0', () => {
    const blocking = join(dir, 'block.mjs')
    writeFileSync(blocking, `process.exit(2)`)
    expect(runAdapter(makeBashPayload('ls'), blocking).status).toBe(2)

    const clean = join(dir, 'clean.mjs')
    writeFileSync(clean, `process.exit(0)`)
    expect(runAdapter(makeBashPayload('ls'), clean).status).toBe(0)
  })

  it('exits 2 when the hook dies by signal (status null is a hard block)', () => {
    const killed = join(dir, 'killed.mjs')
    writeFileSync(killed, `process.kill(process.pid, 'SIGKILL')\nsetTimeout(() => {}, 5000)`)
    const result = runAdapter(makeBashPayload('ls'), killed)
    expect(result.status).toBe(2)
  })
})

describe('codex config bridge parity with .claude/settings.json (#2385)', () => {
  it('bridges or explicitly classifies every command hook wired for Claude', () => {
    const settings = JSON.parse(
      readFileSync(join(process.cwd(), '.claude/settings.json'), 'utf-8'),
    ) as { hooks: Record<string, { hooks?: { type?: string; command?: string }[] }[]> }
    const codexConfig = readFileSync(join(process.cwd(), '.codex/config.toml'), 'utf-8')

    const claudeHooks = new Set<string>()
    for (const groups of Object.values(settings.hooks ?? {})) {
      for (const group of groups) {
        for (const entry of group.hooks ?? []) {
          if (entry.type !== 'command') continue
          const m = /\.claude\/hooks\/([\w.-]+\.mjs)/.exec(entry.command ?? '')
          if (m) claudeHooks.add(m[1])
        }
      }
    }
    expect(claudeHooks.size).toBeGreaterThan(0)

    // Comment lines are stripped first: a hook named only inside the trailer (or a
    // commented-out entry) must NOT count as wired.
    const configBody = codexConfig
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n')
    const bridged = new Set(
      [
        ...configBody.matchAll(
          /codex-adapter\.mjs (?:--event \w+ )?\.claude\/hooks\/([\w.-]+\.mjs)/g,
        ),
      ].map((m) => m[1]),
    )
    const classified = new Set(
      [...codexConfig.matchAll(/^#\s*unbridgeable:\s*([\w.-]+\.mjs)\b/gm)].map((m) => m[1]),
    )

    const unaccounted = [...claudeHooks].filter((h) => !bridged.has(h) && !classified.has(h)).sort()
    expect(
      unaccounted,
      `Claude hooks neither bridged in .codex/config.toml nor listed in its ` +
        `"# unbridgeable:" trailer: ${unaccounted.join(', ')}`,
    ).toEqual([])
  })
})
