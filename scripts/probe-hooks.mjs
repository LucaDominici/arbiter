#!/usr/bin/env node
// CATALOG: empirically classifies every Arbiter-owned emitted hook in BARE and PRIMED states.
// Static routing alone cannot prove that a reachable handler blocks its declared violation.
// This probe is the behavioral half of the v0.6 consumer reliability bar (#2135).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { classifyAdvisoryHookResult, classifyHookResult } from './lib/consumer-reliability-bar.mjs'

const ADVISORY = {
  'debug-state-on-failure.mjs':
    'Records diagnostic context after a failed tool call and intentionally never blocks.',
  'pre-compact.mjs':
    'Persists best-effort context before compaction and intentionally never blocks.',
  'exitplanmode-banner.mjs':
    'Prints the next ship step after plan mode and intentionally never blocks.',
  'skill-forced-eval.mjs':
    'Prints a skill-selection reminder before prompts and intentionally never blocks.',
  'wiki-on-commit.mjs':
    'Refreshes wiki context after commits and reports diagnostics without blocking.',
  'post-edit-dispatch.mjs':
    'Runs formatter/linter feedback after edits; the authoritative checks remain in the gate.',
  'check-circular-deps.mjs':
    'Per-edit madge execution soft-skips when unavailable or debounced; the L1 gate is authoritative.',
  'check-no-unused-exports.mjs':
    'Per-edit knip execution soft-skips when unavailable or debounced; the L1 gate is authoritative.',
  'pre-spawn-worktree-guard.mjs':
    'Default grading is advisory; ARBITER_SPAWN_GUARD_HARD=1 explicitly promotes it.',
  'stop-finding-loss.mjs':
    'Default grading is advisory; ARBITER_FINDING_LOSS_HARD=1 explicitly promotes it.',
}

const HARD = {
  'stop-dangerous.mjs': { states: ['BARE', 'PRIMED'], kind: 'command', value: 'rm -rf /tmp/x' },
  'enforce-read-only.mjs': { states: ['BARE', 'PRIMED'], kind: 'path', fixture: 'AGENTS.md' },
  'pre-edit-ssot-guard.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'path',
    fixture: 'docs/SYSTEM/DECISIONS.md',
  },
  'check-no-orphan-todo.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'source',
    content: '// ' + 'TODO: missing task id\n',
  },
  'check-no-placeholders.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'source',
    content: '// FIX' + 'ME: unfinished\n',
  },
  'enforce-gate-before-pr.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'command',
    value: 'gh pr create --title probe --body probe',
  },
  'check-no-skipped-tests.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'named-file',
    name: 'probe.test.ts',
    content: 'it.' + "skip('probe', () => {})\n",
  },
  'check-no-pii.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'source',
    content: 'const contact = "' + 'probe' + '@' + 'example.invalid";\n',
  },
  'check-no-any.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'named-file',
    name: 'probe.ts',
    content: 'const value: any = 1\n',
  },
  'check-no-unwrap.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'named-file',
    name: 'probe.rs',
    content: 'fn f() { value.unwrap(); }\n',
  },
  'check-no-unchecked-err.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'named-file',
    name: 'probe.go',
    content: 'package probe\nfunc f() {\n  _ = doThing()\n}\n',
  },
  'check-no-bare-except.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'named-file',
    name: 'probe.py',
    content: 'try:\n  pass\nexcept:\n  pass\n',
  },
  'check-no-raw-types.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'named-file',
    name: 'Probe.java',
    content: 'class Probe { List values; }\n',
  },
  'check-no-mockmvc.mjs': {
    states: ['BARE', 'PRIMED'],
    kind: 'named-file',
    name: 'ProbeTest.java',
    content: 'class ProbeTest { MockMvc client; }\n',
  },
  'pre-edit-plan-anchor.mjs': {
    states: ['PRIMED'],
    rationale: 'Requires an active implementation phase and coherent task branch.',
    kind: 'path',
    fixture: 'src/unplanned-probe.ts',
  },
  'guard-task-completion.mjs': {
    states: ['PRIMED'],
    rationale: 'Completion language is governed only while an implementation phase is active.',
    kind: 'prompt',
    value: 'task complete, ready to merge',
  },
  'stop-evidence-guard.mjs': {
    states: ['PRIMED'],
    rationale: 'Completion evidence is required only for an active task.',
    kind: 'stop',
  },
  'closer-mode-guard.mjs': {
    states: ['CLOSE'],
    rationale: 'The closer guard is applicable only in the close phase.',
    kind: 'command',
    value: 'git checkout main',
  },
  'post-brainstorm-stop.mjs': {
    states: ['PRIMED'],
    rationale: 'The terminal-state guard requires the brainstorm-active marker.',
    kind: 'brainstorm',
  },
  'guard-done-evidence.mjs': {
    states: ['VERIFICATION'],
    rationale: 'Evidence-harness completion checks apply only in verification.',
    kind: 'prompt',
    value: 'task complete, ready to merge',
  },
  'post-commit-check.mjs': {
    states: ['PRIMED'],
    rationale: 'Commit-message enforcement is evaluated after a commit command.',
    kind: 'bad-commit',
  },
}

