// SPDX-License-Identifier: Apache-2.0
// workflow-scan.mjs — shared helpers for the workflow/action check-*.mjs gate scripts (#1096).
//
// Two pieces of boilerplate were duplicated across the workflow/action checkers:
//
//   1. collectYamlFiles(dir) — a recursive .yml/.yaml walker (symlink-skipping),
//      defined verbatim in 5 scripts (check-action-pins, check-workflow-job-naming,
//      check-workflow-runners, check-workflow-sha-pinning, check-workflow-test-integrity).
//   2. The `--help` / `--dir` argument block (Usage + Options + dir resolution),
//      duplicated in the W6 anti-drift validators.
//
// This is a LIBRARY module under scripts/lib/, NOT a `check-*.mjs`, so it is
// exempt from the INV-94 CATALOG-marker requirement (check-script-cohesion only
// scans files matching /^check-.+\.mjs$/).
//
// The extraction is behavior-preserving: each export reproduces the exact logic
// of the inlined originals. collectYamlFiles takes an optional onReadError hook
// because check-action-pins emits a warn line on readdir failure while the W6
// scripts swallow it silently — the hook keeps both behaviors byte-identical.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Recursively collect `.yml`/`.yaml` file paths under `dir`.
 *
 * Mirrors the inlined walker: returns [] when the directory does not exist,
 * skips symbolic links, recurses into subdirectories, and on a readdir error
 * returns the results gathered so far (after invoking `onReadError`, if given).
 *
 * @param {string} dir Directory to scan.
 * @param {{ onReadError?: (dir: string, err: Error) => void }} [opts]
 *   onReadError is invoked when readdirSync throws (e.g. EACCES). When omitted,
 *   the error is swallowed silently, matching the W6 validators.
 * @returns {string[]} Absolute (or `dir`-relative) paths of matching files.
 */
export function collectYamlFiles(dir, { onReadError } = {}) {
  if (!existsSync(dir)) return []
  const results = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (onReadError) onReadError(dir, /** @type {Error} */ (err))
    return results
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectYamlFiles(full, { onReadError }))
    } else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
      results.push(full)
    }
  }
  return results
}

/**
 * Recursively collect workflow TEMPLATE files (`.ejs`) that live under any
 * `workflows/` directory within `templatesRoot` (e.g. `src/templates/`).
 *
 * Arbiter emits these templates verbatim into a consumer project's
 * `.github/workflows/`, so a non-SHA / fabricated action pin in a template
 * ships a broken, unverifiable reference to every generated project while the
 * arbiter self-gate (which only walks arbiter's own `.github/`) stays green.
 * This walker lets the pin gate also vet the emitted source (#1491).
 *
 * Returns [] when `templatesRoot` does not exist. Mirrors collectYamlFiles:
 * skips symlinks, recurses into subdirectories, invokes `onReadError` (if
 * given) on a readdir failure and returns results gathered so far.
 *
 * @param {string} templatesRoot Root of the template tree (e.g. src/templates).
 * @param {{ onReadError?: (dir: string, err: Error) => void }} [opts]
 * @returns {string[]} Paths of `*.ejs` files under a `workflows/` directory.
 */
export function collectWorkflowTemplates(templatesRoot, { onReadError } = {}) {
  if (!existsSync(templatesRoot)) return []
  const results = []
  const walk = (dir, inWorkflows) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      if (onReadError) onReadError(dir, /** @type {Error} */ (err))
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, inWorkflows || entry.name === 'workflows')
      } else if (inWorkflows && entry.isFile() && entry.name.endsWith('.ejs')) {
        results.push(full)
      }
    }
  }
  walk(templatesRoot, false)
  return results
}

