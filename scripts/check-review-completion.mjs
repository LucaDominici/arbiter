#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: #2177 task-scoped review-completion stage gate. Reconciles one dispatch sidecar
// CATALOG: against the reviewer envelopes returned for that task, naming each missing reviewer
// CATALOG: so /ship can re-dispatch exactly that agent once. It does NOT fold into
// CATALOG: check-agent-return.mjs because that is a repo-wide CORPUS validator run once at gate
// CATALOG: time whose dispatch cross-check is all-or-nothing (count>0 && checked===0) and
// CATALOG: therefore passes when 2 of 3 dispatched reviewers evaporate; this is a TASK-SCOPED,
// CATALOG: MID-FLIGHT stage gate that must name WHICH agent is missing so the /ship playbook can
// CATALOG: re-dispatch exactly that one. Different input scope, lifecycle and verdict granularity
// CATALOG: (same rejected-fold-in precedent as record-agent-return.mjs and
// CATALOG: check-refutation-verdicts.mjs). Shared schema logic is reused from scripts/lib/, not
// CATALOG: duplicated.
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (incomplete review return), 2 ERROR (invocation / IO).
// Soft completion: a well-formed envelope is the verdict. An agent that exhausted its turn
// budget but wrote its envelope PASSES and must never be re-dispatched.
//
// Usage:
//   node scripts/check-review-completion.mjs --task '#NNN' [--sidecar=<path>]
//       [--evidence-dir=<path>] [--schema=<path>] [--repo-root=<path>]
// Without --task, resolves a task id from the sidecar's optional task/taskId field; otherwise
// vacuously passes so the advisory check-all invocation does not guess task context.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSchema, validateSchema } from './lib/agent-return-validate.mjs'
import { arg } from './lib/gate-args.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')
const argv = process.argv.slice(2)

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    "Usage: node scripts/check-review-completion.mjs --task '#NNN' [--sidecar=<path>] [--evidence-dir=<path>] [--schema=<path>] [--repo-root=<path>]\n",
  )
  process.exit(0)
}

const requestedTask = arg('task', argv)
const repoRoot = arg('repo-root', argv) ? resolve(arg('repo-root', argv)) : repoDefault
const sidecarPath = arg('sidecar', argv)
  ? resolve(arg('sidecar', argv))
  : join(repoRoot, '.arbiter', 'agents-dispatched.json')
const evidenceDir = arg('evidence-dir', argv)
  ? resolve(arg('evidence-dir', argv))
  : join(repoRoot, '.arbiter', 'evidence', 'agent-returns')
const schemaPath = arg('schema', argv)
  ? resolve(arg('schema', argv))
  : join(repoRoot, 'schemas', 'agent-return.schema.json')

/**
 * @typedef {{ count: number, branch: string, sha: string, agents?: string[], task?: string, taskId?: string }} DispatchSidecar
 */

/**
 * @param {unknown} value
 * @returns {value is DispatchSidecar}
 */
function isSidecar(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = /** @type {Record<string, unknown>} */ (value)
  if (
    typeof record['count'] !== 'number' ||
    !Number.isInteger(record['count']) ||
    record['count'] < 0 ||
    typeof record['branch'] !== 'string' ||
    record['branch'].length === 0 ||
    typeof record['sha'] !== 'string' ||
    record['sha'].length === 0
  ) {
    return false
  }
  if (
    'agents' in record &&
    (!Array.isArray(record['agents']) ||
      record['agents'].some((agent) => typeof agent !== 'string' || agent.length === 0))
  ) {
    return false
  }
  return true
}

/**
 * @param {string} task
 * @returns {string}
 */
