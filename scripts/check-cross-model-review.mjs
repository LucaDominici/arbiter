#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: validates task-scoped cross-model dispatch evidence, not the reviewer envelope corpus.
// CATALOG: it cannot fold into check-agent-return.mjs because a missing external dispatch has no envelope for a corpus walk to discover.
// CATALOG: it cannot fold into check-review-completion.mjs because that reconciles reviewer counts, not provider, degradation reason, or vendor provenance.
// CATALOG: it cannot fold into check-agent-dispatch.mjs because that replays a static matrix and has no runtime artifact input; the src/ provider check is also outside the fail-open census, so this artifact is the compensating control.
//
// Exit codes (INV-53): 0 PASS/SKIP, 1 evidence or policy FAIL, 2 invocation/IO ERROR.
// Usage: node scripts/check-cross-model-review.mjs [--root <dir>] [--task <id>]

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { enforceCitations, loadSchema, validateSchema } from './lib/agent-return-validate.mjs'

const args = process.argv.slice(2)
function option(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const root = resolve(option('--root') ?? process.cwd())
const configPath = join(root, 'arbiter.json')

function fail(message) {
  process.stderr.write(`[check-cross-model-review] FAIL: ${message}\n`)
  process.exit(1)
}

function error(message) {
  process.stderr.write(`[check-cross-model-review] ERROR: ${message}\n`)
  process.exit(2)
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
    // FAIL-OPEN-INTENT: error() emits the failure and exits 2; the catch cannot return a pass.
  } catch (cause) {
    error(`cannot read ${label} ${path}: ${cause instanceof Error ? cause.message : String(cause)}`)
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

if (!existsSync(configPath)) {
  process.stdout.write('[check-cross-model-review] skipped: crossModelReview not enabled\n')
  process.exit(0)
}

const config = readJson(configPath, 'configuration')
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
  if (envOverride === undefined && crossModel.enabled !== false) {
    fail('crossModelReview.enabled must be boolean')
  }
  const reason = envOverride === false ? 'disabled-by-env' : 'not enabled'
  process.stdout.write(`[check-cross-model-review] skipped: crossModelReview ${reason}\n`)
  process.exit(0)
}

const statusPath = join(root, '.claude', '.task', 'status.json')
const status = option('--task')
  ? { taskId: option('--task') }
  : existsSync(statusPath)
    ? readJson(statusPath, 'task state')
    : null
if (!isRecord(status) || typeof status.taskId !== 'string' || status.taskId.length === 0) {
  fail(`enabled crossModelReview has no task id in ${statusPath}`)
}

const taskId = status.taskId
const taskSegment = taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown'
const evidencePath = join(root, '.arbiter', 'evidence', 'cross-model', taskSegment, 'dispatch.json')
if (!existsSync(evidencePath)) fail(`dispatch evidence missing: ${evidencePath}`)

const schemaPath = join(root, 'schemas', 'cross-model-dispatch.schema.json')
let schema
try {
  schema = loadSchema(schemaPath)
  // FAIL-OPEN-INTENT: error() emits the failure and exits 2; the catch cannot return a pass.
} catch (cause) {
  error(
    `cannot load dispatch schema ${schemaPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
  )
}
const agentSchemaPath = join(root, 'schemas', 'agent-return.schema.json')
let agentSchema
try {
  agentSchema = loadSchema(agentSchemaPath)
  // FAIL-OPEN-INTENT: error() emits the failure and exits 2; the catch cannot return a pass.
} catch (cause) {
  error(
    `cannot load agent-return schema ${agentSchemaPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
  )
}
const artifact = readJson(evidencePath, 'dispatch evidence')
const schemaErrors = validateSchema(artifact, schema, schema, evidencePath)
if (schemaErrors.length > 0) fail(schemaErrors.join('; '))
if (artifact.taskId !== taskId) {
  fail(
    `dispatch taskId ${JSON.stringify(artifact.taskId)} does not match active task ${JSON.stringify(taskId)}`,
  )
}

if (artifact.requested.length === 0) {
  if (artifact.fulfilled.length > 0 || artifact.degraded.length > 0) {
    fail('dispatch has outcomes but no requested external slot')
  }
} else if (artifact.fulfilled.length === 0 && artifact.degraded.length === 0) {
  fail('every requested external slot must have a fulfilled or degraded outcome')
} else if (artifact.fulfilled.length > artifact.requested.length) {
  fail('dispatch has more fulfilled slots than requested external slots')
} else if (
  artifact.degraded.length === 0 &&
  artifact.fulfilled.length < artifact.requested.length
) {
  fail('dispatch leaves a requested external slot without an outcome')
}

const repoResolved = resolve(root)
const agentReturnsRoot = resolve(root, '.arbiter', 'evidence', 'agent-returns')
for (const [index, fulfilled] of artifact.fulfilled.entries()) {
  const envelope = fulfilled.envelope
  if (isAbsolute(envelope)) fail(`fulfilled[${index}].envelope must be repo-relative`)
  const envelopePath = resolve(root, envelope)
  const outside = relative(repoResolved, envelopePath).startsWith('..')
  if (outside) fail(`fulfilled[${index}].envelope escapes the repository: ${envelope}`)
  const outsideAgentReturns = relative(agentReturnsRoot, envelopePath)
  if (
    outsideAgentReturns === '' ||
    outsideAgentReturns.startsWith('..') ||
    isAbsolute(outsideAgentReturns)
  ) {
    fail(`fulfilled[${index}].envelope must be under .arbiter/evidence/agent-returns: ${envelope}`)
  }
  if (!existsSync(envelopePath)) fail(`fulfilled[${index}].envelope not found: ${envelope}`)
  const envelopeValue = readJson(envelopePath, 'fulfilled envelope')
  const envelopeSchemaErrors = validateSchema(envelopeValue, agentSchema, agentSchema, envelopePath)
  if (envelopeSchemaErrors.length > 0) fail(envelopeSchemaErrors.join('; '))
  if (!isRecord(envelopeValue) || envelopeValue.taskId !== taskId) {
    fail(`fulfilled[${index}].envelope taskId must match active task ${JSON.stringify(taskId)}`)
  }
  const provenance = isRecord(envelopeValue.provenance) ? envelopeValue.provenance : null
  if (
    provenance?.vendor !== 'openai' ||
    provenance.dispatch !== 'external-cli' ||
    provenance.cli !== 'codex'
  ) {
    fail(
      `fulfilled[${index}].envelope must carry Codex provenance (vendor=openai, dispatch=external-cli, cli=codex)`,
    )
  }
  const citationErrors = enforceCitations(envelopeValue, root, envelopePath)
  if (citationErrors.length > 0) fail(citationErrors.join('; '))
}

if (crossModel.onUnavailable === 'fail' && artifact.degraded.length > 0) {
  fail('crossModelReview.onUnavailable=fail with degraded dispatch evidence')
}

process.stdout.write(
  `[check-cross-model-review] PASS — ${artifact.requested.length} requested, ` +
    `${artifact.fulfilled.length} fulfilled, ${artifact.degraded.length} degraded\n`,
)
process.exit(0)
