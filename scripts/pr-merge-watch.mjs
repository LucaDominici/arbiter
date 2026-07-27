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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateLiveExactShaPolicy } from './lib/exact-sha-policy.mjs'

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
 * @param {Array<{conclusion: string, name?: string, context?: string}>} rollup
 * @param {string[]} required
 * @returns {'green'|'hard-fail'|'pending'}
 */
export function classify(rollup, required = []) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'pending'
  if (rollup.some((c) => HARD_FAIL.has(c.conclusion))) return 'hard-fail'
  const names = new Set(rollup.map((check) => check.name ?? check.context).filter(Boolean))
  if (required.some((name) => !names.has(name))) return 'pending'
  return rollup.every((c) => GREEN_OK.has(c.conclusion)) ? 'green' : 'pending'
}

/**
 * Fail-closed guard between the checked PR snapshot and the atomic promotion.
 * @param {Record<string, unknown>} checked
 * @param {Record<string, unknown>} current
 * @returns {string|null}
 */
export function validatePromotion(checked, current) {
  const checks = [
    [checked.state !== 'OPEN' || current.state !== 'OPEN', 'PR is not OPEN'],
    [
      checked.isCrossRepository || current.isCrossRepository,
      'cross-repository PRs cannot use exact-SHA promotion',
    ],
    [checked.isDraft || current.isDraft, 'draft PR cannot be promoted'],
    [checked.mergeable !== 'MERGEABLE' || current.mergeable !== 'MERGEABLE', 'PR is not mergeable'],
    [checked.headRefOid !== current.headRefOid, 'head SHA changed after checks went green'],
    [checked.baseRefOid !== current.baseRefOid, 'base SHA changed after checks went green'],
    [checked.headRefName !== current.headRefName, 'head ref changed after checks went green'],
    [checked.baseRefName !== current.baseRefName, 'base ref changed after checks went green'],
    [!/^[0-9a-f]{40}$/.test(String(current.headRefOid)), 'head SHA is invalid'],
    [!/^[0-9a-f]{40}$/.test(String(current.baseRefOid)), 'base SHA is invalid'],
    [current.baseRefName !== 'main', 'base ref is not main'],
  ]
  return checks.find(([failed]) => failed)?.[1] ?? null
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

function ghJson(args, input) {
  const out = execFileSync('gh', args, {
    encoding: 'utf-8',
    timeout: 30_000,
    ...(input === undefined ? {} : { input: JSON.stringify(input) }),
  })
  return JSON.parse(out)
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms))
}

function fetchPr(ownerRepo, prNumber) {
  return ghJson([
    'pr',
    'view',
    String(prNumber),
    '-R',
    ownerRepo,
    '--json',
    'state,statusCheckRollup,headRefOid,baseRefOid,baseRefName,headRefName,isCrossRepository,isDraft,mergeable',
  ])
}

function assertSoloPrFf() {
  let config
  try {
    config = JSON.parse(readFileSync('arbiter.json', 'utf8'))
  } catch (error) {
    process.stderr.write(`pr-merge-watch: cannot read arbiter.json: ${error.message}\n`)
    process.exit(2)
  }
  if (config.collaborationMode !== 'trunk-solo' || config.solo?.mergeMode !== 'pr-ff') {
    process.stderr.write('pr-merge-watch: exact-SHA promotion requires trunk-solo + pr-ff\n')
    process.exit(1)
  }
}

const UPDATE_REFS_MUTATION = `mutation PromoteExactSha(
  $repositoryId: ID!,
  $refUpdates: [RefUpdate!]!
) {
  updateRefs(input: {repositoryId: $repositoryId, refUpdates: $refUpdates}) {
    clientMutationId
  }
}`

function readPromotionPolicy(ownerRepo) {
  const repository = ghJson(['api', `repos/${ownerRepo}`])
  const repositoryId = repository.node_id
  if (!repositoryId) {
    process.stderr.write('pr-merge-watch: repository node ID is missing\n')
    process.exit(2)
  }
  const protection = ghJson(['api', `repos/${ownerRepo}/branches/main/protection`])
  const policyErrors = validateLiveExactShaPolicy(repository, protection)
  if (policyErrors.length > 0) {
    process.stderr.write(
      `pr-merge-watch: live INV-101 policy drift:\n${policyErrors.map((e) => `- ${e}`).join('\n')}\n`,
    )
    process.exit(1)
  }
  return repositoryId
}

