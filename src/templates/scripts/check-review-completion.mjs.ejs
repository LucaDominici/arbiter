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
import {
  constants as fsConstants,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSchema, validateSchema } from './lib/agent-return-validate.mjs'
import { arg } from './lib/gate-args.mjs'
import { evidenceStaleness, isForeignSidecar } from './lib/evidence-binding.mjs'

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
 * Task this run reconciles: the explicit `--task` when given, else the task state on disk.
 * `undefined` means "unknown" — nothing can then be proven foreign, which is exactly the
 * pre-#2399 behaviour.
 * FAIL-OPEN-INTENT: an unreadable status file only widens what counts as the active task; it
 * never turns a stale or mismatched sidecar into a pass — every binding check below still runs.
 */
function activeTaskId() {
  if (requestedTask) return requestedTask
  try {
    const parsed = JSON.parse(
      readFileSync(join(repoRoot, '.claude', '.task', 'status.json'), 'utf-8'),
    )
    return isRecord(parsed) && typeof parsed['taskId'] === 'string' ? parsed['taskId'] : undefined
  } catch {
    return undefined
  }
}
const activeTask = activeTaskId()

/**
 * @typedef {{ count: number, branch: string, sha: string, agents?: string[], task?: string, taskId?: string }} DispatchSidecar
 */

/** @typedef {{ envelope: Record<string, unknown>, file: string }} ValidEnvelope */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isValidAgentList(value) {
  if (!Array.isArray(value)) return false
  return value.every((agent) => isNonEmptyString(agent)) && new Set(value).size === value.length
}

/**
 * @param {Record<string, unknown>} record
 * @returns {boolean}
 */
function hasValidSidecarFields(record) {
  if (!isNonNegativeInteger(record['count']) || record['count'] < 1) return false
  if (!isNonEmptyString(record['branch'])) return false
  return isNonEmptyString(record['sha'])
}

/**
 * @param {Record<string, unknown>} record
 * @returns {boolean}
 */
function hasValidOptionalAgents(record) {
  if (!('agents' in record)) return true
  return isValidAgentList(record['agents'])
}

/**
 * @param {unknown} value
 * @returns {value is DispatchSidecar}
 */
function isSidecar(value) {
  if (!isRecord(value)) return false
  return hasValidSidecarFields(value) && hasValidOptionalAgents(value)
}

/**
 * @param {string} task
 * @returns {string}
 */
function sanitizeTask(task) {
  return task.replace(/[^0-9A-Za-z-]/g, '_')
}

/**
 * @param {string} agent
 * @returns {string}
 */
function sanitizeAgent(agent) {
  return agent.replace(/[^0-9A-Za-z-]/g, '-')
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err)
}

/**
 * @param {string} task
 * @returns {boolean}
 */
function isTaskId(task) {
  return /^#[0-9]+$/.test(task)
}

/** @param {string} absolute @returns {string[]} */
function ancestorsOf(absolute) {
  const ancestors = []
  for (let current = absolute; ; current = dirname(current)) {
    ancestors.push(current)
    const parent = dirname(current)
    if (parent === current) break
  }
  return ancestors.reverse()
}

