#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Historical recall backtest for plan-time gate derivation (#2773).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deriveGatesForFiles } from './lib/gate-derivation.mjs'
import { GATE_AFFECTS_REGISTRY } from './lib/gate-affects-registry.mjs'
import { walkRepo } from './lib/glob-walk.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const GATE_NAMES = GATE_AFFECTS_REGISTRY.map(({ name }) => name)

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
}

function ghJson(args) {
  return JSON.parse(gh(args))
}

export function extractGateFailures(log, gateNames = GATE_NAMES) {
  const jsonFailures = new Set()
  try {
    const parsed = JSON.parse(log)
    for (const gate of parsed?.gates ?? []) {
      if (gate?.status === 'FAIL' || gate?.status === 'TIMEOUT') jsonFailures.add(gate.name)
    }
    // FAIL-OPEN-INTENT: console logs are the normal CI source; JSON is only the optional local gate-result shape, and the exact-name text parser below still runs.
  } catch {
    // Not JSON: continue with the console-log parser.
  }
  return gateNames.filter((name) => {
    if (jsonFailures.has(name)) return true
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(
      `(?:\\[CHECK\\]\\s+${escaped}\\s+\\.\\.\\.\\s+FAIL|^- ${escaped} \\(FAIL\\)$)`,
      'm',
    ).test(log)
  })
}

export function computeRecall(rows) {
  let actualFailures = 0
  let predictedFailures = 0
  for (const row of rows) {
    const predicted = new Set(row.predicted)
    for (const failure of new Set(row.observed)) {
      actualFailures++
      if (predicted.has(failure)) predictedFailures++
    }
  }
  return {
    actualFailures,
    predictedFailures,
    recall: actualFailures === 0 ? null : (predictedFailures / actualFailures) * 100,
  }
}

function localEvidenceLogs(root, shas) {
  const evidence = resolve(root, '.arbiter/evidence')
  if (!existsSync(evidence)) return []
  const logs = []
  for (const relative of walkRepo(evidence)) {
    const body = readFileSync(resolve(evidence, relative), 'utf8')
    const shaBound = shas.some((sha) => sha && (relative.includes(sha) || body.includes(sha)))
    const gateLog =
      body.includes('=== arbiter Quality Gate') || /"schema"\s*:\s*"arbiter-gate-v1"/.test(body)
    if (body.length <= 2_000_000 && shaBound && gateLog) logs.push(body)
  }
  return logs
}

function observedFailures(root, pr) {
  const shas = [pr.headRefOid, pr.mergeCommit?.oid].filter(Boolean)
  const localLogs = localEvidenceLogs(root, shas)
  if (localLogs.length > 0) {
    return {
      source: 'local-evidence',
      observed: [...new Set(localLogs.flatMap((log) => extractGateFailures(log)))],
      unresolvedFailedRuns: [],
    }
  }

  const sha = pr.headRefOid ?? pr.mergeCommit?.oid
  if (!sha) throw new Error(`PR #${pr.number} has no head or merge commit`)
  const runs = ghJson([
    'run',
    'list',
    '--commit',
    sha,
    '--limit',
    '100',
    '--json',
    'databaseId,conclusion,name',
  ])
  const failures = runs.filter(({ conclusion }) => conclusion === 'failure')
  const observed = new Set()
  const unresolvedFailedRuns = []
  for (const run of failures) {
    const log = gh(['run', 'view', String(run.databaseId), '--log-failed'])
    const names = extractGateFailures(log)
    if (names.length === 0) unresolvedFailedRuns.push({ id: run.databaseId, name: run.name })
    for (const name of names) observed.add(name)
  }
  return { source: 'ci', observed: [...observed], unresolvedFailedRuns }
}

export function runBacktest(root = process.cwd()) {
  const prs = ghJson([
    'pr',
    'list',
    '--state',
    'merged',
    '--limit',
    '30',
    '--json',
    'number,mergeCommit,headRefOid,files',
  ])
  if (!Array.isArray(prs) || prs.length < 20 || prs.length > 30) {
    throw new Error(
      `expected 20-30 merged PRs, received ${Array.isArray(prs) ? prs.length : 'invalid JSON'}`,
    )
  }
  const rows = prs.map((pr) => {
    const files = pr.files.map((file) => file.path)
    const predicted = deriveGatesForFiles(files).map(({ name }) => name)
    return { pr: pr.number, files, predicted, ...observedFailures(root, pr) }
  })
  return {
    generatedAt: new Date().toISOString(),
    sampleSize: rows.length,
    ...computeRecall(rows),
    rows,
  }
}

if (isMainModule(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(runBacktest(), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(
      `backtest-gate-derivation: ERROR — ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 2
  }
}
