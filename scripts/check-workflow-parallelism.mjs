#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-120 enforcement. Detects regression in workflow job-needs chains (critical path depth)
// CATALOG:   by parsing .github/workflows/*.yml job `needs:` fields and building a DAG.
// CATALOG:   Longest chain (edge count) must not exceed ARBITER_MAX_NEEDS_CHAIN (default 3) per
// CATALOG:   workflow, with per-workflow overrides for 01-pr-fast (≤3) and nightly/weekly/monthly (≤5).
// CATALOG:   Aggregator sinks (jobs with `if: always()`) are excluded from chain calculation because
// CATALOG:   they are pure status barriers, not wall-clock critical-path contributors.
// CATALOG: Rejected fold-in into check-workflow-runners.mjs (runner drift, different axis) and
// CATALOG:   check-workflow-test-integrity.mjs (test-job naming, not parallelism structure).
//
// Design note: the 01-pr-fast ≤3 override documents a deliberate divergence from the issue-spec
// estimate of ≤2. The template includes a Java Maven path (classify-changes → build-reactor → gate →
// unit-tests = 3 edges) that is the observed maximum under static union-scan (#1231). An override of
// ≤2 would fail on the current templates. Any refactoring to reduce Java Maven to 2 edges is
// out of scope here and should be tracked separately.
//
// Static rendered-file scanning: scans .github/workflows/*.yml (the rendered CI output).
// Template source files (.yml.ejs) are NOT scanned — the gate validates what actually runs in CI.
//
// Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR
// Usage: node scripts/check-workflow-parallelism.mjs [--dir <path>] [--help]

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { collectYamlFiles, parseHelpAndDir } from './lib/workflow-scan.mjs'

const args = process.argv.slice(2)
const { cwd: CWD } = parseHelpAndDir(args, {
  usage: [
    'Usage: node scripts/check-workflow-parallelism.mjs [options]',
    '',
    'Validates that workflow job needs-chains (critical path depth) do not regress.',
    'Scans .github/workflows/*.yml, builds a DAG from needs: fields, and asserts',
    'the longest chain (edge count) does not exceed the configured limit.',
    '',
    'Aggregator sinks (jobs with `if: always()`) are excluded — they are pure',
    'status barriers, not wall-clock critical-path contributors.',
    '',
    'Options:',
    '  --dir <path>               Root directory to scan (default: cwd)',
    '  --help, -h                 Show this help and exit',
    '',
    'Environment:',
    '  ARBITER_MAX_NEEDS_CHAIN    Default chain limit (default: 3)',
    '',
    'Per-workflow overrides (applied by filename prefix):',
    '  01-pr-fast.yml             ≤3 (spec says ≤2 but Java Maven path uses 3 edges)',
    '  05-release.yml             ≤4 (measured: build-superset→cosign-sign→sbom-attest→publish)',
    '  06-nightly*.yml            ≤5',
    '  07-weekly*.yml             ≤5',
    '  08-monthly*.yml            ≤5',
    '',
  ].join('\n'),
})

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_MAX_CHAIN = Number(process.env.ARBITER_MAX_NEEDS_CHAIN ?? '3')

/** Per-filename-prefix overrides. Matched by basename startsWith. */
const FILE_OVERRIDES = {
  '01-pr-fast': 3,
  // 05-release measured chain=4: build-superset→cosign-sign→sbom-attest→publish-package (#1231)
  '05-release': 4,
  '06-nightly': 5,
  '07-weekly': 5,
  '08-monthly': 5,
}

// ─── YAML parsing helpers ────────────────────────────────────────────────────

/**
 * Extract job-level data from a YAML workflow string.
 * Returns a Map of jobName → { needs: string[], alwaysIf: boolean }.
 *
 * Handles both inline and multi-line `needs:` syntax.
 * This is a line-oriented parser (no external YAML library), following the
 * pattern from check-workflow-runners.mjs.
 *
 * @param {string} content YAML file content
 * @returns {Map<string, { needs: string[], alwaysIf: boolean }>}
 */