function parseWorkflow(parseYaml, path) {
  const value = parseYaml(readFileSync(path, 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('workflow must contain a YAML object')
  }
  return value
}

function workflowMapping(parseYaml, path) {
  const value = parseWorkflow(parseYaml, path)
  if (typeof value.jobs !== 'object' || value.jobs === null || Array.isArray(value.jobs)) {
    throw new Error('jobs object is missing')
  }
  return value.jobs
}

function pullRequestCondition(trigger) {
  if (trigger === 'pull_request' || (Array.isArray(trigger) && trigger.includes('pull_request'))) {
    return 'workflow pull_request trigger'
  }
  if (
    typeof trigger !== 'object' ||
    trigger === null ||
    !Object.prototype.hasOwnProperty.call(trigger, 'pull_request')
  ) {
    return null
  }
  const filters = trigger.pull_request
  if (typeof filters !== 'object' || filters === null || Array.isArray(filters)) {
    return 'workflow pull_request trigger'
  }
  return `workflow pull_request trigger ${JSON.stringify(filters)}`
}

function thresholdEntries(values, source) {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return []
  return Object.entries(values)
    .filter(
      ([name, value]) =>
        /threshold|minimum|maximum|budget|limit|coverage/i.test(name) &&
        ['string', 'number', 'boolean'].includes(typeof value),
    )
    .map(([name, value]) => ({ name, value, source: `${source}#${name}` }))
}

function effectiveThresholdEntries(scopes) {
  const effective = new Map()
  for (const { values, source } of scopes) {
    for (const threshold of thresholdEntries(values, source)) {
      effective.set(threshold.name, threshold)
    }
  }
  return [...effective.values()]
}

function genericWorkflowCommands(workflow, source) {
  const triggerCondition = pullRequestCondition(workflow.on)
  if (triggerCondition === null) return []
  if (typeof workflow.jobs !== 'object' || workflow.jobs === null || Array.isArray(workflow.jobs)) {
    throw new Error('jobs object is missing')
  }
  const entries = []
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (typeof job !== 'object' || job === null || Array.isArray(job)) {
      throw new Error(`${jobName} has unsupported workflow-job structure`)
    }
    const envScopes = [
      { values: workflow.env, source: `${source}#env` },
      { values: job.env, source: `${source}#jobs.${jobName}.env` },
    ]
    if (typeof job.uses === 'string') {
      entries.push({
        name: jobName,
        source,
        command: job.uses,
        condition: `${triggerCondition} && (${job.if ?? 'job is active'})`,
        thresholds: thresholdEntries(job.with, `${source}#jobs.${jobName}.with`),
        status: 'remote-dependent',
      })
      continue
    }
    if (!Array.isArray(job.steps)) {
      throw new Error(`${jobName} has unsupported workflow-job structure`)
    }
    for (const [index, step] of job.steps.entries()) {
      const entry = verificationCommandEntry(jobName, job, step, index, source, [
        ...effectiveThresholdEntries([
          ...envScopes,
          { values: step?.env, source: `${source}#jobs.${jobName}.steps.${index}.env` },
        ]),
        ...thresholdEntries(job.with, `${source}#jobs.${jobName}.with`),
        ...thresholdEntries(step?.with, `${source}#jobs.${jobName}.steps.${index}.with`),
      ])
      if (entry !== null) {
        entry.condition = `${triggerCondition} && (${entry.condition})`
        entries.push(entry)
      }
    }
  }
  return entries
}

function dependencyContract(jobs, source) {
  const job = jobs['dependency-review']
  const step = job?.steps?.find((entry) =>
    String(entry?.uses ?? '').startsWith('actions/dependency-review-action@'),
  )
  const severity = step?.with?.['fail-on-severity']
  if (
    typeof step?.uses !== 'string' ||
    typeof job?.if !== 'string' ||
    typeof severity !== 'string'
  ) {
    throw new Error('dependency-review command, condition, or severity is missing')
  }
  return {
    name: 'dependency-review',
    source,
    command: step.uses,
    condition: job.if,
    thresholds: [
      { name: 'fail-on-severity', value: severity, source: `${source}#dependency-review` },
    ],
    status: 'remote-dependent',
  }
}

