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

function ciRuns(root, sha) {
  const output = run(
    'gh',
    ['run', 'list', '--commit', sha, '--json', 'conclusion,url,status,name'],
    root,
  )
  const parsed = JSON.parse(output)
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('no CI runs found')
  return parsed
}

function isSuccessfulRun(run) {
  return run?.status === 'completed' && run?.conclusion === 'success'
}

function successfulRuns(runs) {
  return runs.filter((run) => run?.conclusion !== 'skipped')
}

function receiptFor(sha, runs) {
  const required = successfulRuns(runs)
  if (required.length === 0 || !required.every(isSuccessfulRun)) {
    throw new Error('one or more non-skipped CI runs are not completed successfully')
  }
  const runUrl = required.find((run) => typeof run?.url === 'string' && run.url.length > 0)?.url
  if (runUrl === undefined) throw new Error('successful CI run has no URL')
  return { sha, conclusion: 'success', runUrl, checkedAt: new Date().toISOString() }
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
    const receipt = receiptFor(sha, ciRuns(root, sha))
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
