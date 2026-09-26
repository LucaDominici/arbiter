#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: E1 (#1943, M8 core) — agent-return envelope recorder. The orchestrator pipes a
// CATALOG: sub-agent's JSON return through this recorder, which (a) validates it against
// CATALOG: schemas/agent-return.schema.json BEFORE writing — a malformed return fails at
// CATALOG: hand-back time, not at gate time; (b) stamps branch/sha/ts itself (never trusted
// CATALOG: from input, same authority model as gate-pass.json written by check-all.mjs);
// CATALOG: (c) writes .arbiter/evidence/agent-returns/<sanitized-task>/<agent>-<n>.json.
// CATALOG: Rejected fold-in into check-agent-return.mjs: that VALIDATES the persisted corpus
// CATALOG: at gate time; this RECORDS a single return at hand-back time with authority-stamped
// CATALOG: provenance. Different lifecycle (write-path vs read-path), shared validator lib.
//
//INV-138 (advisory at land-time per design §0).
// Exit codes (INV-53): 0 written, 1 invalid input (schema/M12 violation — nothing written),
// 2 ERROR (self / IO failure).
//
// Usage:
//   node scripts/record-agent-return.mjs --task '#NNN' [--evidence-dir=<path>]
//                                       [--repo-root=<path>] < return.json
import {
  constants as fsConstants,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  validateSchema,
  enforceCitations,
  enforceAcFitCitations,
  loadSchema,
} from './lib/agent-return-validate.mjs'
import { arg } from './lib/gate-args.mjs'
import { DISPATCH_SIDECAR_DIR, dispatchSidecarName } from './lib/evidence-binding.mjs'
import { computeAcHash, parsePlanAnchor, validateAcFit } from './lib/acceptance-criteria.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const TASK_ID = arg('task', argv)
const MODE = arg('mode', argv) ?? 'return'
let nativeHostBindingError
if (MODE !== 'return') {
  ;({ nativeHostBindingError } = await import('../.claude/hooks/lib.mjs'))
}
const PROVENANCE_VENDOR = arg('provenance-vendor', argv)
const PROVENANCE_CLI = arg('provenance-cli', argv)
const PROVENANCE_CLI_VERSION = arg('provenance-cli-version', argv)
const PROVENANCE_DISPATCH = arg('provenance-dispatch', argv)
const PROVENANCE_MODEL = arg('provenance-model', argv)
const PROVENANCE_EFFORT = arg('provenance-effort', argv)
const EXPECTED_SHA = arg('expected-sha', argv)
const REPO_ROOT = arg('repo-root', argv) ? resolve(arg('repo-root', argv)) : repoDefault
const EVIDENCE_DIR = arg('evidence-dir', argv)
  ? resolve(arg('evidence-dir', argv))
  : join(REPO_ROOT, '.arbiter', 'evidence', 'agent-returns')
const SCHEMA_PATH = join(repoDefault, 'schemas', 'agent-return.schema.json')

function readStdin() {
  return new Promise((resolveRead) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolveRead(data))
    process.stdin.on('error', () => resolveRead(''))
  })
}

function stampProvenance() {
  let branch = 'unknown'
  let sha = '0000000'
  try {
    branch =
      execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim() || 'unknown'
    // FAIL-OPEN-INTENT: git rev-parse --abbrev-ref HEAD failed — non-git fixture dir; branch defaults to "unknown" (stamped, not trusted from input).
  } catch {
    /* non-git fixture */
  }
  try {
    sha =
      execSync('git rev-parse HEAD', {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
      })
        .trim()
        .slice(0, 40) || '0000000'
    // FAIL-OPEN-INTENT: git rev-parse HEAD failed — non-git fixture dir; sha defaults to "0000000" (stamped, not trusted from input).
  } catch {
    /* non-git fixture */
  }
  return { branch, sha, ts: new Date().toISOString() }
}

function currentIdentity() {
  const stamped = stampProvenance()
  if (stamped.branch === 'unknown' || stamped.sha === '0000000') {
    throw new Error('current Git identity is unavailable')
  }
  return stamped
}

