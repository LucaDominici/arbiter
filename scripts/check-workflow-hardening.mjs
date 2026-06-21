#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-76/INV-95 enforcement. Audits GitHub Actions hardening posture across
// CATALOG:   .github/workflows/*.yml and emits a deterministic JSON report consumed by the
// CATALOG:   gold-audit D-ACTIONS dimension (value report-metric). Gated metrics (fail the gate
// CATALOG:   when > 0): unpinnedActions (non-40-hex `uses:` ref), workflowsMissingPermissions
// CATALOG:   (no top-level `permissions:`), prPushWorkflowsMissingConcurrency (a pull_request/push
// CATALOG:   triggered workflow with no `concurrency:`). Visibility-only metric (reported, NOT
// CATALOG:   gated in this phase): jobsMissingTimeout (numbered-tier jobs lacking timeout-minutes,
// CATALOG:   tracked for the timeout-hardening follow-up).
// CATALOG: Rejected fold-in into check-action-pins.mjs (single-axis SHA-pin transition gate) and
// CATALOG:   check-workflow-parallelism.mjs (needs-chain depth, different axis): this gate owns the
// CATALOG:   multi-axis hardening report + the gold-audit value-report contract.
//
// Static rendered-file scanning: scans .github/workflows/*.yml (what actually runs in CI).
// Reuses scripts/lib/workflow-scan.mjs (collectYamlFiles) — no duplicated walker (CANON-16).
//
// Exit codes per INV-53: 0=PASS, 1=FAIL (a gated metric > 0), 2=ERROR.
// Usage: node scripts/check-workflow-hardening.mjs [--dir <path>] [--out <report.json>] [--help]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, basename, join, resolve } from 'node:path'

import { collectYamlFiles } from './lib/workflow-scan.mjs'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-workflow-hardening.mjs [options]',
      '',
      'Audits GitHub Actions hardening (SHA-pinning, least-privilege permissions,',
      'concurrency on PR/push workflows) and emits a JSON report for the gold-audit',
      'D-ACTIONS dimension.',
      '',
      'Options:',
      '  --dir <path>   Repo root to scan (default: cwd). Scans <dir>/.github/workflows.',
      '  --out <path>   Report output path (default: .arbiter/reports/workflow-hardening.json).',
      '  --help, -h     Show this help and exit.',
      '',
      'Exit codes: 0=PASS, 1=FAIL (a gated metric > 0), 2=ERROR.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

function flagValue(name) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : null
}

const ROOT = flagValue('--dir') ? resolve(flagValue('--dir')) : process.cwd()
const OUT = resolve(
  flagValue('--out') ?? join(ROOT, '.arbiter', 'reports', 'workflow-hardening.json'),
)
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows')

/** A 40-hex commit SHA is the only acceptable pin for a remote action ref. */
const SHA40 = /^[0-9a-f]{40}$/

/**
 * Count unpinned `uses:` references in a workflow. A `uses:` step key whose ref (the part after the
 * last `@`) is not a 40-hex SHA is unpinned; a local action (`./…`) needs no pin. Only real YAML
 * `uses:` keys are matched (`^<indent>[- ]?uses:`), never a `uses:` substring inside a run-block
 * shell string (those lines start with the shell command, not `uses:`).
 */
function countUnpinned(lines) {
  let count = 0
  for (const line of lines) {
    const m = /^\s*-?\s*uses:\s*(\S+)/.exec(line)
    if (m === null) continue
    const ref = m[1]
    if (ref.startsWith('./') || ref.startsWith('../')) continue // local action — no pin needed
    const at = ref.lastIndexOf('@')
    if (at < 0 || !SHA40.test(ref.slice(at + 1))) count++
  }
  return count
}

/** True if the workflow declares a top-level `permissions:` key (least-privilege baseline). */
function hasTopLevelPermissions(lines) {
  return lines.some((l) => /^permissions:/.test(l))
}

/** True if the workflow declares a top-level `concurrency:` key. */
function hasConcurrency(lines) {
  return lines.some((l) => /^concurrency:/.test(l))
}