try {
  const options = parseArgs(process.argv.slice(2))
  const result = probeRepository(options.root, options.language)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exit(result.ok ? 0 : 1)
} catch (error) {
  process.stderr.write(
    `[probe-hooks] ERROR — ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(2)
}

function parseArgs(args) {
  const rootIndex = args.indexOf('--root')
  const languageIndex = args.indexOf('--language')
  if (rootIndex === -1 || languageIndex === -1) {
    throw new Error('usage: probe-hooks.mjs --root <repo> --language <language>')
  }
  return { root: resolve(args[rootIndex + 1]), language: args[languageIndex + 1] }
}

function probeRepository(root, language) {
  const hooksDir = join(root, '.claude', 'hooks')
  const owned = ownedHooks(root)
  const temporary = join(root, '.arb-probe-tmp')
  rmSync(temporary, { recursive: true, force: true })
  mkdirSync(temporary, { recursive: true })
  const rows = []
  for (const state of ['BARE', 'PRIMED']) {
    establishState(root, state)
    for (const hook of owned) rows.push(probeOne(root, hooksDir, temporary, language, hook, state))
  }
  rmSync(temporary, { recursive: true, force: true })
  rmSync(join(root, '.claude', '.task'), { recursive: true, force: true })
  const bad = rows.filter((row) =>
    [
      'INERT',
      'NO-PROBE',
      'INVALID-ADVISORY',
      'INVALID-RATIONALE',
      'UNEXPECTED-BLOCK',
      'PROBE-ERROR',
    ].includes(row.verdict),
  )
  return { ok: bad.length === 0, language, emitted: owned.length, rows, failures: bad }
}

function ownedHooks(root) {
  const manifestPath = join(root, '.arbiter-generated-manifest.json')
  if (!existsSync(manifestPath)) throw new Error('generated manifest missing after update')
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  if (parsed?.$schemaVersion !== 1 || typeof parsed.files !== 'object') {
    throw new Error('generated manifest has an invalid shape')
  }
  return Object.keys(parsed.files)
    .filter((path) => /^\.claude\/hooks\/[^/]+\.mjs$/.test(path))
    .map((path) => path.slice('.claude/hooks/'.length))
    .filter((file) => file !== 'hooks.mjs' && file !== 'lib.mjs')
    .sort()
}

function establishState(root, state) {
  runGit(root, ['checkout', '-B', state === 'BARE' ? 'main' : 'task/#1-probe'])
  const taskDir = join(root, '.claude', '.task')
  rmSync(taskDir, { recursive: true, force: true })
  if (state === 'PRIMED') {
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(
      join(taskDir, 'status.json'),
      JSON.stringify({
        taskId: '#1',
        phase: 'green',
        plan: '.claude/plans/missing-probe-plan.md',
        branch: 'task/#1-probe',
        tier: 'Standard',
      }),
    )
  }
}

function probeOne(root, hooksDir, temporary, language, hook, state) {
  const advisoryRationale = ADVISORY[hook]
  if (advisoryRationale) {
    const result = runHook(root, join(hooksDir, hook), {})
    return {
      hook,
      state,
      exitCode: result.status,
      verdict: classifyAdvisoryHookResult({
        exitCode: result.status,
        signal: result.signal,
        rationale: advisoryRationale,
      }),
      rationale: advisoryRationale,
      diagnostic: commandDiagnostic(result),
    }
  }
  const contract = HARD[hook]
  if (!contract) return { hook, state, exitCode: null, verdict: 'NO-PROBE', rationale: '' }
  const applicable = contract.states.includes(state)
  if (!applicable) {
    return {
      hook,
      state,
      exitCode: null,
      verdict: classifyHookResult({
        exitCode: null,
        hardness: 'HARD',
        applicable: false,
        rationale: contract.rationale ?? 'This hook is contextual in another declared state.',
      }),
      rationale: contract.rationale ?? 'This hook is contextual in another declared state.',
    }
  }
  prepareSpecialState(root, temporary, contract, state)
  const payload = payloadFor(root, temporary, language, contract)
  const result = runHook(root, join(hooksDir, hook), payload)
  return {
    hook,
    state,
    exitCode: result.status,
    verdict: classifyHookResult({
      exitCode: result.status,
      hardness: 'HARD',
      applicable: true,
      rationale: contract.rationale ?? '',
    }),
    rationale: contract.rationale ?? '',
    diagnostic: commandDiagnostic(result),
  }
}

function prepareSpecialState(root, temporary, contract, state) {
  const statusPath = join(root, '.claude', '.task', 'status.json')
  if (contract.states.includes('CLOSE')) {
    establishState(root, 'PRIMED')
    const status = JSON.parse(readFileSync(statusPath, 'utf-8'))
    writeFileSync(statusPath, JSON.stringify({ ...status, phase: 'close' }))
  } else if (contract.states.includes('VERIFICATION')) {
    establishState(root, 'PRIMED')
    const status = JSON.parse(readFileSync(statusPath, 'utf-8'))
    writeFileSync(statusPath, JSON.stringify({ ...status, phase: 'verification' }))
  } else if (state === 'PRIMED' && !existsSync(statusPath)) {
    establishState(root, 'PRIMED')
  }
  if (contract.kind === 'brainstorm') {
    mkdirSync(join(root, '.arbiter'), { recursive: true })
    writeFileSync(join(root, '.arbiter', 'brainstorm-active'), String(Date.now()))
  }
  if (contract.kind === 'bad-commit') {
    runGit(root, ['commit', '--allow-empty', '-m', 'bad message'])
  }
  if (contract.kind === 'stop') {
    writeFileSync(
      join(temporary, 'transcript.jsonl'),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'task complete' }] },
      }) + '\n',
    )
  }
}

function payloadFor(root, temporary, language, contract) {
  if (contract.kind === 'command') return { tool_input: { command: contract.value } }
  if (contract.kind === 'prompt' || contract.kind === 'brainstorm') {
    return { prompt: contract.kind === 'brainstorm' ? '/task #1' : contract.value }
  }
  if (contract.kind === 'bad-commit') {
    return { tool_input: { command: 'git commit -m "bad message"' } }
  }
  if (contract.kind === 'stop') {
    return {
      stop_hook_active: false,
      transcript_path: join(temporary, 'transcript.jsonl'),
    }
  }
  const name =
    contract.kind === 'named-file'
      ? contract.name
      : contract.kind === 'source'
        ? `probe${sourceExtension(language)}`
        : contract.fixture
  const path = contract.kind === 'path' ? join(root, name) : join(temporary, name)
  if (contract.kind !== 'path') {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contract.content ?? 'probe\n')
  }
  return { tool_input: { file_path: path } }
}

function sourceExtension(language) {
  return (
    {
      go: '.go',
      java: '.java',
      kotlin: '.kt',
      multi: '.ts',
      python: '.py',
      rust: '.rs',
      typescript: '.ts',
    }[language] ?? '.ts'
  )
}

function runHook(root, hookPath, payload) {
  if (!existsSync(hookPath)) return { status: null, stderr: `missing ${hookPath}` }
  return spawnSync('node', [hookPath], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    timeout: 90000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  })
}

function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf-8',
    timeout: 30000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Arbiter Probe',
      GIT_AUTHOR_EMAIL: 'probe' + '@' + 'invalid',
      GIT_COMMITTER_NAME: 'Arbiter Probe',
      GIT_COMMITTER_EMAIL: 'probe' + '@' + 'invalid',
    },
  })
  if (result.status !== 0) throw new Error(`git ${args[0]} failed during probe`)
}

function commandDiagnostic(result) {
  return `exit=${String(result.status)},signal=${String(result.signal)}`
}
