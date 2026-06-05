#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Auditor routing for review-code skill (#692).
// Reads .claude/auditor-routing.json + a file list (from git diff or stdin),
// computes the active auditor set and dual score (coverage + pass_rate).
//
// Precedence: critical_paths > always_on > tag_map > skip
// Active set: union(always_on, tag_map matches, critical_path matches)
// Scoring: coverage = active_weight / total_weight
//          pass_rate = active_pass_weight / active_weight (null when no pass data)
//
// Uses spawnSync from node:child_process (scripts/ exception to src/ INV-12 rule).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { minimatch } from 'minimatch'

const REPO_ROOT = resolve(process.cwd())
const ROUTING_PATH = join(REPO_ROOT, '.claude/auditor-routing.json')

// --- CLI arg parsing ---
const args = process.argv.slice(2)
let base = 'origin/main'
let diffStdin = false
let artifactDir = null
let explainPath = null
let scoreMode = false
let resultsArg = null
let capsArg = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) base = args[++i]
  else if (args[i] === '--diff-stdin') diffStdin = true
  else if (args[i] === '--artifact-dir' && args[i + 1]) artifactDir = args[++i]
  else if (args[i] === '--explain' && args[i + 1]) explainPath = args[++i]
  else if (args[i] === '--score') scoreMode = true
  else if (args[i] === '--results' && args[i + 1]) resultsArg = args[++i]
  else if (args[i] === '--caps' && args[i + 1]) capsArg = args[++i]
}

// --- Load + validate routing config ---
function loadConfig() {
  if (!existsSync(ROUTING_PATH)) {
    process.stderr.write(`[route-auditors] ERROR: ${ROUTING_PATH} not found\n`)
    process.exit(2)
  }
  let config
  try {
    config = JSON.parse(readFileSync(ROUTING_PATH, 'utf-8'))
  } catch (e) {
    process.stderr.write(
      `[route-auditors] ERROR: invalid JSON in auditor-routing.json: ${e.message}\n`,
    )
    process.exit(2)
  }
  // Structural validation (required keys)
  for (const key of ['auditors', 'always_on', 'tag_map', 'critical_paths']) {
    if (!(key in config)) {
      process.stderr.write(
        `[route-auditors] ERROR: auditor-routing.json missing required key: "${key}"\n`,
      )
      process.exit(2)
    }
  }
  // Reject absolute globs in critical_paths
  for (const globs of Object.values(config.critical_paths)) {
    for (const g of globs) {
      if (g.startsWith('/')) {
        process.stderr.write(
          `[route-auditors] ERROR: absolute glob rejected in critical_paths: "${g}"\n`,
        )
        process.exit(2)
      }
    }
  }
  return config
}

