#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Arbiter hook: block gh pr create unless gate marker is fresh (R1.S5)
// FAIL-OPEN-INTENT: hook exits 0 for non-PR commands; gate-fail exits 2 explicitly
// Fires on: PreToolUse → Bash
// Exit 2: block — stderr returned to Claude as error context
// Delegated Agent-tool sessions do not run the `.claude/settings.json` hook chain.
// This hook is defence-in-depth/advisory there; CI plus branch protection enforce.
// See `docs/internal/SYSTEM/HOOK-CONTRACTS.md#scope-and-threat-model` (#2022).
//
// #1990: worktree-aware. A session cwd on repo root must not gate a `gh pr
// create` that actually targets a different worktree (`cd <dir> && gh pr
// create ...`, or `--head <branch>` naming a branch checked out elsewhere).
// resolveTargetRoot() finds that worktree and the marker is validated
// against ITS HEAD, not the session cwd's. `gh issue create` is exempt
// (opening an issue is not a completion claim) — the segment-anchored match
// below also refuses to treat `gh pr create` mentioned inside a
// `gh issue create --body "..."` string as a real invocation.
import { readFileSync, existsSync, writeSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveToolInputCommand } from './lib.mjs'

// Resolve the command from stdin-JSON (real Claude Code) or the env var (Codex).
// Reading only the env var made this guard silently inert under Claude Code (#1565).
const command = resolveToolInputCommand()

// Split on shell chain operators outside quotes and match each segment by argv.
// This is what makes `gh issue create --body "run gh pr create after"` safe:
// that segment starts with `gh issue create`, not `gh pr create`, so it never
// matches — no separate exemption list needed for gh issue create.
function parseShell(input) {
  const commands = [[]]
  let token = ''
  let quote = null
  let escaped = false
  const pushToken = () => {
    if (token) commands.at(-1).push(token)
    token = ''
  }
  const pushCommand = () => {
    pushToken()
    if (commands.at(-1).length > 0) commands.push([])
  }
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (escaped) {
      token += char
      escaped = false
    } else if (char === '\\') {
      escaped = true
    } else if (quote !== null) {
      if (char === quote) quote = null
      else token += char
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === ';' || char === '|' || (char === '&' && input[index + 1] === '&')) {
      pushCommand()
      if ((char === '|' && input[index + 1] === '|') || char === '&') index += 1
    } else if (/\s/.test(char)) {
      pushToken()
    } else {
      token += char
    }
  }
  pushToken()
  if (commands.at(-1).length === 0) commands.pop()
  return { commands, ambiguous: quote !== null || escaped }
}

const parsed = parseShell(command)
const segments = parsed.commands
const parsedSegments = segments.map((tokens, index) => ({ tokens, index }))
const guardedSegments = parsedSegments.filter(
  ({ tokens }) =>
    tokens[0] === 'gh' && tokens[1] === 'pr' && (tokens[2] === 'create' || tokens[2] === 'ready'),
)
const ambiguousGuardSegments = parsedSegments.filter(({ tokens, ambiguous }) => {
  if (ambiguous) return true
  const normalized = tokens.map((token) => token.replace(/^[({]+|[)}]+$/g, ''))
  return normalized.some(
    (token, index) =>
      token === 'gh' &&
      normalized[index + 1] === 'pr' &&
      (normalized[index + 2] === 'create' || normalized[index + 2] === 'ready') &&
      !(index === 0 && tokens[0] === 'gh'),
  )
})
const hasAmbiguousGuard = parsed.ambiguous || ambiguousGuardSegments.length > 0
if (guardedSegments.length === 0 && !hasAmbiguousGuard) process.exit(0)
const guardIndex = (guardedSegments[0] ?? ambiguousGuardSegments[0]).index
const isDraft =
  !hasAmbiguousGuard &&
  guardedSegments.length === 1 &&
  guardedSegments[0].tokens[2] === 'create' &&
  guardedSegments[0].tokens.includes('--draft') &&
  !guardedSegments[0].tokens.some((token) => token.startsWith('--draft='))

function exitAfterStderr(code, message) {
  writeSync(2, message)
  process.exit(code)
}

if (process.env.ARBITER_SKIP_GATE_MARKER === '1') {
  await exitAfterStderr(0, '[arbiter] Gate marker check bypassed (ARBITER_SKIP_GATE_MARKER=1)\n')
}

/**
 * Finds the worktree the `gh pr create` invocation actually targets, if any.
 * Checked in order:
 *   1. A `cd <dir> &&` segment earlier in the same command chain.
 *   2. A `--head <branch>` flag naming a branch checked out in another worktree.
 * Returns the worktree's toplevel path, or null when neither is present (the
 * caller then falls back to the previous cwd-based resolution unchanged).
 */