/**
 * True if the workflow is triggered by `pull_request` or `push` (exact event keys — NOT
 * `pull_request_review`/`pull_request_target`). Handles the block form (`on:` then indented
 * `pull_request:`/`push:`) and the inline forms (`on: push`, `on: [push, pull_request]`).
 */
function isPrPushTriggered(content) {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const inline = /^on:\s*(\S.*)$/.exec(line)
    if (inline) {
      return /\b(pull_request|push)\b/.test(inline[1].replace(/pull_request_\w+/g, ''))
    }
    if (/^on:\s*$/.test(line)) {
      for (let j = i + 1; j < lines.length; j++) {
        const sub = lines[j]
        if (/^\S/.test(sub)) break // dedent to column 0 ends the on: block
        if (/^\s+(pull_request|push):/.test(sub)) return true
      }
      return false
    }
  }
  return false
}

/**
 * Count numbered-tier jobs (files matching `0N-*.yml`) that lack `timeout-minutes`. A job whose
 * body is a reusable-workflow call (job-level `uses:`) is exempt — GitHub forbids timeout-minutes
 * there. Visibility-only: reported, not gated, until the timeout-hardening follow-up.
 */
function countJobsMissingTimeout(file, lines) {
  if (!/^0\d-/.test(basename(file))) return 0
  let inJobs = false
  let inJob = false
  let jobHasTimeout = false
  let jobIsReusable = false
  let missing = 0
  const closeJob = () => {
    if (inJob && !jobIsReusable && !jobHasTimeout) missing++
  }
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true
      continue
    }
    if (!inJobs) continue
    if (/^\S/.test(line) && line.trim() !== '') {
      closeJob()
      inJob = false
      break
    }
    if (/^  [A-Za-z][A-Za-z0-9_-]*:/.test(line)) {
      closeJob()
      inJob = true
      jobHasTimeout = false
      jobIsReusable = false
      continue
    }
    if (!inJob) continue
    if (/^    timeout-minutes:/.test(line)) jobHasTimeout = true
    if (/^    uses:/.test(line)) jobIsReusable = true
  }
  closeJob()
  return missing
}

function main() {
  const files = collectYamlFiles(WORKFLOW_DIR).sort()
  const metrics = {
    workflows: files.length,
    unpinnedActions: 0,
    workflowsMissingPermissions: 0,
    prPushWorkflowsMissingConcurrency: 0,
    jobsMissingTimeout: 0,
  }
  const violations = []
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const lines = content.split('\n')
    const rel = file.slice(ROOT.length + 1)

    const unpinned = countUnpinned(lines)
    if (unpinned > 0) {
      metrics.unpinnedActions += unpinned
      violations.push(`${rel}: ${unpinned} unpinned action ref(s)`)
    }
    if (!hasTopLevelPermissions(lines)) {
      metrics.workflowsMissingPermissions++
      violations.push(`${rel}: no top-level permissions block`)
    }
    if (isPrPushTriggered(content) && !hasConcurrency(lines)) {
      metrics.prPushWorkflowsMissingConcurrency++
      violations.push(`${rel}: pull_request/push workflow without concurrency`)
    }
    metrics.jobsMissingTimeout += countJobsMissingTimeout(file, lines)
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(metrics, null, 2) + '\n')

  const gated =
    metrics.unpinnedActions +
    metrics.workflowsMissingPermissions +
    metrics.prPushWorkflowsMissingConcurrency
  if (gated > 0) {
    process.stdout.write(
      `  check-workflow-hardening: ${gated} hardening violation(s):\n` +
        violations.map((v) => `    - ${v}`).join('\n') +
        `\n  report: ${OUT.slice(ROOT.length + 1)}\n`,
    )
    return 1
  }
  process.stdout.write(
    `  check-workflow-hardening: ${metrics.workflows} workflow(s) hardened ` +
      `(pins ✓, permissions ✓, concurrency ✓; ${metrics.jobsMissingTimeout} job(s) without ` +
      `timeout-minutes — tracked follow-up)\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(`  check-workflow-hardening: ERROR ${err?.message ?? err}\n`)
  process.exit(2)
}