function stampAgentProvenance() {
  const provenance = {
    vendor: PROVENANCE_VENDOR ?? 'anthropic',
    dispatch: PROVENANCE_DISPATCH ?? 'subagent',
  }
  if (PROVENANCE_CLI !== null) provenance.cli = PROVENANCE_CLI
  if (PROVENANCE_CLI_VERSION !== null) provenance.cliVersion = PROVENANCE_CLI_VERSION
  if (PROVENANCE_MODEL !== null) provenance.model = PROVENANCE_MODEL
  if (PROVENANCE_EFFORT !== null) provenance.effort = PROVENANCE_EFFORT
  return provenance
}

function descriptorPath(fd) {
  return `${process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'}/${fd}`
}

function openContainedDirectory(rootDir, childParts) {
  if (process.platform === 'win32') {
    throw new Error('secure agent-return recording is unsupported on Windows')
  }
  const flags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW
  const absoluteRoot = resolve(rootDir)
  let fd = -1
  try {
    fd = openSync('/', flags)
    for (const part of [...absoluteRoot.split('/').filter(Boolean), ...childParts]) {
      const child = join(descriptorPath(fd), part)
      try {
        mkdirSync(child)
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err
      }
      const next = openSync(child, flags)
      closeSync(fd)
      fd = next
    }
    return fd
  } catch (err) {
    if (fd !== -1) closeSync(fd)
    throw err
  }
}

function writeEnvelopeShard(dirPath, evidenceDir, task, agent, filename, content) {
  const path = join(dirPath, filename)
  let fileFd = -1
  try {
    fileFd = openSync(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    )
    writeFileSync(fileFd, content, 'utf8')
    closeSync(fileFd)
    fileFd = -1
    return join(evidenceDir, task, filename)
  } catch (err) {
    if (fileFd !== -1) {
      try {
        closeSync(fileFd)
        // FAIL-OPEN-INTENT: cleanup close failure must not replace the primary write error.
      } catch {
        // Preserve the primary write error.
      }
    }
    if (err?.code === 'EEXIST') return null
    try {
      unlinkSync(path)
      // FAIL-OPEN-INTENT: best-effort cleanup must not replace the primary write error.
    } catch {
      // Preserve the primary write error.
    }
    throw err
  }
}

function writeEnvelopeContained(evidenceDir, task, agent, content) {
  let dirFd = -1
  try {
    dirFd = openContainedDirectory(evidenceDir, [task])
    const dirPath = descriptorPath(dirFd)
    let n = 0
    try {
      n = readdirSync(dirPath).filter(
        (f) => f.startsWith(`${agent}-`) && f.endsWith('.json'),
      ).length
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err
      // A freshly opened task directory may be empty; its first shard is zero.
    }
    for (let attempt = 0; attempt < 10_000; attempt++, n++) {
      const filename = `${agent}-${n}.json`
      const outPath = writeEnvelopeShard(dirPath, evidenceDir, task, agent, filename, content)
      if (outPath !== null) return outPath
    }
    throw new Error(`too many agent-return shards for ${agent}`)
  } finally {
    if (dirFd !== -1) closeSync(dirFd)
  }
}

function writeAtomicContained(rootDir, childParts, filename, content) {
  let dirFd = -1
  let tempPath = null
  try {
    dirFd = openContainedDirectory(rootDir, childParts)
    const dirPath = descriptorPath(dirFd)
    tempPath = join(dirPath, `.arbiter-tmp-${randomBytes(6).toString('hex')}`)
    const fd = openSync(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    )
    try {
      writeFileSync(fd, content, 'utf8')
    } finally {
      closeSync(fd)
    }
    renameSync(tempPath, join(dirPath, filename))
    tempPath = null
  } finally {
    if (tempPath !== null) {
      try {
        unlinkSync(tempPath)
        // FAIL-OPEN-INTENT: cleanup failure must not replace the primary write error.
      } catch {
        // Preserve the primary error.
      }
    }
    if (dirFd !== -1) closeSync(dirFd)
  }
}

