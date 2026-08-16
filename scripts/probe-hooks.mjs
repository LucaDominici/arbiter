#!/usr/bin/env node
// CATALOG: empirically classifies every Arbiter-owned emitted hook in BARE and PRIMED states.
// Static routing alone cannot prove that a reachable handler blocks its declared violation.
// This probe is the behavioral half of the v0.6 consumer reliability bar (#2135).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { classifyAdvisoryHookResult, classifyHookResult } from './lib/consumer-reliability-bar.mjs'

// #2292: every ADVISORY hook carries a PAYLOAD CONTRACT, resolved through the same
// `payloadFor` machinery the HARD hooks use. Probing advisories with `{}` asserted only
// "it did not block on an empty payload" — which an advisory hook that crashes on the
// payload it actually receives, or that has stopped doing anything at all, passes just
// as happily. That was ~40% of the emitted hook surface.
//
// `promoted` names the env knob whose whole documented purpose is to turn the hook into
// a blocker. That branch is probed as a SECOND row (mode PROMOTED) which must exit 2, so
// "the *_HARD mode promotes it" stops being an unexecuted claim in a code comment.
const ADVISORY = {
  'debug-state-on-failure.mjs': {
    rationale:
      'Records diagnostic context after a failed tool call and intentionally never blocks.',
    // A command that matches the hook's own TEST_PATTERNS — anything else exits at the
    // first filter without ever reaching the body under test.
    kind: 'command',
    value: 'npm test',
  },
  'pre-compact.mjs': {
    rationale: 'Persists best-effort context before compaction and intentionally never blocks.',
    kind: 'payload',
    value: { hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: '' },
  },
  'exitplanmode-banner.mjs': {
    rationale: 'Prints the next ship step after plan mode and intentionally never blocks.',
    kind: 'payload',
    value: {
      hook_event_name: 'PostToolUse',
      tool_name: 'ExitPlanMode',
      tool_input: { plan: 'probe plan' },
    },
  },
  'skill-forced-eval.mjs': {
    rationale: 'Prints a skill-selection reminder before prompts and intentionally never blocks.',
    // Must match the hook's CODE_KEYWORDS filter, or the probe stops at the smart filter.
    kind: 'prompt',
    value: 'implement the parser in src/probe.ts and add a test',
  },
  'wiki-on-commit.mjs': {
    rationale: 'Refreshes wiki context after commits and reports diagnostics without blocking.',
    kind: 'command',
    value: 'git commit -m "docs: probe"',
  },
  'post-edit-dispatch.mjs': {
    rationale:
      'Runs formatter/linter feedback after edits; the authoritative checks remain in the gate.',
    kind: 'source',
  },
  'check-circular-deps.mjs': {
    rationale:
      'Per-edit madge execution soft-skips when unavailable or debounced; the L1 gate is authoritative.',
    // Explicitly .ts: the hook returns at once for any other extension, so a
    // language-derived source file would leave the soft-skip branch unprobed.
    kind: 'named-file',
    name: 'probe.ts',
    content: 'export const probe = 1\n',
  },
  'check-no-unused-exports.mjs': {
    rationale:
      'Per-edit knip execution soft-skips when unavailable or debounced; the L1 gate is authoritative.',
    kind: 'named-file',
    name: 'probe.ts',
    content: 'export const probe = 1\n',
  },
  'pre-spawn-worktree-guard.mjs': {
    rationale: 'Default grading is advisory; ARBITER_SPAWN_GUARD_HARD=1 explicitly promotes it.',
    // Two distinct task ids on one dispatch — the M2 one-task-per-dispatch violation.
    // Advisory grading warns and exits 0; the promoted grading must exit 2.
    kind: 'payload',
    value: {
      tool_input: {
        subagent_type: 'arbiter-probe-writer',
        prompt: 'handle #1 and #2 in this dispatch',
      },
    },
    promoted: 'ARBITER_SPAWN_GUARD_HARD',
  },
  'stop-finding-loss.mjs': {
    rationale: 'Default grading is advisory; ARBITER_FINDING_LOSS_HARD=1 explicitly promotes it.',
    kind: 'finding-loss-stop',
    promoted: 'ARBITER_FINDING_LOSS_HARD',
  },
}

