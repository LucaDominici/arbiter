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
import { resolveLandingContract, validateLiveExactShaPolicy } from './lib/exact-sha-policy.mjs'

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

const HARD_FAIL_HELP = [
  'Fix the root cause, push, and re-run this watcher — the PR is owned until merged.',
  'Do not abandon an open PR with red CI, and do not paper over the check.',
]

/**
 * #2402 — the actionable block a red watcher exit prints.
 *
 * A bare rollup dump told the reader THAT something failed and nothing about what to do next, so
 * red PRs were abandoned rather than driven. This names each failing check and hands over the
 * exact command that pulls its job log: `detailsUrl` from the rollup ends in `/job/<id>` for a
 * GitHub Actions check, which is what `gh run view --job` wants. Checks whose id cannot be
 * recovered fall back to `gh pr checks`, so every failing check still gets a next step.
 *
 * @param {Array<{conclusion?: string, name?: string, context?: string, detailsUrl?: string}>} rollup
 * @param {string|number} prNumber
 * @returns {string}
 */
export function buildHardFailReport(rollup, prNumber) {
  const failing = (Array.isArray(rollup) ? rollup : []).filter((c) => HARD_FAIL.has(c.conclusion))
  const lines = [
    `pr-merge-watch: hard-fail — ${failing.length} check(s) reported a red conclusion:`,
  ]
  for (const check of failing) {
    const name = check.name ?? check.context ?? '(unnamed check)'
    const jobId = jobIdFrom(check.detailsUrl)
    lines.push(`  - ${name} (${check.conclusion})`)
    lines.push(
      jobId === null
        ? `      log: gh pr checks ${prNumber} --json name,link   # then open the link for "${name}"`
        : `      log: gh run view --job ${jobId} --log`,
    )
  }
  if (failing.length === 0) {
    lines.push('  (no check carried a hard-fail conclusion — re-read the rollup)')
  }
  return [...lines, ...HARD_FAIL_HELP.map((l) => `  ${l}`)].join('\n')
}

/**
 * The Actions job id inside a check's `detailsUrl`, or null when the URL is absent or belongs to
 * a non-Actions check (an external status has no job to pull).
 * @param {string|undefined} detailsUrl
 * @returns {string|null}
 */
function jobIdFrom(detailsUrl) {
  const match = /\/job\/(\d+)/.exec(detailsUrl ?? '')
  return match ? match[1] : null
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

const HARD_FAIL_REPORT_FIXTURES = [
  {
    name: 'a failing Actions check yields its gh run view command',
    rollup: [
      { name: 'CI Required', conclusion: 'SUCCESS' },
      {
        name: 'Docs Build',
        conclusion: 'FAILURE',
        detailsUrl: 'https://github.com/o/r/actions/runs/1/job/42',
      },
    ],
    expect: ['Docs Build (FAILURE)', 'gh run view --job 42 --log'],
  },
  {
    name: 'a check with no job id falls back to gh pr checks',
    rollup: [{ context: 'external/status', conclusion: 'TIMED_OUT' }],
    expect: ['external/status (TIMED_OUT)', 'gh pr checks 7 --json name,link'],
  },
  {
    name: 'the ownership rule is always printed',
    rollup: [{ name: 'X', conclusion: 'CANCELLED' }],
    expect: ['owned until merged'],
  },
]

function runHardFailReportSelfTest() {
  let failures = 0
  for (const { name, rollup, expect: expected } of HARD_FAIL_REPORT_FIXTURES) {
    const report = buildHardFailReport(rollup, 7)
    const missing = expected.filter((needle) => !report.includes(needle))
    const ok = missing.length === 0
    const detail = ok ? '' : ` (missing: ${missing.join(', ')})`
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail}\n`)
    if (!ok) failures++
  }
  return failures
}

function runSelfTest() {
  let failures = 0
  for (const { name, conclusions, expected } of SELF_TEST_FIXTURES) {
    const rollup = conclusions.map((conclusion) => ({ conclusion }))
    const got = classify(rollup)
    const ok = got === expected
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name} (expected ${expected}, got ${got})\n`)
    if (!ok) failures++
  }
  failures += runHardFailReportSelfTest()
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

/**
 * #2150 — mode-aware fail-closed gate, evaluated BEFORE the first `gh` invocation.
 *
 * The watcher no longer decides the mode itself: it asks the single landing contract
 * in scripts/lib/exact-sha-policy.mjs. An unknown, absent or malformed mode, and both
 * declared-but-unsupported arcs, refuse here — nothing about the repository is read
 * on an arc that cannot land the exact gated SHA.
 */
function assertLandingSupported() {
  let config
  try {
    config = JSON.parse(readFileSync('arbiter.json', 'utf8'))
  } catch (error) {
    process.stderr.write(`pr-merge-watch: cannot read arbiter.json: ${error.message}\n`)
    process.exit(2)
  }
  const decision = resolveLandingContract(config)
  if (!decision.supported) {
    process.stderr.write(`pr-merge-watch: exact-SHA landing refused — ${decision.reason}\n`)
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

async function verifyMain(ownerRepo, expectedHead, deadline, intervalSec, timeoutMin) {
  for (;;) {
    const mainRef = ghJson(['api', `repos/${ownerRepo}/git/ref/heads/main`])
    if (mainRef?.object?.sha === expectedHead) return
    if (Date.now() >= deadline) {
      process.stderr.write(
        `pr-merge-watch: ERROR — main did not equal the gated head within ${timeoutMin}min after updateRefs\n`,
      )
      process.exit(2)
    }
    await sleep(intervalSec * 1000)
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
  await verifyMain(ownerRepo, current.headRefOid, deadline, intervalSec, timeoutMin)
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
  assertLandingSupported()

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
      process.stderr.write(`${buildHardFailReport(rollup, prNumber)}\n`)
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