function sanitizeTask(task) {
  return task.replace(/[#/]/g, '')
}

/**
 * @param {string} task
 * @returns {boolean}
 */
function isTaskId(task) {
  return /^#[0-9]+$/.test(task)
}

/**
 * @param {string} evidenceRoot
 * @param {string} taskDir
 * @returns {{ files: string[] } | { error: string }}
 */
function listEnvelopeFiles(evidenceRoot, taskDir) {
  for (const dir of [evidenceRoot, taskDir]) {
    try {
      const state = statSync(dir)
      if (!state.isDirectory()) return { error: `${dir} is not a directory` }
      // FAIL-OPEN-INTENT: an absent evidence root or task directory means zero returns; the caller turns this into a task-completion FAIL, never a silent pass.
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return { files: [] }
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
  try {
    return {
      files: readdirSync(taskDir)
        .map((entry) => join(taskDir, entry))
        .filter((file) => statSync(file).isFile() && file.endsWith('.json')),
    }
    // FAIL-OPEN-INTENT: return the directory-read error to main so it becomes an exit-2 error with task context.
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * @param {string[]} files
 * @param {Record<string, unknown>} schema
 * @returns {Record<string, unknown>[]}
 */
function readEnvelopes(files, schema) {
  /** @type {Record<string, unknown>[]} */
  const valid = []
  for (const file of files) {
    try {
      if (statSync(file).size === 0) {
        continue
      }
      const parsed = JSON.parse(readFileSync(file, 'utf-8'))
      if (validateSchema(parsed, schema, schema, file).length > 0) {
        continue
      }
      valid.push(/** @type {Record<string, unknown>} */ (parsed))
      // FAIL-OPEN-INTENT: malformed or unreadable envelope artifacts are recorded as incomplete reviewers below, never accepted as a return.
    } catch {
      continue
    }
  }
  return valid
}

function main() {
  if (!existsSync(sidecarPath)) {
    // FAIL-OPEN-INTENT: no dispatch sidecar means no review dispatch was recorded, so this task-scoped reconciliation has no subject.
    process.stdout.write(
      '[check-review-completion] OK — dispatch sidecar not found, vacuous pass\n',
    )
    return 0
  }

  /** @type {DispatchSidecar} */
  let sidecar
  try {
    const parsed = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    if (!isSidecar(parsed)) throw new Error('sidecar must contain count, branch, and sha')
    sidecar = parsed
  } catch (err) {
    process.stderr.write(
      `[check-review-completion] ERROR: cannot read sidecar ${sidecarPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }

  const taskFromSidecar =
    typeof sidecar.task === 'string'
      ? sidecar.task
      : typeof sidecar.taskId === 'string'
        ? sidecar.taskId
        : null
  const task = requestedTask ?? taskFromSidecar
  if (!task) {
    // FAIL-OPEN-INTENT: check-all has no task context and the legacy sidecar has no task id; avoid reconciling unrelated historical evidence.
    process.stdout.write('[check-review-completion] OK — task id unavailable, vacuous pass\n')
    return 0
  }
  if (!isTaskId(task)) {
    process.stderr.write(
      `[check-review-completion] ERROR: --task must be a GitHub issue id like '#2177' (got: ${task})\n`,
    )
    return 2
  }

  /** @type {Record<string, unknown>} */
  let schema
  try {
    schema = loadSchema(schemaPath)
  } catch (err) {
    process.stderr.write(
      `[check-review-completion] ERROR: cannot load schema: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }

  const listed = listEnvelopeFiles(evidenceDir, join(evidenceDir, sanitizeTask(task)))
  if ('error' in listed) {
    process.stderr.write(
      `[check-review-completion] ERROR: cannot read task evidence: ${listed.error}\n`,
    )
    return 2
  }
  const valid = readEnvelopes(listed.files, schema)

  /** @type {string[]} */
  const failures = []
  if (Array.isArray(sidecar.agents)) {
    if (sidecar.agents.length < sidecar.count) {
      failures.push(
        `sidecar declares ${sidecar.count} dispatched agent(s) but only ${sidecar.agents.length} named agent(s)`,
      )
    }
    for (const agent of sidecar.agents) {
      const matchingFiles = listed.files.filter((file) => {
        const basename = file.slice(file.lastIndexOf('/') + 1)
        return basename === `${agent}.json` || basename.startsWith(`${agent}-`)
      })
      const matching = valid.filter((envelope) => envelope['agent'] === agent)
      const branchMatch = matching.find((envelope) => envelope['branch'] === sidecar.branch)
      if (branchMatch) continue
      if (matching.length > 0) {
        const observed = String(matching[0]['branch'])
        failures.push(
          `${agent}: provenance mismatch — expected branch ${sidecar.branch}, observed ${observed}`,
        )
      } else if (matchingFiles.length > 0) {
        failures.push(`${agent}: missing, empty, malformed, or schema-invalid return envelope`)
      } else {
        failures.push(`${agent}: missing return envelope`)
      }
    }
  } else {
    const reviewerCount = valid.filter((envelope) => envelope['role'] === 'reviewer').length
    if (reviewerCount < sidecar.count) {
      failures.push(
        `legacy dispatch expects ${sidecar.count} reviewer envelope(s) but found ${reviewerCount}`,
      )
    }
  }

  if (failures.length > 0) {
    for (const failure of failures)
      process.stdout.write(`[check-review-completion] FAIL: ${failure}\n`)
    process.stdout.write(
      '[check-review-completion] Re-dispatch ONLY the named agent(s) exactly once, persist their returns, and re-run this check.\n',
    )
    return 1
  }
  process.stdout.write('[check-review-completion] OK — review completion reconciled\n')
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(
    `[check-review-completion] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