// --- Get diff file list ---
function getChangedFiles() {
  if (diffStdin) {
    // Read from stdin (fd 0 — works under spawnSync with input:)
    const raw = readFileSync(0, 'utf-8')
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  }
  // Use git diff --name-only --no-renames
  const r = spawnSync('git', ['diff', '--name-only', '--no-renames', `${base}...HEAD`], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
  })
  if (r.error) {
    process.stderr.write(`[route-auditors] ERROR: git diff failed: ${r.error.message}\n`)
    process.exit(2)
  }
  if (r.status !== 0) {
    process.stderr.write(
      `[route-auditors] ERROR: git diff exited ${r.status}:\n${r.stderr ?? '(no stderr)'}\n`,
    )
    process.exit(2)
  }
  return (r.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

// --- Glob matching ---
function matchesAny(filePath, globs) {
  return globs.some((g) => minimatch(filePath, g, { matchBase: false, dot: true }))
}

// --- Compute active auditor set ---
function computeActive(config, files) {
  const auditorNames = Object.keys(config.auditors)
  const active = new Set(config.always_on)
  const criticalFired = new Set()

  // Check critical_paths first (force-activates ALL)
  let criticalMatch = false
  for (const [groupName, globs] of Object.entries(config.critical_paths)) {
    if (files.some((f) => matchesAny(f, globs))) {
      criticalMatch = true
      criticalFired.add(groupName)
    }
  }
  if (criticalMatch) {
    for (const name of auditorNames) active.add(name)
    return {
      active: [...active].filter((a) => auditorNames.includes(a)),
      criticalFired: [...criticalFired],
    }
  }

  // tag_map: union of all matching auditors
  for (const [glob, auditors] of Object.entries(config.tag_map)) {
    if (files.some((f) => matchesAny(f, [glob]))) {
      for (const a of auditors) active.add(a)
    }
  }

  return { active: [...active].filter((a) => auditorNames.includes(a)), criticalFired: [] }
}

// --- Compute scores ---
function computeScores(config, activeNames) {
  const auditors = config.auditors
  const allNames = Object.keys(auditors)
  const totalWeight = allNames.reduce((s, n) => s + (auditors[n]?.weight ?? 0), 0)
  const activeWeight = activeNames.reduce((s, n) => s + (auditors[n]?.weight ?? 0), 0)
  const coverage = totalWeight > 0 ? activeWeight / totalWeight : 0
  const skipped = allNames.filter((n) => !activeNames.includes(n))
  const skippedWeight = skipped.reduce((s, n) => s + (auditors[n]?.weight ?? 0), 0)

  let coverageTier
  if (coverage >= 1) coverageTier = 'full'
  else if (coverage >= 0.5) coverageTier = 'partial'
  else coverageTier = 'minimal'

  return {
    coverage: Math.round(coverage * 1000) / 1000,
    coverage_tier: coverageTier,
    active_weight: activeWeight,
    total_weight: totalWeight,
    skipped,
    skipped_weight: skippedWeight,
    pass_rate: null, // populated by caller after actual auditor runs
  }
}

// --- --score mode (#1212 F2) ---
// Weighted anti-inflation verdict. A skipped auditor contributes nothing to the
// numerator but the denominator stays the FULL auditor weight, so skipping a
// would-fail auditor equals failing it — a skip can never raise the score.
// `results`: { auditorName: passed } for the auditors that actually ran.
// `caps`:    { auditorName: pct }   max % of that auditor's weight it may earn
//                                   (e.g. an unaddressed [RT-xx] finding caps it).
function scoreFromResults(config, results, caps) {
  const auditors = config.auditors
  const totalWeight = Object.values(auditors).reduce((s, a) => s + (a?.weight ?? 0), 0)
  const capped = []
  let earned = 0
  for (const [name, passed] of Object.entries(results)) {
    const weight = auditors[name]?.weight ?? 0
    let contribution = passed === true ? weight : 0
    if (caps && Object.prototype.hasOwnProperty.call(caps, name)) {
      const ceiling = (weight * caps[name]) / 100
      if (ceiling < contribution) {
        contribution = ceiling
        capped.push(name)
      }
    }
    earned += contribution
  }
  const score = totalWeight > 0 ? Math.round((100 * earned) / totalWeight) : 0
  let verdict
  if (score >= 80) verdict = 'PASS'
  else if (score >= 60) verdict = 'CONCERNS'
  else if (score >= 40) verdict = 'REWORK'
  else verdict = 'FAIL'
  return {
    score,
    verdict,
    earned_weight: Math.round(earned * 1000) / 1000,
    total_weight: totalWeight,
    evaluated: Object.keys(results),
    capped,
  }
}

function runScoreMode(config) {
  if (resultsArg === null) {
    process.stderr.write('[route-auditors] --score requires --results <json>\n')
    process.exit(2)
  }
  let results
  let caps
  try {
    results = JSON.parse(resultsArg)
    caps = capsArg !== null ? JSON.parse(capsArg) : undefined
  } catch (e) {
    process.stderr.write(`[route-auditors] --score: invalid JSON: ${e.message}\n`)
    process.exit(2)
  }
  process.stdout.write(JSON.stringify(scoreFromResults(config, results, caps), null, 2) + '\n')
  process.exit(0)
}

// --- --explain mode ---
function explainFile(config, filePath) {
  const auditorNames = Object.keys(config.auditors)
  const reasons = []

  // Check critical_paths
  for (const [groupName, globs] of Object.entries(config.critical_paths)) {
    if (matchesAny(filePath, globs)) {
      reasons.push(`critical-path group "${groupName}" → force-activates all auditors`)
    }
  }

  // always_on
  if (config.always_on.length > 0) {
    reasons.push(`always_on: [${config.always_on.join(', ')}]`)
  }

  // tag_map matches
  for (const [glob, auditors] of Object.entries(config.tag_map)) {
    if (matchesAny(filePath, [glob])) {
      reasons.push(`tag_map glob "${glob}" → [${auditors.join(', ')}]`)
    }
  }

  if (reasons.length === 0) reasons.push('no rules matched — path not covered by routing config')

  process.stdout.write(`Explain: ${filePath}\n`)
  for (const r of reasons) process.stdout.write(`  ${r}\n`)
  process.exit(0)
}

// --- Main ---
const config = loadConfig()

if (scoreMode) {
  runScoreMode(config)
}

if (explainPath !== null) {
  explainFile(config, explainPath)
}

const files = getChangedFiles()

if (files.length === 0) {
  process.stderr.write('[route-auditors] no files in diff — refusing to score (empty active set)\n')
  process.exit(1)
}

const { active, criticalFired } = computeActive(config, files)

if (active.length === 0) {
  process.stderr.write('[route-auditors] no auditors selected — refusing to score\n')
  process.exit(1)
}

const scores = computeScores(config, active)
const auditorNames = Object.keys(config.auditors)
const skipped = auditorNames.filter((n) => !active.includes(n))

const result = {
  files_changed: files.length,
  active,
  skipped,
  critical_paths_fired: criticalFired,
  coverage: scores.coverage,
  coverage_tier: scores.coverage_tier,
  active_weight: scores.active_weight,
  total_weight: scores.total_weight,
  pass_rate: null,
}

process.stdout.write(JSON.stringify(result, null, 2) + '\n')

// Write artifact if requested
if (artifactDir) {
  mkdirSync(artifactDir, { recursive: true })
  writeFileSync(
    join(artifactDir, 'routing-decision.json'),
    JSON.stringify(
      {
        ...result,
        skipped_details: skipped.map((n) => ({
          name: n,
          weight: config.auditors[n]?.weight ?? 0,
          reason:
            criticalFired.length > 0
              ? 'critical-path triggered full set'
              : 'no matching tag or critical path',
        })),
      },
      null,
      2,
    ),
  )
}