function verificationCondition(job, step, name) {
  if (job.if !== undefined && typeof job.if !== 'string') {
    throw new Error(`${name} has an unsupported job condition`)
  }
  if (step.if !== undefined && typeof step.if !== 'string') {
    throw new Error(`${name} has an unsupported step condition`)
  }
  if (job.if && step.if) return `(${job.if}) && (${step.if})`
  return job.if ?? step.if ?? 'workflow job and step are active'
}

function verificationCommandEntry(jobName, job, step, index, source, thresholds) {
  const command = typeof step?.run === 'string' ? step.run : step?.uses
  if (command === undefined) return null
  if (typeof command !== 'string' || command.trim() === '') {
    throw new Error(`${jobName} step ${index + 1} has an unsupported command`)
  }
  return {
    name: `${jobName}: ${step.name ?? `step ${index + 1}`}`,
    source,
    command,
    condition: verificationCondition(job, step, jobName),
    thresholds,
    status: 'remote-dependent',
  }
}

function verificationCommands(jobs, source, thresholds) {
  const entries = []
  for (const [jobName, job] of Object.entries(jobs)) {
    if (jobName === 'check-trigger') continue
    if (typeof job !== 'object' || job === null || !Array.isArray(job.steps)) {
      throw new Error(`${jobName} has unsupported workflow-job structure`)
    }
    for (const [index, step] of job.steps.entries()) {
      const entry = verificationCommandEntry(jobName, job, step, index, source, thresholds)
      if (entry !== null) entries.push(entry)
    }
  }
  return entries
}

function extendedContract(jobs, source) {
  const threshold = jobs['check-trigger']?.steps
    ?.map((step) => step?.env?.LOC_THRESHOLD)
    .find((value) => value !== undefined)
  const defaultThreshold =
    typeof threshold === 'string' ? /\|\|\s*'([^']+)'/.exec(threshold)?.[1] : undefined
  if (defaultThreshold === undefined) throw new Error('extended LOC_THRESHOLD is missing')
  const thresholds = [
    { name: 'changed lines', value: defaultThreshold, source: `${source}#LOC_THRESHOLD` },
  ]
  const entries = verificationCommands(jobs, source, thresholds)
  if (entries.length === 0) throw new Error('extended verification commands are missing')
  return entries
}

/** Parse the checked-out PR workflows, or return explicit unresolved obligations. */
export async function inspectWorkflowContract(root) {
  const definitions = [
    ['01-pr-fast.yml', dependencyContract],
    ['02-pr-extended.yml', extendedContract],
  ]
  const external = []
  const unresolved = []
  const workflowPaths = collectYamlFiles(join(root, '.github', 'workflows'))
  const workflowSource = (path) => relative(root, path).replaceAll('\\', '/')
  let parseYaml
  try {
    ;({ parse: parseYaml } = await import('yaml'))
  } catch (err) {
    for (const path of workflowPaths) {
      unresolved.push({
        name: 'CI workflow authority',
        source: workflowSource(path),
        reason: `YAML parser unavailable: ${err.message}`,
      })
    }
    return { external, unresolved }
  }
  for (const [name, build] of definitions) {
    const source = `.github/workflows/${name}`
    const path = join(root, source)
    if (!existsSync(path)) continue
    try {
      const entries = build(workflowMapping(parseYaml, path), source)
      external.push(...(Array.isArray(entries) ? entries : [entries]))
    } catch (err) {
      try {
        const workflow = parseWorkflow(parseYaml, path)
        if (pullRequestCondition(workflow.on) === null) {
          throw new Error('pull_request trigger is missing')
        }
        external.push(...genericWorkflowCommands(workflow, source))
      } catch (fallbackErr) {
        unresolved.push({
          name: 'CI workflow authority',
          source,
          reason: `${err.message}; generic fallback failed: ${fallbackErr.message}`,
        })
      }
    }
  }
  const canonical = new Set(definitions.map(([name]) => name))
  for (const path of workflowPaths) {
    const name = path.split('/').at(-1)
    if (canonical.has(name)) continue
    const source = workflowSource(path)
    try {
      external.push(...genericWorkflowCommands(parseWorkflow(parseYaml, path), source))
    } catch (err) {
      unresolved.push({ name: 'CI workflow authority', source, reason: err.message })
    }
  }
  return { external, unresolved }
}