function inspectPath(path, validate) {
  const absolute = resolve(path)
  for (const ancestor of ancestorsOf(absolute)) {
    try {
      const state = lstatSync(ancestor)
      if (state.isSymbolicLink()) return { error: `${ancestor} is a symlink` }
      const error = validate(ancestor, absolute, state)
      if (error) return { error }
      // FAIL-OPEN-INTENT: a missing ancestor means the requested evidence path is absent; other errors return an exit-2 error.
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return { exists: false }
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
  return { exists: true }
}

function inspectDirectoryPath(dir) {
  return inspectPath(dir, (ancestor, absolute, state) => {
    if (ancestor !== absolute && !state.isDirectory()) return `${ancestor} is not a directory`
    if (ancestor === absolute && !state.isDirectory()) return `${absolute} is not a directory`
    return null
  })
}

/**
 * @param {string} file
 * @returns {{ exists: true } | { exists: false } | { error: string }}
 */
function inspectFilePath(file) {
  return inspectPath(file, (ancestor, absolute, state) => {
    if (ancestor === absolute ? !state.isFile() : !state.isDirectory()) {
      return `${ancestor} is not the expected file path`
    }
    return null
  })
}

const directoryFlags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW

function descriptorPath(fd) {
  return `${process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'}/${fd}`
}

function openDirectoryPath(path) {
  if (process.platform === 'win32') {
    throw new Error('descriptor-relative filesystem operations are unsupported on Windows')
  }
  let fd = -1
  try {
    fd = openSync('/', directoryFlags)
    for (const part of resolve(path).split('/').filter(Boolean)) {
      const next = openSync(join(descriptorPath(fd), part), directoryFlags)
      closeSync(fd)
      fd = next
    }
    return fd
  } catch (err) {
    if (fd !== -1) closeSync(fd)
    throw err
  }
}

function openFilePath(file) {
  const absolute = resolve(file)
  const dirFd = openDirectoryPath(dirname(absolute))
  try {
    const fileFd = openSync(
      join(descriptorPath(dirFd), basename(absolute)),
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    )
    return { dirFd, fileFd }
  } catch (err) {
    closeSync(dirFd)
    throw err
  }
}

function closeFilePath(handles) {
  closeSync(handles.fileFd)
  closeSync(handles.dirFd)
}

function readRegularFile(file) {
  const handles = openFilePath(file)
  try {
    const state = fstatSync(handles.fileFd)
    if (!state.isFile() || state.size === 0) return null
    return readFileSync(handles.fileFd, 'utf-8')
  } finally {
    closeFilePath(handles)
  }
}

function readDirectoryEntries(dir) {
  const fd = openDirectoryPath(dir)
  try {
    return readdirSync(descriptorPath(fd))
  } finally {
    closeSync(fd)
  }
}

/**
 * @param {string} evidenceRoot
 * @param {string[]} taskDirs
 * @returns {{ files: string[] } | { error: string }}
 */
function listEnvelopeFiles(evidenceRoot, taskDirs) {
  const rootState = inspectDirectoryPath(evidenceRoot)
  if ('error' in rootState) return rootState
  if (!rootState.exists) return { files: [] }

  for (const taskDir of taskDirs) {
    const taskState = inspectDirectoryPath(taskDir)
    if ('error' in taskState) return taskState
    if (!taskState.exists) continue
    try {
      return {
        files: readDirectoryEntries(taskDir)
          .map((entry) => join(taskDir, entry))
          .filter((file) => file.endsWith('.json')),
      }
      // FAIL-OPEN-INTENT: return the directory-read error to main so it becomes an exit-2 error with task context.
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
  return { files: [] }
}

/**
 * @param {string[]} files
 * @param {Record<string, unknown>} schema
 * @returns {ValidEnvelope[]}
 */
function readEnvelopes(files, schema) {
  /** @type {ValidEnvelope[]} */
  const valid = []
  for (const file of files) {
    try {
      const content = readRegularFile(file)
      if (content === null) continue
      const parsed = JSON.parse(content)
      if (validateSchema(parsed, schema, schema, file).length > 0) {
        continue
      }
      valid.push({ envelope: /** @type {Record<string, unknown>} */ (parsed), file })
      // FAIL-OPEN-INTENT: malformed or unreadable envelope artifacts are recorded as incomplete reviewers below, never accepted as a return.
    } catch {
      continue
    }
  }
  return valid
}

/**
 * @param {string} file
 * @param {string} agent
 * @returns {boolean}
 */
function isAgentEnvelopeFile(file, agent) {
  const basename = file.slice(file.lastIndexOf('/') + 1)
  const safeAgent = sanitizeAgent(agent)
  return basename === `${safeAgent}.json` || basename.startsWith(`${safeAgent}-`)
}

/**
 * @param {string} agent
 * @param {DispatchSidecar} sidecar
 * @param {string} task
 * @param {string[]} files
 * @param {ValidEnvelope[]} valid
 * @returns {string | null}
 */
function checkAgentEnvelope(agent, sidecar, task, files, valid) {
  const matchingFiles = files.filter((file) => isAgentEnvelopeFile(file, agent))
  const matching = valid
    .filter(({ envelope, file }) => envelope['agent'] === agent && isAgentEnvelopeFile(file, agent))
    .map(({ envelope }) => envelope)
  const taskMatch = matching.filter((envelope) => envelope['taskId'] === task)
  const branchMatch = taskMatch.find(
    (envelope) => envelope['branch'] === sidecar.branch && envelope['role'] === 'reviewer',
  )
  if (branchMatch) {
    if (branchMatch['sha'] === sidecar.sha) return null
    return `${agent}: provenance mismatch — expected sha ${sidecar.sha}, observed ${branchMatch['sha']}`
  }
  const wrongRole = taskMatch.find((envelope) => envelope['branch'] === sidecar.branch)
  if (wrongRole) return `${agent}: return envelope role must be reviewer`
  if (taskMatch.length > 0) {
    const observed = String(taskMatch[0]['branch'])
    return `${agent}: provenance mismatch — expected branch ${sidecar.branch}, observed ${observed}`
  }
  if (matching.length > 0) {
    return `${agent}: provenance mismatch — expected task ${task}, observed ${matching[0]['taskId']}`
  }
  if (matchingFiles.length > 0) {
    return `${agent}: missing, empty, malformed, or schema-invalid return envelope`
  }
  return `${agent}: missing return envelope`
}

/**
 * @param {DispatchSidecar} sidecar
 * @param {string} task
 * @param {string[]} files
 * @param {Record<string, unknown>[]} valid
 * @returns {string[]}
 */
function checkNamedAgentEnvelopes(sidecar, task, files, valid) {
  const failures = []
  if (sidecar.agents.length < sidecar.count) {
    failures.push(
      `sidecar declares ${sidecar.count} dispatched agent(s) but only ${sidecar.agents.length} named agent(s)`,
    )
  }
  for (const agent of sidecar.agents) {
    const failure = checkAgentEnvelope(agent, sidecar, task, files, valid)
    if (failure) failures.push(failure)
  }
  return failures
}

/**
 * @param {DispatchSidecar} sidecar
 * @param {string} task
 * @param {ValidEnvelope[]} valid
 * @returns {string[]}
 */
function checkLegacyReviewerCount(sidecar, task, valid) {
  const reviewerAgents = new Set(
    valid
      .filter(
        ({ envelope, file }) =>
          typeof envelope['agent'] === 'string' &&
          isAgentEnvelopeFile(file, envelope['agent']) &&
          envelope['role'] === 'reviewer' &&
          envelope['taskId'] === task &&
          envelope['branch'] === sidecar.branch &&
          envelope['sha'] === sidecar.sha,
      )
      .map(({ envelope }) => envelope['agent']),
  )
  const reviewerCount = reviewerAgents.size
  if (reviewerCount < sidecar.count) {
    return [
      `legacy dispatch expects ${sidecar.count} reviewer envelope(s) but found ${reviewerCount}`,
    ]
  }
  return []
}

/**
 * @param {DispatchSidecar} sidecar
 * @param {string} task
 * @param {string[]} files
 * @param {ValidEnvelope[]} valid
 * @returns {string[]}
 */
function collectReviewFailures(sidecar, task, files, valid) {
  if (Array.isArray(sidecar.agents)) return checkNamedAgentEnvelopes(sidecar, task, files, valid)
  return checkLegacyReviewerCount(sidecar, task, valid)
}

/**
 * @param {string[]} failures
 * @returns {number}
 */
function reportReviewFailures(failures) {
  if (failures.length === 0) {
    process.stdout.write('[check-review-completion] OK — review completion reconciled\n')
    return 0
  }
  for (const failure of failures)
    process.stdout.write(`[check-review-completion] FAIL: ${failure}\n`)
  process.stdout.write(
    '[check-review-completion] Re-dispatch ONLY the named agent(s) exactly once, persist their returns, and re-run this check.\n',
  )
  return 1
}

/**
 * @returns {{ sidecar: DispatchSidecar } | { error: string }}
 */
function readDispatchSidecar() {
  let handles = null
  try {
    handles = openFilePath(sidecarPath)
    const parsed = JSON.parse(readFileSync(handles.fileFd, 'utf-8'))
    if (!isSidecar(parsed)) throw new Error('sidecar must contain count, branch, and sha')
    return { sidecar: parsed } // FAIL-OPEN-INTENT: error value is returned and surfaced by the caller, which exits non-zero.
  } catch (err) {
    return { error: errorMessage(err) }
  } finally {
    if (handles !== null) closeFilePath(handles)
  }
}

/**
 * @param {DispatchSidecar} sidecar
 * @returns {string | null}
 */
function sidecarTask(sidecar) {
  if (typeof sidecar.task === 'string') return sidecar.task
  if (typeof sidecar.taskId === 'string') return sidecar.taskId
  return null
}

/**
 * @param {DispatchSidecar} sidecar
 * @param {string | undefined} requested
 * @returns {string | null}
 */
function sidecarTaskError(sidecar, requested) {
  const declared = [sidecar.task, sidecar.taskId].filter((value) => value !== undefined)
  if (declared.some((value) => typeof value !== 'string' || !isTaskId(value))) {
    return 'sidecar task/taskId must be GitHub issue ids like #2177'
  }
  if (requested && declared.length === 0) {
    return `requested task ${requested} requires a task/taskId in the dispatch sidecar`
  }
  const selected = requested ?? sidecarTask(sidecar)
  if (selected && declared.some((value) => value !== selected)) {
    return `requested task ${selected} disagrees with sidecar task ${declared.join(', ')}`
  }
  return null
}

/** @param {string[]} args @returns {string | null} */
function gitLine(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 ? String(result.stdout).trim() || null : null
}

/**
 * @param {DispatchSidecar} sidecar
 * @returns {string | null}
 */
function checkoutBindingError(sidecar) {
  const branch = gitLine(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null) {
    // FAIL-OPEN-INTENT: isolated non-git fixtures have no checkout identity; real git roots fail closed below when metadata exists.
    return existsSync(join(repoRoot, '.git')) ? 'cannot read the current git branch' : null
  }
  // #2399: branch + ancestry + CONTENT in one binding (evidence-only commits are not a
  // source change); the uncommitted legs below still fail closed on a dirty checkout.
  const staleness = evidenceStaleness(repoRoot, sidecar.sha, { branch: sidecar.branch })
  if (staleness !== null) return `review sidecar ${staleness}`
  const trackedError = trackedChangesError(sidecar.sha)
  if (trackedError) return trackedError
  return dirtyCheckoutError(sidecar.sha)
}

function trackedChangesError(sha) {
  for (const diffArgs of [[], ['--cached']]) {
    const changed = spawnSync('git', ['diff', '--name-only', ...diffArgs], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (changed.status !== 0) return `cannot inspect changes since sidecar sha ${sha}`
    const changedPaths = String(changed.stdout)
      .split(/\r?\n/)
      .filter((path) => path.length > 0 && !path.startsWith('.arbiter/'))
    if (changedPaths.length > 0) {
      return `review sidecar sha ${sha} is stale; tracked files changed after dispatch`
    }
  }
  return null
}

function dirtyCheckoutError(sha) {
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (status.status !== 0) return `cannot inspect checkout status for sidecar sha ${sha}`
  const dirtyPaths = String(status.stdout)
    .split(/\r?\n/)
    .filter((line) => line.length > 2)
    .map((line) => line.slice(3))
    .filter((path) => path.length > 0 && !path.startsWith('.arbiter/'))
  if (dirtyPaths.length > 0) {
    return `review sidecar sha ${sha} is stale; checkout has unreviewed changes`
  }
  return null
}

/**
 * #2399 — a sidecar recorded for another task is ABSENT, not a mismatch: the tracked
 * `.arbiter/agents-dispatched.json` is shared by every branch, so one task's sidecar
 * otherwise fails every other branch's gate.
 *
 * @param {string} reason
 * @returns {{ exitCode: number }}
 */
function sidecarAbsent(reason) {
  if (requestedTask) {
    process.stderr.write(
      `[check-review-completion] FAIL: dispatch sidecar is required for task ${requestedTask} (${reason})\n`,
    )
    return { exitCode: 1 }
  }
  process.stdout.write(`[check-review-completion] OK — ${reason}, vacuous pass\n`)
  return { exitCode: 0 }
}

function loadSidecarForCheck() {
  const sidecarState = inspectFilePath(sidecarPath)
  if ('error' in sidecarState) {
    process.stderr.write(
      `[check-review-completion] ERROR: cannot read sidecar ${sidecarPath}: ${sidecarState.error}\n`,
    )
    return { exitCode: 2 }
  }
  if (!sidecarState.exists) return sidecarAbsent('dispatch sidecar not found')
  const sidecarResult = readDispatchSidecar()
  if ('error' in sidecarResult) {
    process.stderr.write(
      `[check-review-completion] ERROR: cannot read sidecar ${sidecarPath}: ${sidecarResult.error}\n`,
    )
    return { exitCode: 2 }
  }
  if (isForeignSidecar(sidecarResult.sidecar, activeTask)) {
    return sidecarAbsent(
      `dispatch sidecar belongs to task ${sidecarTask(sidecarResult.sidecar)}, not ${activeTask}`,
    )
  }
  // #2399 — in CI there is no `.claude/.task/status.json` (it is local-only) and the gate
  // runs without `--task`, so the BRANCH is the only task identity available. A sidecar
  // recorded on another branch is another task's, and this tracked file is shared by all
  // of them: absent, not a mismatch error.
  const branch = gitLine(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== null && sidecarResult.sidecar.branch !== branch) {
    return sidecarAbsent(
      `dispatch sidecar was recorded on branch ${sidecarResult.sidecar.branch}, not ${branch}`,
    )
  }
  return sidecarResult
}

function resolveTaskContext(sidecar) {
  const taskError = sidecarTaskError(sidecar, requestedTask)
  if (taskError) {
    process.stderr.write(`[check-review-completion] ERROR: ${taskError}\n`)
    return { exitCode: 2 }
  }
  const task = requestedTask ?? sidecarTask(sidecar)
  if (!task) {
    process.stdout.write('[check-review-completion] OK — task id unavailable, vacuous pass\n')
    return { exitCode: 0 }
  }
  if (!isTaskId(task)) {
    process.stderr.write(
      `[check-review-completion] ERROR: --task must be a GitHub issue id like '#2177' (got: ${task})\n`,
    )
    return { exitCode: 2 }
  }
  return { task }
}

function main() {
  const sidecarResult = loadSidecarForCheck()
  if ('exitCode' in sidecarResult) return sidecarResult.exitCode
  const taskResult = resolveTaskContext(sidecarResult.sidecar)
  if ('exitCode' in taskResult) return taskResult.exitCode
  const { sidecar } = sidecarResult
  const { task } = taskResult

  const checkoutError = checkoutBindingError(sidecar)
  if (checkoutError) {
    process.stderr.write(`[check-review-completion] ERROR: ${checkoutError}\n`)
    return 2
  }

  /** @type {Record<string, unknown>} */
  let schema
  try {
    schema = loadSchema(schemaPath)
  } catch (err) {
    process.stderr.write(
      `[check-review-completion] ERROR: cannot load schema: ${errorMessage(err)}\n`,
    )
    return 2
  }

  const taskName = sanitizeTask(task)
  const taskDirs = [join(evidenceDir, taskName)]
  if (taskName.startsWith('_')) taskDirs.push(join(evidenceDir, taskName.slice(1)))
  const listed = listEnvelopeFiles(evidenceDir, taskDirs)
  if ('error' in listed) {
    process.stderr.write(
      `[check-review-completion] ERROR: cannot read task evidence: ${listed.error}\n`,
    )
    return 2
  }
  const valid = readEnvelopes(listed.files, schema)
  return reportReviewFailures(collectReviewFailures(sidecar, task, listed.files, valid))
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(`[check-review-completion] ERROR: ${errorMessage(err)}\n`)
  process.exit(2)
}