function parseWorkflowJobs(content) {
  /** @type {Map<string, { needs: string[], alwaysIf: boolean }>} */
  const jobs = new Map()
  const lines = content.split('\n')

  let inJobs = false
  /** @type {string|null} */
  let currentJob = null
  /** @type {string[]} */
  let currentNeeds = []
  let currentAlwaysIf = false
  let inNeedsBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const stripped = line.trimStart()
    const indent = line.length - stripped.length

    if (/^jobs\s*:/.test(line)) {
      inJobs = true
      continue
    }

    if (!inJobs) continue

    // A non-empty, non-comment line at indent 0 after jobs: ends the jobs block
    if (indent === 0 && stripped.length > 0 && !stripped.startsWith('#')) {
      break
    }

    // Job-level key: exactly 2 spaces indent, `job-name:` followed by either
    // nothing (block mapping) or inline content (compact syntax `job-name: { ... }`)
    const jobMatch = /^  ([a-zA-Z][a-zA-Z0-9_-]*):/.exec(line)
    if (jobMatch) {
      if (currentJob !== null) {
        jobs.set(currentJob, { needs: currentNeeds, alwaysIf: currentAlwaysIf })
      }
      currentJob = jobMatch[1]
      currentNeeds = []
      currentAlwaysIf = false
      inNeedsBlock = false

      // Detect if: always() inline (compact format)
      if (/if:\s+always\(\)/.test(line)) {
        currentAlwaysIf = true
      }
      // Parse inline needs in compact form: `  job: { ..., needs: [a, b], ... }`
      const compactNeeds = /needs:\s*\[([^\]]*)\]/.exec(line)
      if (compactNeeds) {
        currentNeeds = compactNeeds[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
      continue
    }

    if (currentJob === null) continue

    // Detect `if: always()` at job level (block format)
    if (/^\s+if:\s+always\(\)/.test(line)) {
      currentAlwaysIf = true
    }

    // Inline needs: [job-a, job-b]
    const inlineNeeds = /^\s+needs:\s*\[([^\]]*)\]/.exec(line)
    if (inlineNeeds) {
      inNeedsBlock = false
      currentNeeds = inlineNeeds[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      continue
    }

    // Single-value inline: needs: job-a
    const singleNeeds = /^\s+needs:\s+([a-zA-Z][a-zA-Z0-9_-]*)\s*$/.exec(line)
    if (singleNeeds) {
      inNeedsBlock = false
      currentNeeds = [singleNeeds[1]]
      continue
    }

    // Multi-line needs block: `    needs:`
    if (/^\s+needs:\s*$/.test(line)) {
      inNeedsBlock = true
      currentNeeds = []
      continue
    }

    // Multi-line needs list items: `      - job-name`
    if (inNeedsBlock) {
      const listItem = /^\s+-\s+([a-zA-Z][a-zA-Z0-9_-]*)/.exec(line)
      if (listItem) {
        currentNeeds.push(listItem[1])
      } else if (stripped.length > 0 && !stripped.startsWith('-') && /^\s+[a-zA-Z]/.test(line)) {
        // Transitioned to another property — end needs block
        inNeedsBlock = false
      }
    }
  }

  // Save last job
  if (currentJob !== null) {
    jobs.set(currentJob, { needs: currentNeeds, alwaysIf: currentAlwaysIf })
  }

  return jobs
}

// ─── DAG analysis ────────────────────────────────────────────────────────────

/**
 * Compute the longest chain (edge count) in the DAG.
 * Aggregator sinks (jobs with if: always()) are excluded before analysis.
 *
 * @param {Map<string, { needs: string[], alwaysIf: boolean }>} jobs
 * @returns {{ length: number, chain: string[] }}
 *   length = edge count (0 = single node, 1 = A→B, etc.)
 *   chain = ordered job names from root to deepest sink
 */
function longestChain(jobs) {
  // Exclude aggregator sinks (if: always() barrier jobs)
  const filtered = new Map([...jobs.entries()].filter(([, v]) => !v.alwaysIf))

  if (filtered.size === 0) return { length: 0, chain: [] }

  /** @type {Map<string, string[]>} */
  const memo = new Map()

  /**
   * @param {string} job
   * @returns {string[]} longest path ending at this job (from root)
   */
  function longestFrom(job) {
    if (memo.has(job)) return /** @type {string[]} */ (memo.get(job))
    const data = filtered.get(job)
    if (!data || data.needs.length === 0) {
      const path = [job]
      memo.set(job, path)
      return path
    }
    let best = [job]
    for (const parent of data.needs) {
      if (!filtered.has(parent)) continue
      const parentPath = longestFrom(parent)
      if (parentPath.length + 1 > best.length) {
        best = [...parentPath, job]
      }
    }
    memo.set(job, best)
    return best
  }

  let globalBest = []
  for (const job of filtered.keys()) {
    const path = longestFrom(job)
    if (path.length > globalBest.length) {
      globalBest = path
    }
  }

  return { length: globalBest.length - 1, chain: globalBest }
}

// ─── Per-workflow limit resolution ───────────────────────────────────────────

/**
 * Resolve the chain limit for a given workflow filename.
 *
 * @param {string} filename Basename of the workflow file
 * @returns {number}
 */
function limitForFile(filename) {
  const base = basename(filename)
  for (const [prefix, limit] of Object.entries(FILE_OVERRIDES)) {
    if (base.startsWith(prefix)) return limit
  }
  return DEFAULT_MAX_CHAIN
}

// ─── Main ────────────────────────────────────────────────────────────────────

const workflowDir = join(CWD, '.github', 'workflows')
const yamlFiles = collectYamlFiles(workflowDir)

if (yamlFiles.length === 0) {
  process.stdout.write(
    `check-workflow-parallelism: OK — no workflow files found, nothing to check (INV-120)\n`,
  )
  process.exit(0)
}

/** @type {Array<{ file: string, chain: string[], length: number, limit: number }>} */
const violations = []

for (const file of yamlFiles) {
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    continue
  }

  const jobs = parseWorkflowJobs(content)
  if (jobs.size === 0) continue

  const { length, chain } = longestChain(jobs)
  const limit = limitForFile(file)

  if (length > limit) {
    violations.push({ file: basename(file), chain, length, limit })
  }
}

if (violations.length > 0) {
  process.stdout.write(
    `check-workflow-parallelism: FAIL — ${violations.length} workflow(s) exceed needs-chain limit (INV-120)\n\n`,
  )
  for (const v of violations) {
    process.stdout.write(`  ${v.file}: chain=${v.length} (limit=${v.limit})\n`)
    process.stdout.write(`    ${v.chain.join(' → ')}\n`)
  }
  process.stdout.write('\n')
  process.exit(1)
}

process.stdout.write(
  `check-workflow-parallelism: OK — all ${yamlFiles.length} workflow(s) within needs-chain limits (INV-120)\n`,
)
process.exit(0)