/**
 * Scan `args` for a `--dir` flag in either `--dir value` or `--dir=value` form.
 * A LEFT-TO-RIGHT scan that overwrites on each match is "last flag wins" for free,
 * across both forms mixed (#2675 Codex round-2).
 *
 * @param {string[]} args
 * @returns {{ given: boolean, value: string | undefined }} `given` is true when any
 *   `--dir`/`--dir=` token appears; `value` is the raw (unvalidated) text that followed
 *   it, or `undefined` for a trailing bare `--dir` with nothing after it.
 */
function scanDirFlag(args) {
  let given = false
  let value
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--dir') {
      given = true
      value = args[i + 1]
    } else if (a.startsWith('--dir=')) {
      given = true
      value = a.slice('--dir='.length)
    }
  }
  return { given, value }
}

/**
 * A `--dir` value that cannot be a real path: missing, empty, or flag-shaped (starts with
 * `--`, meaning `--dir` swallowed the NEXT flag as its own value rather than being given one).
 * #2675 Codex round-3: `--dir --help` used to swallow `--help` as this validity check ran
 * AFTER the generic `--help` scan, so the malformed `--dir` was invisible and the process
 * printed help and exited 0 instead of refusing the invocation it actually received.
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isUnusableDirValue(value) {
  return value === undefined || value === '' || value.startsWith('--')
}

/**
 * Handle the shared `--help`/`-h` and `--dir <path>`/`--dir=<path>` arguments.
 *
 * If `--help` or `-h` is present, the provided `usage` string is written to
 * stdout and the process exits 0 (matching the inlined blocks). Otherwise the
 * resolved working directory is returned: the `--dir` value (resolved) when
 * supplied, else `process.cwd()`.
 *
 * #2675 Codex round-1: a bare `--dir` (no value), or a `--dir` naming a path that
 * does not exist or is not a directory, used to fall back to `process.cwd()`
 * SILENTLY — an explicit scan-root request that could never be honored was
 * indistinguishable from none being given at all, and the caller's own
 * fixture-less SKIP paths would then quietly report clean on the live repo
 * instead of the intended (missing) target. Both are now a loud `exit(2)`:
 * an unusable `--dir` must never be read as "use the default". Round-2 closed
 * `--dir ''` (empty is not `undefined`, but `resolve('')` IS `process.cwd()`) and
 * made a repeated flag deterministic (last occurrence, across `--dir v` and
 * `--dir=v` both). Round-3 accepts `--dir=v` and validates the --dir value BEFORE
 * the `--help` scan, so `--dir --help` refuses rather than printing help.
 *
 * Script-specific flags (e.g. `--runner`) are NOT consumed here; the caller
 * parses them from the same `args` array as before.
 *
 * @param {string[]} args process.argv.slice(2)
 * @param {{ usage: string }} opts Pre-formatted usage text (already including a
 *   trailing newline), printed verbatim on `--help`.
 * @returns {{ cwd: string }} Resolved working directory.
 */
export function parseHelpAndDir(args, { usage }) {
  const { given, value } = scanDirFlag(args)
  if (given && isUnusableDirValue(value)) {
    process.stderr.write('--dir requires a path argument\n')
    process.exit(2)
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage)
    process.exit(0)
  }
  if (!given) return { cwd: process.cwd() }
  const resolved = resolve(value)
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    process.stderr.write(`--dir ${value} does not exist or is not a directory\n`)
    process.exit(2)
  }
  return { cwd: resolved }
}