function buildRefUpdates(current) {
  return [
    {
      name: `refs/heads/${current.baseRefName}`,
      beforeOid: current.baseRefOid,
      afterOid: current.headRefOid,
      force: false,
    },
    {
      name: `refs/heads/${current.headRefName}`,
      beforeOid: current.headRefOid,
      afterOid: current.headRefOid,
      force: false,
    },
  ]
}

function updateRefs(repositoryId, refUpdates) {
  process.stdout.write(
    `pr-merge-watch: green — atomically promoting exact SHA ${refUpdates[0].afterOid} (force=false)\n`,
  )
  try {
    const response = ghJson(['api', 'graphql', '--input', '-'], {
      query: UPDATE_REFS_MUTATION,
      variables: { repositoryId, refUpdates },
    })
    if (!response?.data?.updateRefs) throw new Error('updateRefs returned no success payload')
  } catch (error) {
    process.stderr.write(`pr-merge-watch: exact-SHA promotion failed: ${error.message}\n`)
    process.exit(1)
  }
}

function verifyMain(ownerRepo, expectedHead) {
  const mainRef = ghJson(['api', `repos/${ownerRepo}/git/ref/heads/main`])
  if (mainRef?.object?.sha !== expectedHead) {
    process.stderr.write(
      'pr-merge-watch: ERROR — main does not equal the gated head after updateRefs\n',
    )
    process.exit(2)
  }
}

async function verifyMerged(ownerRepo, prNumber, expectedHead, deadline, intervalSec, timeoutMin) {
  for (;;) {
    const verified = fetchPr(ownerRepo, prNumber)
    if (verified.state === 'MERGED' && verified.headRefOid === expectedHead) {
      process.stdout.write(`pr-merge-watch: merged PR #${prNumber}; main=${expectedHead}\n`)
      process.exit(0)
    }
    if (Date.now() >= deadline) {
      process.stderr.write(
        `pr-merge-watch: timeout after ${timeoutMin}min verifying GitHub marked PR #${prNumber} MERGED\n`,
      )
      process.exit(2)
    }
    await sleep(intervalSec * 1000)
  }
}

async function promoteExactSha(ownerRepo, prNumber, checked, deadline, intervalSec, timeoutMin) {
  const current = fetchPr(ownerRepo, prNumber)
  const rejection = validatePromotion(checked, current)
  if (rejection) {
    process.stderr.write(`pr-merge-watch: promotion rejected — ${rejection}\n`)
    process.exit(1)
  }
  const repositoryId = readPromotionPolicy(ownerRepo)
  updateRefs(repositoryId, buildRefUpdates(current))
  verifyMain(ownerRepo, current.headRefOid)
  await verifyMerged(ownerRepo, prNumber, current.headRefOid, deadline, intervalSec, timeoutMin)
}

/**
 * `gh pr view`, retrying on transient failure — bounded by the SAME deadline as
 * everything else, so a flaky `gh` can never loop forever either. Extracted out of
 * main() to keep main()'s own branching under the complexity ratchet (#2098).
 */
async function fetchRollupWithRetry(ownerRepo, prNumber, deadline, intervalSec, timeoutMin) {
  for (;;) {
    try {
      return fetchPr(ownerRepo, prNumber)
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
  assertSoloPrFf()

  const deadline = Date.now() + timeoutMin * 60_000
  for (;;) {
    const snapshot = await fetchRollupWithRetry(
      ownerRepo,
      prNumber,
      deadline,
      intervalSec,
      timeoutMin,
    )
    const rollup = snapshot.statusCheckRollup ?? []
    const status = classify(rollup, ['CI Required'])

    if (status === 'hard-fail') {
      process.stderr.write(
        `pr-merge-watch: hard-fail — a check reported a red conclusion:\n${JSON.stringify(rollup, null, 2)}\n`,
      )
      process.exit(1)
    }

    if (status === 'green') {
      await promoteExactSha(ownerRepo, prNumber, snapshot, deadline, intervalSec, timeoutMin)
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
    process.exit(2)
  })
}
