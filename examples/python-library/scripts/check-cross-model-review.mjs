#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: validates task-scoped cross-model dispatch evidence, not the reviewer envelope corpus.
// CATALOG: it cannot fold into check-agent-return.mjs because a missing external dispatch has no envelope for a corpus walk to discover.
// CATALOG: it cannot fold into check-review-completion.mjs because that reconciles reviewer counts, not provider, degradation reason, or vendor provenance.
// CATALOG: it cannot fold into check-agent-dispatch.mjs because that replays a static matrix and has no runtime artifact input; the src/ provider check is also outside the fail-open census, so this artifact is the compensating control.
//
// Exit codes (INV-53): 0 PASS/SKIP, 1 evidence or policy FAIL, 2 invocation/IO ERROR.
// Usage: node scripts/check-cross-model-review.mjs [--root <dir>] [--task <id>] [--require-degraded]

import {
  constants as fsConstants,
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { enforceCitations, validateSchema } from './lib/agent-return-validate.mjs'

const args = process.argv.slice(2)
const requireFulfilled = args.includes('--require-fulfilled')
const requireDegraded = args.includes('--require-degraded')
function option(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const root = resolve(option('--root') ?? process.cwd())

function fail(message) {
  process.stderr.write(`[check-cross-model-review] FAIL: ${message}\n`)
  process.exit(1)
}

function error(message) {
  process.stderr.write(`[check-cross-model-review] ERROR: ${message}\n`)
  process.exit(2)
}

function descriptorPath(fd) {
  return `${process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'}/${fd}`
}

function containedParts(relativePath) {
  if (isAbsolute(relativePath)) throw new Error(`contained path must be relative: ${relativePath}`)
  const parts = relativePath.split(/[\\/]+/)
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`contained path has invalid components: ${relativePath}`)
  }
  return parts
}

function openContainedDirectory(rootDir, directoryParts) {
  if (process.platform === 'win32') {
    error('descriptor-relative filesystem operations are unsupported on Windows')
  }
  const flags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW
  let fd = -1
  try {
    fd = openSync('/', flags)
    for (const part of [...resolve(rootDir).split('/').filter(Boolean), ...directoryParts]) {
      const next = openSync(join(descriptorPath(fd), part), flags)
      closeSync(fd)
      fd = next
    }
    return fd
  } catch (cause) {
    if (fd !== -1) closeSync(fd)
    throw cause
  }
}

function readFileContained(rootDir, relativePath, label) {
  if (process.platform === 'win32') {
    error(`${label} descriptor-relative reads are unsupported on Windows`)
  }
  let dirFd = -1
  let fileFd = -1
  try {
    const parts = containedParts(relativePath)
    const fileName = parts.pop()
    dirFd = openContainedDirectory(rootDir, parts)
    fileFd = openSync(
      join(descriptorPath(dirFd), fileName),
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    )
    return readFileSync(fileFd, 'utf-8')
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    if (cause?.code === 'ENOENT' || cause?.code === 'ELOOP' || cause?.code === 'ENOTDIR') {
      fail(`cannot read ${label} ${join(rootDir, relativePath)}: ${detail}`)
    }
    error(`cannot read ${label} ${join(rootDir, relativePath)}: ${detail}`)
    throw cause
  } finally {
    if (fileFd !== -1) closeSync(fileFd)
    if (dirFd !== -1) closeSync(dirFd)
  }
}

function writeFileContained(rootDir, relativePath, data, label) {
  let dirFd = -1
  let tempFd = -1
  let tempPath = null
  try {
    const parts = containedParts(relativePath)
    const fileName = parts.pop()
    dirFd = openContainedDirectory(rootDir, parts)
    const dirPath = descriptorPath(dirFd)
    tempPath = join(dirPath, `.arbiter-tmp-${randomBytes(4).toString('hex')}`)
    tempFd = openSync(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    )
    writeFileSync(tempFd, data, 'utf-8')
    closeSync(tempFd)
    tempFd = -1
    renameSync(tempPath, join(dirPath, fileName))
    tempPath = null
  } catch (cause) {
    error(`cannot write ${label} ${join(rootDir, relativePath)}: ${cause instanceof Error ? cause.message : String(cause)}`)
    throw cause
  } finally {
    if (tempFd !== -1) closeSync(tempFd)
    if (tempPath !== null) {
      try {
        unlinkSync(tempPath)
      // FAIL-OPEN-INTENT: cleanup failure must not replace the primary write error.
      } catch {
        // Preserve the primary write error.
      }
    }
    if (dirFd !== -1) closeSync(dirFd)
  }
}

