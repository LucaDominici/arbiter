#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/pr-merge-watch.mjs (#2098) — reusable merge-on-green PR watcher.
//
// Root cause fixed: a hand-rolled bash "poll PR checks, merge on green"
// watcher was rewritten inline ~6 times in one night. Its first version's
// green-check (`^OPEN\|SUCCESS$` exact match) silently stalled two fully
// green PRs for 7+ minutes because real PRs carry legitimate SKIPPED
// checks. This script can only end three ways: merged (0), a real red check
// (1), or an explicit timeout (2) — never a silent infinite loop.
//
// Usage: pr-merge-watch <owner/repo> <pr-number> [--timeout-min 90] [--interval-sec 30]
//        pr-merge-watch --self-test   (pure predicate fixtures, no `gh` calls)
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HARD_FAIL = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
])
const GREEN_OK = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])

/**
 * Green/hard-fail/pending predicate over a PR's `statusCheckRollup`.
 * - 'hard-fail' wins even if OTHER checks are still pending — a real red
 *   check must stop the watcher immediately, not wait out the stragglers.
 * - 'green' requires a NON-EMPTY rollup where every conclusion is in
 *   {SUCCESS, SKIPPED, NEUTRAL} — an empty conclusion ('') means the check
 *   is still queued/in-progress, which is 'pending', not 'green'.
 * @param {Array<{conclusion: string}>} rollup
 * @returns {'green'|'hard-fail'|'pending'}
 */
export function classify(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'pending'
  if (rollup.some((c) => HARD_FAIL.has(c.conclusion))) return 'hard-fail'
  return rollup.every((c) => GREEN_OK.has(c.conclusion)) ? 'green' : 'pending'
}

/**
 * Merge method preference: squash > rebase > merge-commit, restricted to
 * what the repo's branch-protection settings actually allow.
 * @param {{squash: boolean, rebase: boolean, merge: boolean}} flags
 * @returns {'squash'|'rebase'|'merge'|null}
 */
export function pickMergeMethod(flags) {
  if (flags.squash) return 'squash'
  if (flags.rebase) return 'rebase'
  if (flags.merge) return 'merge'
  return null
}

const SELF_TEST_FIXTURES = [
  // The exact set that stalled tonight's hand-rolled watchers (#2098).
  { name: '{SKIPPED,SUCCESS} is green', conclusions: ['SKIPPED', 'SUCCESS'], expected: 'green' },
  {
    name: 'all-SKIPPED is green (edge case)',
    conclusions: ['SKIPPED', 'SKIPPED'],
    expected: 'green',
  },
  {
    name: 'one FAILURE among otherwise-green checks is hard-fail',
    conclusions: ['SUCCESS', 'FAILURE', 'SKIPPED'],
    expected: 'hard-fail',
  },
  {
    name: 'an empty-string (pending) conclusion is not-yet-green',
    conclusions: ['SUCCESS', ''],
    expected: 'pending',
  },
]

function runSelfTest() {
  let failures = 0
  for (const { name, conclusions, expected } of SELF_TEST_FIXTURES) {
    const rollup = conclusions.map((conclusion) => ({ conclusion }))
    const got = classify(rollup)
    const ok = got === expected
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name} (expected ${expected}, got ${got})\n`)
    if (!ok) failures++
  }
  return failures === 0 ? 0 : 1
}

function parseArgs(argv) {
  let timeoutMin = 90
  let intervalSec = 30
  let selfTest = false
  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--self-test') {
      selfTest = true
    } else if (a === '--timeout-min') {
      timeoutMin = Number(argv[++i])
    } else if (a === '--interval-sec') {
      intervalSec = Number(argv[++i])
    } else {
      positionals.push(a)
    }
  }
  const [ownerRepo, prNumber] = positionals
  return { ownerRepo, prNumber, timeoutMin, intervalSec, selfTest }
}

function ghJson(args) {
  const out = execFileSync('gh', args, { encoding: 'utf-8', timeout: 30_000 })
  return JSON.parse(out)
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms))
}

/** Green path: pick the repo's preferred merge method and merge, or exit 1 if none is allowed. */
function mergeAndExit(ownerRepo, prNumber) {
  const flags = ghJson([
    'api',
    `repos/${ownerRepo}`,
    '--jq',
    '{squash:.allow_squash_merge,rebase:.allow_rebase_merge,merge:.allow_merge_commit}',
  ])
  const method = pickMergeMethod(flags)
  if (!method) {
    process.stderr.write(`pr-merge-watch: repo allows no merge method: ${JSON.stringify(flags)}\n`)
    process.exit(1)
  }
  process.stdout.write(`pr-merge-watch: green — merging PR #${prNumber} via --${method}\n`)
  execFileSync(
    'gh',
    ['pr', 'merge', String(prNumber), '-R', ownerRepo, '--admin', '--delete-branch', `--${method}`],
    { stdio: 'inherit' },
  )
  process.exit(0)
}

/**
 * `gh pr view`, retrying on transient failure — bounded by the SAME deadline as
 * everything else, so a flaky `gh` can never loop forever either. Extracted out of
 * main() to keep main()'s own branching under the complexity ratchet (#2098).
 */
async function fetchRollupWithRetry(ownerRepo, prNumber, deadline, intervalSec, timeoutMin) {
  for (;;) {
    try {
      const view = ghJson([
        'pr',
        'view',
        String(prNumber),
        '-R',
        ownerRepo,
        '--json',
        'state,statusCheckRollup',
      ])
      return view.statusCheckRollup ?? []
    } catch (e) {
      process.stderr.write(`pr-merge-watch: gh pr view failed, retrying: ${e.message}\n`)
      if (Date.now() >= deadline) {
        process.stderr.write(
          `pr-merge-watch: timeout after ${timeoutMin}min (gh pr view kept failing)\n`,
        )
        process.exit(2)
      }
      await sleep(intervalSec * 1000)
    }
  }
}

async function main() {
  const { ownerRepo, prNumber, timeoutMin, intervalSec, selfTest } = parseArgs(
    process.argv.slice(2),
  )

  if (selfTest) {
    process.exit(runSelfTest())
  }

  if (!ownerRepo || !prNumber) {
    process.stderr.write(
      'usage: pr-merge-watch <owner/repo> <pr-number> [--timeout-min 90] [--interval-sec 30]\n' +
        '       pr-merge-watch --self-test\n',
    )
    process.exit(2)
  }

  const deadline = Date.now() + timeoutMin * 60_000
  for (;;) {
    const rollup = await fetchRollupWithRetry(
      ownerRepo,
      prNumber,
      deadline,
      intervalSec,
      timeoutMin,
    )
    const status = classify(rollup)

    if (status === 'hard-fail') {
      process.stderr.write(
        `pr-merge-watch: hard-fail — a check reported a red conclusion:\n${JSON.stringify(rollup, null, 2)}\n`,
      )
      process.exit(1)
    }

    if (status === 'green') {
      mergeAndExit(ownerRepo, prNumber)
    }

    if (Date.now() >= deadline) {
      process.stderr.write(
        `pr-merge-watch: timeout after ${timeoutMin}min, no green/hard-fail:\n${JSON.stringify(rollup, null, 2)}\n`,
      )
      process.exit(2)
    }

    await sleep(intervalSec * 1000)
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((e) => {
    process.stderr.write(`pr-merge-watch: unexpected error: ${e.stack ?? e}\n`)
    process.exit(1)
  })
}