/**
 * The promotion knobs declared above. The probe FORCES each to '0' for every
 * non-promoted run, so an operator environment that already exports one cannot
 * silently turn the advisory pass into a blocking one (or the reverse).
 */
const PROMOTION_KNOBS = [
  ...new Set(Object.values(ADVISORY).map((contract) => contract.promoted).filter(Boolean)),
]

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
  process.exit(result.exitCode)
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
  for (const state of ['BARE', 'PRIMED', 'CLOSE', 'VERIFICATION']) {
    establishState(root, state)
    for (const hook of owned) {
      rows.push(probeOne(root, hooksDir, temporary, language, hook, state))
      // #2292: a hook whose advisory justification IS its promoted mode owes a second
      // row proving that mode blocks. Without it the justification cites behaviour the
      // bar never executes.
      if (ADVISORY[hook]?.promoted) {
        rows.push(probePromoted(root, hooksDir, temporary, language, hook, state))
      }
    }
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
  const operationalErrors = bad.filter((row) => row.verdict === 'PROBE-ERROR')
  const exitCode = operationalErrors.length > 0 ? 2 : bad.length > 0 ? 1 : 0
  return {
    ok: exitCode === 0,
    exitCode,
    language,
    emitted: owned.length,
    rows,
    failures: bad,
  }
}

function ownedHooks(root) {
  const manifestPath = join(root, '.arbiter-generated-manifest.json')
  const hooksDir = join(root, '.claude', 'hooks')
  if (!existsSync(manifestPath)) throw new Error('generated manifest missing after update')
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  if (parsed?.$schemaVersion !== 1 || typeof parsed.files !== 'object') {
    throw new Error('generated manifest has an invalid shape')
  }
  if (
    parsed.withheldSafety !== undefined &&
    (!Array.isArray(parsed.withheldSafety) ||
      !parsed.withheldSafety.every((path) => typeof path === 'string'))
  ) {
    throw new Error('generated manifest has invalid withheldSafety ownership')
  }
  const marked = readdirSync(hooksDir)
    .filter((file) => file.endsWith('.mjs') && file !== 'hooks.mjs' && file !== 'lib.mjs')
    .filter((file) => readFileSync(join(hooksDir, file), 'utf-8').includes('Arbiter hook:'))
    .map((file) => `.claude/hooks/${file}`)
  return [...new Set([...Object.keys(parsed.files), ...(parsed.withheldSafety ?? []), ...marked])]
    .filter((path) => /^\.claude\/hooks\/[^/]+\.mjs$/.test(path))
    .map((path) => path.slice('.claude/hooks/'.length))
    .filter((file) => file !== 'hooks.mjs' && file !== 'lib.mjs')
    .sort()
}