function readContainedJson(rootDir, relativePath, label) {
  try {
    return JSON.parse(readFileContained(rootDir, relativePath, label))
  } catch (cause) {
    error(`cannot parse ${label} ${join(rootDir, relativePath)}: ${cause instanceof Error ? cause.message : String(cause)}`)
    throw cause
  }
}

function containedExists(rootDir, relativePath, label) {
  let dirFd = -1
  let fileFd = -1
  try {
    const parts = containedParts(relativePath)
    const fileName = parts.pop()
    dirFd = openContainedDirectory(rootDir, parts)
    fileFd = openSync(join(descriptorPath(dirFd), fileName), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    return true
  } catch (cause) {
    if (cause?.code === 'ENOENT') return false
    const detail = cause instanceof Error ? cause.message : String(cause)
    if (cause?.code === 'ELOOP' || cause?.code === 'ENOTDIR') {
      fail(`cannot read ${label} ${join(rootDir, relativePath)}: ${detail}`)
    }
    error(`cannot read ${label} ${join(rootDir, relativePath)}: ${detail}`)
    return false
  } finally {
    if (fileFd !== -1) closeSync(fileFd)
    if (dirFd !== -1) closeSync(dirFd)
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBooleanEnv(raw) {
  if (raw === undefined) return undefined
  const value = raw.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(value)) return true
  if (['false', '0', 'no', 'off'].includes(value)) return false
  return undefined
}

if (!containedExists(root, 'arbiter.json', 'configuration')) {
  if (requireFulfilled) fail('cross-model review is not enabled')
  process.stdout.write('[check-cross-model-review] skipped: crossModelReview not enabled\n')
  process.exit(0)
}

const config = readContainedJson(root, 'arbiter.json', 'configuration')
if (!isRecord(config)) error('arbiter.json must contain an object')
const envOverride = parseBooleanEnv(process.env.ARBITER_CROSS_MODEL_REVIEW)
const configuredCrossModel = config.crossModelReview
let crossModel
if (configuredCrossModel === undefined) {
  if (envOverride !== true) {
    process.stdout.write('[check-cross-model-review] skipped: crossModelReview not enabled\n')
    process.exit(0)
  }
  crossModel = { enabled: true, onUnavailable: 'degrade' }
} else {
  if (!isRecord(configuredCrossModel)) fail('crossModelReview must be an object when present')
  crossModel = configuredCrossModel
}
const enabled = envOverride ?? crossModel.enabled
if (enabled !== true) {
  if (requireFulfilled) fail('cross-model review is not enabled')
  if (envOverride === undefined && crossModel.enabled !== false) {
    fail('crossModelReview.enabled must be boolean')
  }
  if (requireDegraded) {
    process.stdout.write('[check-cross-model-review] skipped: crossModelReview not enabled\n')
    process.exit(0)
  }
  const reason = envOverride === false ? 'disabled-by-env' : 'not enabled'
  process.stdout.write(`[check-cross-model-review] skipped: crossModelReview ${reason}\n`)
  process.exit(0)
}

const statusPath = join(root, '.claude', '.task', 'status.json')
const status = option('--task')
  ? { taskId: option('--task') }
  : containedExists(root, '.claude/.task/status.json', 'task state')
    ? readContainedJson(root, '.claude/.task/status.json', 'task state')
    : null
if (!isRecord(status) || typeof status.taskId !== 'string' || status.taskId.length === 0) {
  fail(`enabled crossModelReview has no task id in ${statusPath}`)
}

const taskId = status.taskId
const taskSegment = taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown'
const evidenceRelativePath = join(
  '.arbiter',
  'evidence',
  'cross-model',
  taskSegment,
  'dispatch.json',
)
const evidencePath = join(root, evidenceRelativePath)

function gitValue(args, label) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    // FAIL-OPEN-INTENT: an unreadable revision is an ERROR, never a pass without binding evidence to the current checkout.
  } catch (cause) {
    error(`cannot resolve current ${label}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

const schemaPath = join(root, 'schemas', 'cross-model-dispatch.schema.json')
let schema
try {
  if (!containedExists(root, 'schemas/cross-model-dispatch.schema.json', 'dispatch schema')) {
    throw new Error(`schema not found: ${schemaPath}`)
  }
  schema = readContainedJson(root, 'schemas/cross-model-dispatch.schema.json', 'dispatch schema')
  // FAIL-OPEN-INTENT: error() emits the failure and exits 2; the catch cannot return a pass.
} catch (cause) {
  error(`cannot load dispatch schema ${schemaPath}: ${cause instanceof Error ? cause.message : String(cause)}`)
}
const agentSchemaPath = join(root, 'schemas', 'agent-return.schema.json')
let agentSchema
try {
  if (!containedExists(root, 'schemas/agent-return.schema.json', 'agent-return schema')) {
    throw new Error(`schema not found: ${agentSchemaPath}`)
  }
  agentSchema = readContainedJson(root, 'schemas/agent-return.schema.json', 'agent-return schema')
  // FAIL-OPEN-INTENT: error() emits the failure and exits 2; the catch cannot return a pass.
} catch (cause) {
  error(`cannot load agent-return schema ${agentSchemaPath}: ${cause instanceof Error ? cause.message : String(cause)}`)
}
const artifact = readContainedJson(root, evidenceRelativePath, 'dispatch evidence')
const schemaErrors = validateSchema(artifact, schema, schema, evidencePath)
if (schemaErrors.length > 0) fail(schemaErrors.join('; '))
if (artifact.taskId !== taskId) {
  fail(`dispatch taskId ${JSON.stringify(artifact.taskId)} does not match active task ${JSON.stringify(taskId)}`)
}

const currentBranch = gitValue(['branch', '--show-current'], 'branch')
const currentSha = gitValue(['rev-parse', 'HEAD'], 'HEAD SHA')
if (artifact.branch !== currentBranch) {
  fail(`dispatch branch ${JSON.stringify(artifact.branch)} does not match current branch ${JSON.stringify(currentBranch)}`)
}
if (artifact.sha !== currentSha) {
  fail(`dispatch SHA ${JSON.stringify(artifact.sha)} does not match current HEAD ${JSON.stringify(currentSha)}`)
}

const changedPaths = [
  gitValue(['diff', '--name-only'], 'working tree changes')
    .split(/\r?\n/)
    .filter(Boolean),
  gitValue(['diff', '--cached', '--name-only'], 'index changes')
    .split(/\r?\n/)
    .filter(Boolean),
  gitValue(['status', '--porcelain=v1', '--untracked-files=all'], 'checkout status')
    .split(/\r?\n/)
    .filter((line) => line.length > 2)
    .map((line) => line.slice(3)),
]
  .flat()
  .filter((path) => path.length > 0 && !path.startsWith('.arbiter/'))
if (changedPaths.length > 0) {
  fail('checkout has unreviewed changes after cross-model dispatch')
}

if (
  artifact.requested.length > 1 ||
  artifact.fulfilled.length > 1 ||
  artifact.degraded.length > 1
) {
  fail('cross-model dispatch has one external seat; requested and outcome arrays must contain at most one entry')
}

if (artifact.requested.length === 0) {
  if (artifact.fulfilled.length > 0 || artifact.degraded.length > 0) {
    fail('dispatch has outcomes but no requested external slot')
  }
} else if (artifact.fulfilled.length === 0 && artifact.degraded.length === 0) {
  fail('every requested external slot must have a fulfilled or degraded outcome')
} else if (artifact.fulfilled.length + artifact.degraded.length !== artifact.requested.length) {
  fail(`dispatch outcomes (${artifact.fulfilled.length + artifact.degraded.length}) do not match requested external slots (${artifact.requested.length})`)
}

if (
  requireFulfilled &&
  (artifact.requested.length !== 1 || artifact.fulfilled.length !== 1 || artifact.degraded.length !== 0)
) {
  fail('--require-fulfilled needs exactly one fulfilled Codex seat and no degradation')
}
if (
  requireDegraded &&
  (artifact.requested.length !== 1 || artifact.fulfilled.length !== 0 || artifact.degraded.length !== 1)
) {
  fail('--require-degraded needs exactly one degraded external seat and no fulfillment')
}

const agentReturnsRoot = resolve(root, '.arbiter', 'evidence', 'agent-returns', taskSegment)
for (const [index, fulfilled] of artifact.fulfilled.entries()) {
  const envelope = fulfilled.envelope
  if (isAbsolute(envelope)) fail(`fulfilled[${index}].envelope must be repo-relative`)
  const envelopePath = resolve(root, envelope)
  const outside = relative(root, envelopePath)
  if (outside.startsWith('..') || isAbsolute(outside)) {
    fail(`fulfilled[${index}].envelope escapes the repository: ${envelope}`)
  }
  const outsideAgentReturns = relative(agentReturnsRoot, envelopePath)
  if (outsideAgentReturns === '' || outsideAgentReturns.startsWith('..') || isAbsolute(outsideAgentReturns)) {
    fail(`fulfilled[${index}].envelope must be under the active task's agent-return directory: ${envelope}`)
  }
  const envelopeName = relative(agentReturnsRoot, envelopePath)
  if (!/^codex-reviewer(?:-\d+)?\.json$/.test(envelopeName)) {
    fail(`fulfilled[${index}].envelope must use the canonical Codex reviewer filename: ${envelope}`)
  }
  const envelopeValue = readContainedJson(root, envelope, 'fulfilled envelope')
  const envelopeSchemaErrors = validateSchema(envelopeValue, agentSchema, agentSchema, envelopePath)
  if (envelopeSchemaErrors.length > 0) fail(envelopeSchemaErrors.join('; '))
  if (envelopeValue.agent !== 'codex-reviewer' || envelopeValue.role !== 'reviewer') {
    fail(`fulfilled[${index}].envelope must be the Codex reviewer envelope`)
  }
  if (!isRecord(envelopeValue) || envelopeValue.taskId !== taskId) {
    fail(`fulfilled[${index}].envelope taskId must match active task ${JSON.stringify(taskId)}`)
  }
  if (envelopeValue.branch !== currentBranch) {
    fail(`fulfilled[${index}].envelope branch ${JSON.stringify(envelopeValue.branch)} does not match current branch ${JSON.stringify(currentBranch)}`)
  }
  if (envelopeValue.sha !== currentSha) {
    fail(`fulfilled[${index}].envelope SHA ${JSON.stringify(envelopeValue.sha)} does not match current HEAD ${JSON.stringify(currentSha)}`)
  }
  const provenance = isRecord(envelopeValue.provenance) ? envelopeValue.provenance : null
  if (
    provenance?.vendor !== 'openai' ||
    provenance.dispatch !== 'external-cli' ||
    provenance.cli !== 'codex'
  ) {
    fail(`fulfilled[${index}].envelope must carry Codex provenance (vendor=openai, dispatch=external-cli, cli=codex)`)
  }
  const citationErrors = enforceCitations(envelopeValue, root, envelopePath)
  if (citationErrors.length > 0) fail(citationErrors.join('; '))
}

if (crossModel.onUnavailable === 'fail' && artifact.degraded.length > 0) {
  fail('crossModelReview.onUnavailable=fail with degraded dispatch evidence')
}
if (artifact.fulfilled.length > 0 && crossModel.diffEgressConsent !== true) {
  fail('fulfilled cross-model evidence requires current diffEgressConsent=true')
}

const recordPanel = option('--record-panel')
if (recordPanel !== undefined) {
  if (!requireFulfilled) error('--record-panel requires --require-fulfilled')
  const recordCount = Number(option('--record-count'))
  let agents
  try {
    agents = JSON.parse(recordPanel)
  } catch (cause) {
    error(`cannot parse reviewer panel: ${cause instanceof Error ? cause.message : String(cause)}`)
    throw cause
  }
  if (!Array.isArray(agents) || !Number.isInteger(recordCount) || agents.length !== recordCount) {
    error('reviewer panel count does not match its agent list')
  }
  writeFileContained(
    root,
    '.arbiter/agents-dispatched.json',
    `${JSON.stringify({ count: recordCount, agents, taskId, branch: currentBranch, sha: currentSha })}\n`,
    'reviewer sidecar',
  )
}

process.stdout.write(
  `[check-cross-model-review] PASS — ${artifact.requested.length} requested, ` +
    `${artifact.fulfilled.length} fulfilled, ${artifact.degraded.length} degraded\n`,
)
process.exit(0)