function resolveTargetRoot(cmdSegments, guardIndex) {
  for (let i = guardIndex - 1; i >= 0; i--) {
    const tokens = cmdSegments[i]
    if (tokens[0] !== 'cd' || tokens.length !== 2) continue
    const dir = tokens[1]
    const top = spawnSync(
      'git',
      ['-C', resolve(process.cwd(), dir), 'rev-parse', '--show-toplevel'],
      { encoding: 'utf-8' },
    )
    if (top.status === 0 && top.stdout.trim()) return top.stdout.trim()
    break
  }

  const guardTokens = cmdSegments[guardIndex]
  const headIndex = guardTokens.findIndex(
    (token) => token === '--head' || token.startsWith('--head='),
  )
  const branch =
    headIndex < 0 ? undefined : (guardTokens[headIndex].split('=')[1] ?? guardTokens[headIndex + 1])
  if (branch) {
    const listResult = spawnSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf-8' })
    if (listResult.status === 0) {
      for (const entry of listResult.stdout.split('\n\n')) {
        const wtPath = entry.match(/^worktree (.+)$/m)?.[1]
        const wtBranch = entry.match(/^branch refs\/heads\/(.+)$/m)?.[1]
        if (wtPath && wtBranch === branch) return wtPath
      }
    }
  }

  return null
}

function readCiPassReceipt(root) {
  const receiptPath = resolve(root, '.arbiter/ci-pass.json')
  if (!existsSync(receiptPath)) {
    return { ok: false, reason: 'No ci-pass.json receipt found.' }
  }

  let receipt
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf-8'))
  } catch (err) {
    process.stderr.write(
      `[arbiter] GATE GUARD: ci-pass.json is invalid: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }

  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf-8' })
  const sha = head.status === 0 ? head.stdout.trim() : ''
  if (!sha) return { ok: false, reason: 'current HEAD could not be resolved for ci-pass.json.' }
  if (
    receipt === null ||
    typeof receipt !== 'object' ||
    Array.isArray(receipt) ||
    receipt.sha !== sha ||
    receipt.conclusion !== 'success' ||
    typeof receipt.runUrl !== 'string' ||
    receipt.runUrl.length === 0 ||
    typeof receipt.checkedAt !== 'string' ||
    receipt.checkedAt.length === 0
  ) {
    return {
      ok: false,
      reason: 'ci-pass.json is stale or not a successful receipt for current HEAD.',
    }
  }
  return { ok: true, reason: '' }
}

const resolvedRoot = resolveTargetRoot(segments, guardIndex)

let repoRoot
if (resolvedRoot) {
  repoRoot = resolvedRoot
} else {
  const gitResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' })
  repoRoot = gitResult.stdout.trim() || process.cwd()
}

const markerPath = resolve(repoRoot, '.arbiter/gate-pass.json')
const rootNote = resolvedRoot ? ` (worktree: ${repoRoot})` : ''

if (isDraft) {
  await exitAfterStderr(
    0,
    `[arbiter] GATE GUARD: DRAFT PR allowed before gate/CI receipt validation${rootNote}; CI must verify the pushed SHA.\n`,
  )
}

const ciReceipt = readCiPassReceipt(repoRoot)

if (ciReceipt.ok) process.exit(0)

if (!existsSync(markerPath)) {
  await exitAfterStderr(
    2,
    `[arbiter] GATE GUARD: No valid gate-pass.json or ci-pass.json found${rootNote}.\n` +
      `${ciReceipt.reason}\n` +
      'Run `node scripts/check-all.mjs preflight` for a local diagnostic, or `node scripts/ci-receipt.mjs` to record the CI verdict for HEAD.\n',
  )
}

let marker
try {
  marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
} catch (err) {
  await exitAfterStderr(
    2,
    `[arbiter] GATE GUARD: gate-pass.json is invalid${rootNote}: ${err instanceof Error ? err.message : String(err)}\n` +
      'Run `node scripts/check-all.mjs preflight` for a local diagnostic, or `node scripts/ci-receipt.mjs` to record the CI verdict for HEAD.\n',
  )
}

// The shared verifier is loaded lazily and fail-CLOSED: a static import that
// cannot resolve would abort the hook with exit 1, which Claude Code treats as
// non-blocking — a missing verifier would silently open the gate.
let gateEvidence
try {
  gateEvidence = await import('../../scripts/lib/gate-evidence.mjs')
} catch (err) {
  await exitAfterStderr(
    2,
    `[arbiter] GATE GUARD: the gate-pass verifier could not be loaded${rootNote}: ` +
      `${err instanceof Error ? err.message : String(err)}\n` +
      'Restore scripts/lib/gate-evidence.mjs (arbiter emits it) and re-run the gate.\n',
  )
}

// head_sha alone lets a marker from a sibling worktree, a changed lockfile or an
// hours-old run open a PR. Every identity axis is checked here, against the
// worktree the PR actually targets, and every one fails closed.
const verdict = gateEvidence.verifyGateEvidence(marker, {
  root: repoRoot,
  minLevel: 'L2',
  maxAgeMin:
    Number(process.env.ARBITER_EVIDENCE_MAX_AGE_MIN) || gateEvidence.GATE_EVIDENCE_DEFAULT_TTL_MIN,
})

if (!verdict.ok) {
  await exitAfterStderr(
    2,
    `[arbiter] GATE GUARD: gate-pass.json is stale or does not bind this checkout${rootNote}.\n` +
      `${verdict.reason}\n` +
      'Run `node scripts/check-all.mjs preflight` for a local diagnostic, or `node scripts/ci-receipt.mjs` to record the CI verdict for HEAD.\n',
  )
}
