#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Record the GitHub Actions verdict for the current HEAD. CI is the authority for
// the full gate; this receipt only binds that verdict to the local checkout SHA.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const COMMAND_TIMEOUT_MS = 10_000

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    shell: false,
    timeout: COMMAND_TIMEOUT_MS,
  })
  if (result.status !== 0) {
    throw new Error(result.error?.message ?? `${command} exited with ${result.status}`)
  }
  return result.stdout
}

function currentHead(root) {
  const sha = run('git', ['rev-parse', 'HEAD'], root).trim()
  if (sha.length === 0) throw new Error('HEAD could not be resolved')
  return sha
}

function currentPullRequest(root, sha) {
  const pr = JSON.parse(run('gh', ['pr', 'view', '--json', 'number,headRefOid,url'], root))
  if (pr?.headRefOid !== sha) throw new Error('pull request does not target current HEAD')
  if (!Number.isInteger(pr?.number) || typeof pr?.url !== 'string') {
    throw new Error('current pull request is missing identity')
  }
  return pr
}

function requiredChecks(root, prNumber) {
  const checks = JSON.parse(
    run(
      'gh',
      [
        'pr',
        'checks',
        String(prNumber),
        '--required',
        '--json',
        'name,state,link,bucket,workflow,startedAt,completedAt',
      ],
      root,
    ),
  )
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('no required CI checks found')
  if (
    !checks.every(
      (check) =>
        check?.bucket === 'pass' &&
        check?.state === 'SUCCESS' &&
        typeof check?.startedAt === 'string' &&
        typeof check?.completedAt === 'string',
    )
  ) {
    throw new Error('one or more required CI checks are not successful')
  }
  return checks.map(({ name, state, workflow, link, startedAt, completedAt }) => ({
    name,
    state,
    workflow,
    link,
    startedAt,
    completedAt,
  }))
}

function receiptFor(sha, pr, checks) {
  const runUrl = checks.find(
    (check) => typeof check.link === 'string' && check.link.length > 0,
  )?.link
  if (runUrl === undefined) throw new Error('successful required CI check has no URL')
  return {
    schema: 'arbiter-ci-pass-v2',
    sha,
    conclusion: 'success',
    runUrl,
    checkedAt: new Date().toISOString(),
    pr: pr.number,
    requiredChecks: checks,
  }
}

function writeReceipt(root, receipt) {
  const arbiterDir = join(root, '.arbiter')
  const path = join(arbiterDir, 'ci-pass.json')
  const temporary = `${path}.${process.pid}.tmp`
  mkdirSync(arbiterDir, { recursive: true })
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8')
  renameSync(temporary, path)
}

function main() {
  const root = process.cwd()
  try {
    const sha = currentHead(root)
    const pr = currentPullRequest(root, sha)
    const receipt = receiptFor(sha, pr, requiredChecks(root, pr.number))
    writeReceipt(root, receipt)
    process.stdout.write(`CI receipt recorded for ${sha}\n`)
  } catch (error) {
    process.stderr.write(
      `ci-receipt: NO DATA — ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 2
  }
}

main()