function parseInput(raw) {
  try {
    return { parsed: JSON.parse(raw) }
  } catch (err) {
    process.stdout.write(
      `[record-agent-return] FAIL: invalid JSON stdin: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return { exitCode: 1 }
  }
}

function loadReturnSchema() {
  try {
    return { schema: loadSchema(SCHEMA_PATH) }
  } catch (err) {
    process.stderr.write(
      `[record-agent-return] ERROR: cannot load schema: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return { exitCode: 2 }
  }
}

function stampAndValidate(parsed, schema) {
  // The agent supplies everything EXCEPT authority fields (branch/sha/ts/provenance). The
  // recorder stamps those itself — never trusted from input — then validates the FULL stamped
  // envelope against the schema before writing. A malformed return fails at hand-back time.
  const stamped = stampProvenance()
  if (EXPECTED_SHA !== null && stamped.sha !== EXPECTED_SHA) {
    throw new Error(`HEAD drifted from expected ${EXPECTED_SHA} (current ${stamped.sha})`)
  }
  const env = /** @type {Record<string, unknown>} */ (parsed)
  env['branch'] = stamped.branch
  env['sha'] = stamped.sha
  env['ts'] = stamped.ts
  env['provenance'] = stampAgentProvenance()
  const schemaErrors = validateSchema(env, schema, schema, '<stdin>')
  if (schemaErrors.length > 0) {
    for (const error of schemaErrors) process.stdout.write(`[record-agent-return] FAIL: ${error}\n`)
    return null
  }
  const citationErrors = enforceCitations(env, REPO_ROOT, '<stdin>')
  if (citationErrors.length > 0) {
    for (const error of citationErrors)
      process.stdout.write(`[record-agent-return] FAIL: ${error}\n`)
    return null
  }
  return env
}

function loadActiveTask() {
  const path = join(REPO_ROOT, '.claude', '.task', 'status.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  if (state?.taskId !== TASK_ID)
    throw new Error(`active task ${String(state?.taskId)} does not match ${TASK_ID}`)
  return state
}

// #2911: name the one stale check, in fixed order task → branch → sha → binding.
function staleIdentityCause(parsed, state, stamped) {
  const { taskId, branch, sha } = parsed ?? {}
  if (taskId !== TASK_ID) return { stale: `task (${taskId} ≠ ${TASK_ID})` }
  if (branch !== stamped.branch || state.branch !== stamped.branch)
    return { stale: `branch (${branch}, task ${state.branch} ≠ ${stamped.branch})` }
  if (sha !== stamped.sha) return { stale: `sha (${sha} ≠ ${stamped.sha})` }
  return staleBindingCause(state.hostBinding)
}

function staleBindingCause(binding) {
  if (!binding) return null
  const bindingError = nativeHostBindingError(
    {
      cwd: process.cwd(),
      session_id: process.env.CLAUDE_CODE_SESSION_ID,
      transcript_path: binding.transcriptPath,
    },
    REPO_ROOT,
  )
  return bindingError ? { stale: bindingError, binding: true } : null
}

function staleIdentityError(cause) {
  const remedy = cause.binding
    ? `; run arbiter lifecycle preflight --id '${TASK_ID}' --worktree "${REPO_ROOT}"`
    : ''
  return `stale ${cause.stale}${remedy}`
}

function modeContext(parsed) {
  if (arg('evidence-dir', argv))
    return { error: 'qualified modes write only canonical evidence paths' }
  try {
    const state = loadActiveTask()
    const stamped = currentIdentity()
    const cause = staleIdentityCause(parsed, state, stamped)
    if (cause !== null) return { error: staleIdentityError(cause) }
    return { state, stamped }
    // FAIL-OPEN-INTENT: the returned internal error is surfaced by each mode as exit 2.
  } catch (err) {
    return { internal: err instanceof Error ? err.message : String(err) }
  }
}

function reportModeContextError(context) {
  if ('internal' in context) {
    process.stderr.write(`[record-agent-return] ERROR: ${context.internal}\n`)
    return 2
  }
  if ('error' in context) {
    process.stdout.write(`[record-agent-return] FAIL: ${context.error}\n`)
    return 1
  }
  return 0
}

function frozenPlanAnchor(state, stamped) {
  const planPath = resolve(REPO_ROOT, String(state.plan ?? '').split('#')[0])
  const trackedPlan = relative(REPO_ROOT, planPath)
  try {
    if (!trackedPlan || trackedPlan === '..' || trackedPlan.startsWith('../'))
      throw new Error('plan is outside repository')
    const liveAnchor = parsePlanAnchor(readFileSync(planPath, 'utf8'))
    const anchor = parsePlanAnchor(
      execFileSync('git', ['show', `${stamped.sha}:${trackedPlan}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }),
    )
    if (
      liveAnchor === null ||
      anchor === null ||
      computeAcHash(liveAnchor.criteria) !== computeAcHash(anchor.criteria)
    )
      throw new Error('active plan drifted from the frozen subject')
    return { anchor }
    // FAIL-OPEN-INTENT: the returned error is printed by validatedAcceptanceFit and exits 1.
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function validatedAcceptanceFit(parsed, schema, state, stamped) {
  const env = stampAndValidate(parsed, schema)
  if (env === null) return null
  if ((env.role !== 'verifier' && env.role !== 'reviewer') || !env.acceptanceFit) {
    process.stdout.write(
      '[record-agent-return] FAIL: ac-fit mode requires one final-reviewer or verifier acceptanceFit envelope\n',
    )
    return null
  }
  const frozen = frozenPlanAnchor(state, stamped)
  if ('error' in frozen) {
    process.stdout.write(
      `[record-agent-return] FAIL: frozen plan is unavailable or changed: ${frozen.error}\n`,
    )
    return null
  }
  const criteriaIds = frozen.anchor.criteria.map((criterion) => criterion.id)
  const errors = acceptanceFitErrors(env, criteriaIds, stamped.sha, '<stdin>', false)
  if (errors.length > 0) {
    for (const error of errors) process.stdout.write(`[record-agent-return] FAIL: ${error}\n`)
    return null
  }
  // #2865: a well-formed fit with a non-PASS verdict outside the [exact-main] criteria is still a
  // review result — it is recorded as a return, and no ac-fit is written, so acceptance stays blocked.
  const exactMainIds = frozen.anchor.criteria.filter((c) => c.exactMain).map((c) => c.id)
  const pending = validateAcFit(env.acceptanceFit, criteriaIds, {
    requireAllPass: true,
    exactMainIds,
  })
  return { env, anchor: frozen.anchor, accepted: pending.length === 0 }
}

function acceptanceFitErrors(env, criteriaIds, sha, fitPath, requireAllPass = true) {
  const errors = validateAcFit(env.acceptanceFit, criteriaIds, {
    requireAllPass,
    expectedTaskId: TASK_ID,
  })
  errors.push(...enforceAcFitCitations(env.acceptanceFit, REPO_ROOT, sha, fitPath))
  return errors
}

function acceptanceFitArtifact(env, anchor, stamped, sourcePath, envelopeContent) {
  return {
    ...env.acceptanceFit,
    branch: stamped.branch,
    sha: stamped.sha,
    planHash: computeAcHash(anchor.criteria),
    sourceEnvelope: {
      path: relative(REPO_ROOT, sourcePath),
      sha256: createHash('sha256').update(envelopeContent).digest('hex'),
    },
  }
}

function writeAcceptanceFit(env, anchor, stamped) {
  const sanitizedTask = TASK_ID.replace(/[^0-9A-Za-z-]/g, '_')
  const agent = String(env.agent).replace(/[^0-9A-Za-z-]/g, '-')
  const envelopeContent = `${JSON.stringify(env, null, 2)}\n`
  try {
    const sourcePath = writeEnvelopeContained(
      join(REPO_ROOT, '.arbiter', 'evidence', 'agent-returns'),
      sanitizedTask,
      agent,
      envelopeContent,
    )
    const fit = acceptanceFitArtifact(env, anchor, stamped, sourcePath, envelopeContent)
    writeAtomicContained(
      join(REPO_ROOT, '.arbiter', 'evidence'),
      ['ac-fit'],
      `${TASK_ID.replace(/[^0-9A-Za-z-]/g, '')}.json`,
      `${JSON.stringify(fit, null, 2)}\n`,
    )
    process.stdout.write(`[record-agent-return] OK — recorded verifier envelope and ac-fit\n`)
    return 0
  } catch (err) {
    process.stderr.write(
      `[record-agent-return] ERROR: cannot write evidence: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
}

function recordAcceptanceFit(parsed, schema) {
  const context = modeContext(parsed)
  const contextExit = reportModeContextError(context)
  if (contextExit !== 0) return contextExit
  const { state, stamped } = context
  const validated = validatedAcceptanceFit(parsed, schema, state, stamped)
  if (validated === null) return 1
  if (!validated.accepted) {
    process.stdout.write(
      '[record-agent-return] NOTE: non-PASS acceptance criteria — recorded as a review return; no ac-fit written\n',
    )
    return recordReturn(parsed, schema)
  }
  return writeAcceptanceFit(validated.env, validated.anchor, stamped)
}

function validReviewerVerticals(verticals, count) {
  return (
    Array.isArray(verticals) &&
    verticals.length === count &&
    verticals.every((vertical) => typeof vertical === 'string' && vertical.length > 0) &&
    new Set(verticals).size === verticals.length
  )
}

function routedPanelRequirement(state) {
  const treatment = state.treatment
  const verticals = treatment?.reviewerVerticals
  if (
    treatment?.version !== 1 ||
    !Number.isInteger(treatment.finalReviewers) ||
    treatment.finalReviewers < 1 ||
    treatment.finalReviewers > 3 ||
    !validReviewerVerticals(verticals, treatment.finalReviewers) ||
    typeof treatment.signalsHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(treatment.signalsHash)
  ) {
    throw new Error('active task has no valid persisted ship treatment')
  }
  return {
    count: treatment.finalReviewers,
    auditors: verticals,
    treatmentHash: treatment.signalsHash,
  }
}

function panelRequirement(state) {
  try {
    return { requirement: routedPanelRequirement(state) }
  } catch (err) {
    process.stderr.write(
      `[record-agent-return] ERROR: cannot derive reviewer panel: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return null
  }
}

function validatePanel(envelopes, state, schema, requirement) {
  const validated = validatedReviewers(envelopes, state, schema)
  if (validated === null) return null
  const agents = validated.map((envelope) => String(envelope.agent))
  if (new Set(agents).size !== agents.length) {
    process.stdout.write('[record-agent-return] FAIL: reviewer agents must be distinct\n')
    return null
  }
  if ([...agents].sort().join('\n') !== [...requirement.auditors].sort().join('\n')) {
    process.stdout.write(
      `[record-agent-return] FAIL: reviewer identities must match assigned verticals: ${requirement.auditors.join(', ')}\n`,
    )
    return null
  }
  const fitEnvelopes = validated.filter((envelope) => envelope.acceptanceFit !== undefined)
  if (fitEnvelopes.length === 0) {
    process.stdout.write(
      '[record-agent-return] FAIL: reviewer panel must include an acceptanceFit result from a final reviewer\n',
    )
    return null
  }
  const frozen = frozenPlanAnchor(state, validated[0])
  if ('error' in frozen) {
    process.stdout.write(
      `[record-agent-return] FAIL: frozen plan is unavailable or changed: ${frozen.error}\n`,
    )
    return null
  }
  const criteriaIds = frozen.anchor.criteria.map((criterion) => criterion.id)
  const fitErrors = fitEnvelopes.flatMap((envelope) =>
    acceptanceFitErrors(envelope, criteriaIds, validated[0].sha, '<stdin>', false),
  )
  if (fitErrors.length > 0) {
    for (const error of fitErrors) process.stdout.write(`[record-agent-return] FAIL: ${error}\n`)
    return null
  }
  return { validated, agents, acceptanceFit: fitEnvelopes[0], anchor: frozen.anchor }
}

function validatedReviewers(envelopes, state, schema) {
  const validated = []
  const stamped = currentIdentity()
  for (const candidate of envelopes) {
    const cause = staleIdentityCause(candidate, state, stamped)
    if (cause !== null) {
      process.stdout.write(`[record-agent-return] FAIL: ${staleIdentityError(cause)}\n`)
      return null
    }
    const envelope = stampAndValidate(candidate, schema)
    if (envelope === null || envelope.role !== 'reviewer') return null
    validated.push(envelope)
  }
  return validated
}

function writeReviewerPanel(validated, agents, requirement, acceptanceFit, anchor, stamped) {
  try {
    const evidenceDir = join(REPO_ROOT, '.arbiter', 'evidence', 'agent-returns')
    const task = TASK_ID.replace(/[^0-9A-Za-z-]/g, '_')
    let acceptanceFitPath = null
    let acceptanceFitContent = null
    for (const envelope of validated) {
      const envelopeContent = `${JSON.stringify(envelope, null, 2)}\n`
      const envelopePath = writeEnvelopeContained(
        evidenceDir,
        task,
        String(envelope.agent).replace(/[^0-9A-Za-z-]/g, '-'),
        envelopeContent,
      )
      if (envelope === acceptanceFit) {
        acceptanceFitPath = envelopePath
        acceptanceFitContent = envelopeContent
      }
    }
    if (acceptanceFitPath === null || acceptanceFitContent === null) {
      throw new Error('validated acceptance-fit reviewer has no persisted envelope path')
    }
    const fit = acceptanceFitArtifact(
      acceptanceFit,
      anchor,
      stamped,
      acceptanceFitPath,
      acceptanceFitContent,
    )
    writeAtomicContained(
      join(REPO_ROOT, '.arbiter', 'evidence'),
      ['ac-fit'],
      `${TASK_ID.replace(/[^0-9A-Za-z-]/g, '')}.json`,
      `${JSON.stringify(fit, null, 2)}\n`,
    )
    // #2858 — bind the panel to the provenance its envelopes were stamped with.
    const { vendor, dispatch, cli } = stampAgentProvenance()
    const bound = { vendor, dispatch, ...(cli !== undefined ? { cli } : {}) }
    writeAtomicContained(
      REPO_ROOT,
      DISPATCH_SIDECAR_DIR,
      dispatchSidecarName(TASK_ID),
      `${JSON.stringify({
        count: requirement.count,
        agents,
        auditors: requirement.auditors,
        treatmentHash: requirement.treatmentHash,
        expectedProvenance: Object.fromEntries(agents.map((agent) => [agent, bound])),
        branch: stamped.branch,
        sha: stamped.sha,
        taskId: TASK_ID,
      })}\n`,
    )
    process.stdout.write('[record-agent-return] OK — recorded routed reviewer panel and ac-fit\n')
    return 0
  } catch (err) {
    process.stderr.write(
      `[record-agent-return] ERROR: cannot write panel evidence: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
}

function recordReviewerPanel(parsed, schema) {
  const envelopes = Array.isArray(parsed?.envelopes) ? parsed.envelopes : []
  const context = modeContext(envelopes[0])
  const contextExit = reportModeContextError(context)
  if (contextExit !== 0) return contextExit
  const { state, stamped } = context
  const routed = panelRequirement(state)
  if (routed === null) return 2
  const { requirement } = routed
  if (envelopes.length !== requirement.count) {
    process.stdout.write(
      `[record-agent-return] FAIL: routed panel requires ${requirement.count} reviewer envelopes\n`,
    )
    return 1
  }
  const panel = validatePanel(envelopes, state, schema, requirement)
  if (panel === null) return 1
  return writeReviewerPanel(
    panel.validated,
    panel.agents,
    requirement,
    panel.acceptanceFit,
    panel.anchor,
    stamped,
  )
}

function recordReturn(parsed, schema) {
  const env = stampAndValidate(parsed, schema)
  if (env === null) return 1
  const sanitizedTask = TASK_ID.replace(/[^0-9A-Za-z-]/g, '_')
  const agent =
    typeof env['agent'] === 'string' ? String(env['agent']).replace(/[^0-9A-Za-z-]/g, '-') : 'agent'
  try {
    if (EXPECTED_SHA !== null && stampProvenance().sha !== EXPECTED_SHA) {
      throw new Error(`HEAD drifted from expected ${EXPECTED_SHA} before evidence persistence`)
    }
    const outPath = writeEnvelopeContained(
      EVIDENCE_DIR,
      sanitizedTask,
      agent,
      `${JSON.stringify(env, null, 2)}\n`,
    )
    process.stdout.write(`[record-agent-return] OK — wrote ${outPath}\n`)
    return 0
  } catch (err) {
    process.stderr.write(
      `[record-agent-return] ERROR: cannot write evidence: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
}

async function main() {
  if (!TASK_ID || !/^#[0-9]+$/.test(TASK_ID)) {
    process.stderr.write(
      `[record-agent-return] ERROR: --task must be a GitHub issue id like '#1943' (got: ${String(TASK_ID)})\n`,
    )
    return 2
  }
  const input = parseInput(await readStdin())
  if ('exitCode' in input) return input.exitCode
  const schemaResult = loadReturnSchema()
  if ('exitCode' in schemaResult) return schemaResult.exitCode
  const handlers = { 'ac-fit': recordAcceptanceFit, 'reviewer-panel': recordReviewerPanel }
  const handler = handlers[MODE]
  if (handler) return handler(input.parsed, schemaResult.schema)
  if (MODE === 'return') return recordReturn(input.parsed, schemaResult.schema)
  process.stderr.write(`[record-agent-return] ERROR: unsupported --mode ${MODE}\n`)
  return 2
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `[record-agent-return] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  })