function establishState(root, state) {
  if (gitPorcelain(root) !== '') {
    // #2227 dirty-tree guard: COMMIT the working tree instead of stashing it.
    // Stashing hides the changes (e.g. an `arbiter update` that just wrote the
    // hooks being probed), so the probe would test the pre-update content and
    // report INERT for hooks the update had just fixed. Committing preserves the
    // working tree for the probe while giving `checkout -B` a clean tree.
    runGit(root, ['add', '-A'])
    runGit(root, ['commit', '-m', 'arbiter-probe checkpoint', '--allow-empty'])
  }
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
  const advisory = ADVISORY[hook]
  if (advisory) {
    // #2292: the realistic payload, not `{}` — a crash on the hook's real input now
    // classifies PROBE-ERROR instead of passing as a healthy ADVISORY.
    const payload = payloadFor(root, temporary, language, advisory)
    const result = runHook(root, join(hooksDir, hook), payload)
    return {
      hook,
      state,
      mode: 'ADVISORY',
      exitCode: result.status,
      verdict: classifyAdvisoryHookResult({
        exitCode: result.status,
        signal: result.signal,
        rationale: advisory.rationale,
      }),
      rationale: advisory.rationale,
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
      mode: 'HARD',
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
    mode: 'HARD',
    exitCode: result.status,
    verdict: classifyHookResult({
      exitCode: result.status,
      signal: result.signal,
      hardness: 'HARD',
      applicable: true,
      rationale: contract.rationale ?? '',
    }),
    rationale: contract.rationale ?? '',
    diagnostic: commandDiagnostic(result),
  }
}

/**
 * #2292: execute the *_HARD=1 branch of an advisory hook and demand a BLOCK. The same
 * payload is used as for the advisory pass, so the pair is a clean falsifier: identical
 * input, one knob, exit 0 vs exit 2. A promoted branch that no longer exits 2 classifies
 * INERT and reddens the bar exactly like a dead HARD hook.
 */
function probePromoted(root, hooksDir, temporary, language, hook, state) {
  const contract = ADVISORY[hook]
  const payload = payloadFor(root, temporary, language, contract)
  const result = runHook(root, join(hooksDir, hook), payload, { [contract.promoted]: '1' })
  const rationale = `${contract.promoted}=1 promotes this hook to blocking; the promoted branch must exit 2.`
  return {
    hook,
    state,
    mode: 'PROMOTED',
    exitCode: result.status,
    verdict: classifyHookResult({
      exitCode: result.status,
      signal: result.signal,
      hardness: 'HARD',
      applicable: true,
      rationale,
    }),
    rationale,
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
  const special = specialPayload(temporary, contract)
  if (special !== null) return special
  return filePayload(root, temporary, language, contract)
}

/**
 * #2292: a realistic Stop payload for `stop-finding-loss.mjs`. The hook stands down
 * unless the transcript yields a parseable session-start timestamp AND at least two
 * Task/Agent dispatches, so neither `{}` nor the plain-text transcript built for
 * `stop-evidence-guard.mjs` ever reached the branch its promotion knob lives in. The
 * session start is stamped NOW so pre-existing findings/agent-return artifacts in the
 * target repo fall outside the window and cannot mask the signal.
 */
function findingLossPayload(temporary) {
  const path = join(temporary, 'finding-loss-transcript.jsonl')
  const dispatch = (name) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name, id: `probe-${name}`, input: {} }],
      },
    })
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${dispatch('Task')}\n${dispatch('Agent')}\n`)
  return { stop_hook_active: false, transcript_path: path }
}

function specialPayload(temporary, contract) {
  switch (contract.kind) {
    case 'command':
      return { tool_input: { command: contract.value } }
    case 'payload':
      return contract.value
    case 'finding-loss-stop':
      return findingLossPayload(temporary)
    case 'prompt':
      return { prompt: contract.value }
    case 'brainstorm':
      return { prompt: '/task #1' }
    case 'bad-commit':
      return { tool_input: { command: 'git commit -m "bad message"' } }
    case 'stop':
      return {
        stop_hook_active: false,
        transcript_path: join(temporary, 'transcript.jsonl'),
      }
    default:
      return null
  }
}

function filePayload(root, temporary, language, contract) {
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

function runHook(root, hookPath, payload, extraEnv = {}) {
  if (!existsSync(hookPath)) return { status: null, stderr: `missing ${hookPath}` }
  return spawnSync('node', [hookPath], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    timeout: 90000,
    env: {
      ...process.env,
      // #2292: neutralise every promotion knob first, so an operator environment that
      // already exports one cannot make the advisory pass block (or the promoted pass
      // pass for the wrong reason). `extraEnv` re-enables exactly the knob under probe.
      ...Object.fromEntries(PROMOTION_KNOBS.map((knob) => [knob, '0'])),
      CLAUDE_PROJECT_DIR: root,
      ...extraEnv,
    },
  })
}

function gitPorcelain(root) {
  const result = spawnSync('git', ['-C', root, 'status', '--porcelain'], {
    encoding: 'utf-8',
  })
  return result.status === 0 ? result.stdout : ''
}

function runGit(root, args) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args], {
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
