// SPDX-License-Identifier: Apache-2.0
// #2357 — one optional Codex reviewer seat, with the recorder as the trust boundary.
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ExternalModelAccess } from '../detectors/external-model.js'
import type { CrossModelReviewConfig, CrossModelReviewProvider } from '../wizard/types.js'
import type { TaskPhase } from '../commands/task-state.js'
import type { ShipTier } from '../commands/ship-tier.js'
import { currentBranch, headSha } from '../evidence/git-checks.js'
import {
  mkdtempTranslated,
  readFileTranslated,
  rmTranslated,
  toFsError,
  writeFileContained,
} from '../utils/fs.js'
import { getLogger } from '../utils/logger.js'
import { CliError, runCli, type RunCliResult } from '../utils/run-cli.js'

const CODEX_ENV_KEYS = [
  'PATH',
  'HOME',
  'CODEX_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'NO_COLOR',
] as const

const EXTERNAL_REVIEW_SCHEMA = 'schemas/agent-return-external.schema.json'
const EXTERNAL_REVIEW_MAX_DIFF_BYTES = 512 * 1024
const EXTERNAL_REVIEW_MAX_OUTPUT_BYTES = 512 * 1024
const CROSS_MODEL_DISPATCH_SCHEMA = 'arbiter-cross-model-dispatch-v1'

type CrossModelDispatchReason =
  | 'cli-not-found'
  | 'not-authenticated'
  | 'consent-absent'
  | 'disabled-by-env'
  | 'timeout'
  | 'nonzero-exit'
  | 'coercion-failed'
  | 'envelope-rejected'
  | 'diff-truncated'

type ExternalReviewDegradationReason =
  | 'disabled'
  | 'consent-missing'
  | 'provider-unavailable'
  | 'provider-unauthenticated'
  | 'provider-not-configured'
  | 'diff-truncated'
  | 'invocation-failed'
  | 'coercion-failed'
  | 'envelope-rejected'

interface ExternalReviewPayload {
  verdict: 'PASS' | 'WARN' | 'FAIL'
  confidence: number
  findings: Array<Record<string, unknown>>
  refutations: Array<Record<string, unknown>>
}

interface CrossModelPlan {
  tier: ShipTier
  phase: TaskPhase
  external: string[]
  anthropic: string[]
  degradationReason?: ExternalReviewDegradationReason
}

interface ExternalReviewRequest {
  repoRoot: string
  taskId: string
  prompt: string
  diff: string
  cfg: CrossModelReviewConfig
  access?: ExternalModelAccess
  evidenceDir?: string
  dispatchEvidenceDir?: string
  preflightDegradation?: ExternalReviewDegradationReason
  preflightError?: unknown
  tier?: ShipTier
  phase?: TaskPhase
  vertical?: string
}

interface ExternalReviewResult {
  provider: CrossModelReviewProvider
  status: 'fulfilled' | 'degraded'
  diffBytes: number
  diffTruncated: boolean
  degradationReasons: ExternalReviewDegradationReason[]
  degradationReason?: ExternalReviewDegradationReason
  envelope?: ExternalReviewPayload
  recorded: boolean
}

interface CrossModelDispatchArtifact {
  schema: typeof CROSS_MODEL_DISPATCH_SCHEMA
  taskId: string
  branch: string
  sha: string
  ts: string
  phase: TaskPhase
  requested: Array<{ provider: 'codex'; vertical: string }>
  fulfilled: Array<{ provider: 'codex'; cliVersion: string; envelope: string }>
  degraded: Array<{
    provider: 'codex'
    vertical: string
    substitute: 'anthropic'
    reason: CrossModelDispatchReason
    detail: string
  }>
}

type SlotInput = {
  tier: ShipTier
  phase: TaskPhase
  totalSlots: number
  verticals: readonly string[]
  cfg?: CrossModelReviewConfig
  access?: ExternalModelAccess
}

/** v1 reserves one external seat for Standard; XS/S retain an Anthropic baseline. */
function externalSlotsForTier(tier: ShipTier): number {
  return tier === 'Standard' ? 1 : 0
}

function slotCount(totalSlots: number): number {
  return Number.isInteger(totalSlots) && totalSlots > 0 ? totalSlots : 0
}

function fallbackPlan(input: SlotInput, reason: ExternalReviewDegradationReason): CrossModelPlan {
  const total = slotCount(input.totalSlots)
  const labels = input.verticals.length > 0 ? input.verticals : ['bugs']
  return {
    tier: input.tier,
    phase: input.phase,
    external: [],
    anthropic: Array.from({ length: total }, (_, index) => labels[index % labels.length] ?? 'bugs'),
    degradationReason: reason,
  }
}

function configuredSlotCount(input: SlotInput): number | null {
  const cfg = input.cfg
  if (cfg === undefined || !cfg.enabled) return null
  if (!cfg.diffEgressConsent) return null
  if (!cfg.providers.includes('codex')) return null
  if (cfg.slots.codeReview <= 0) return 0
  if (!input.access?.available) return null
  if (!input.access.authenticated) return null
  return Math.min(
    externalSlotsForTier(input.tier),
    slotCount(input.totalSlots),
    Math.max(0, cfg.slots.codeReview),
  )
}

function fallbackReason(input: SlotInput): ExternalReviewDegradationReason {
  if (input.cfg === undefined || !input.cfg.enabled) return 'disabled'
  if (input.cfg.slots.codeReview <= 0) return 'provider-not-configured'
  if (!input.cfg.diffEgressConsent) return 'consent-missing'
  if (!input.cfg.providers.includes('codex')) return 'provider-not-configured'
  if (input.access?.available !== true) return 'provider-unavailable'
  return 'provider-unauthenticated'
}

function preferredVertical(verticals: readonly string[]): string {
  if (verticals.includes('security')) return 'security'
  return verticals.includes('bugs') ? 'bugs' : (verticals[0] ?? 'bugs')
}

/** Pure panel planner. External seats replace Anthropic seats; they never increase the panel. */
function planCrossModelSlots(input: SlotInput): CrossModelPlan {
  if (input.phase !== 'refactor') return fallbackPlan(input, 'disabled')
  const count = configuredSlotCount(input)
  if (count === null || count === 0) return fallbackPlan(input, fallbackReason(input))
  const labels = input.verticals.length > 0 ? input.verticals : ['bugs']
  const externalVertical = preferredVertical(labels)
  const external = [externalVertical]
  const anthropicCount = slotCount(input.totalSlots) - count
  const anthropic = Array.from(
    { length: anthropicCount },
    (_, index) => labels[index % labels.length] ?? 'bugs',
  )
  return {
    tier: input.tier,
    phase: input.phase,
    external,
    anthropic,
  }
}

function parseObject(value: string): ExternalReviewPayload | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return isPayloadObject(parsed) ? parsed : null
    // FAIL-OPEN-INTENT: malformed external output becomes an explicit coercion degradation.
  } catch {
    return null
  }
}

function isPayloadObject(value: unknown): value is ExternalReviewPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).some(
      (key) => !['verdict', 'confidence', 'findings', 'refutations'].includes(key),
    )
  )
    return false
  return (
    (record.verdict === 'PASS' || record.verdict === 'WARN' || record.verdict === 'FAIL') &&
    typeof record.confidence === 'number' &&
    Array.isArray(record.findings) &&
    Array.isArray(record.refutations)
  )
}

function balancedObjectAt(text: string, start: number): { value: string; end: number } | null {
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else quoted = char !== '"'
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    depth += char === '{' ? 1 : char === '}' ? -1 : 0
    if (depth === 0) return { value: text.slice(start, index + 1), end: index }
  }
  return null
}

function balancedObjects(text: string): string[] {
  const objects: string[] = []
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue
    const object = balancedObjectAt(text, start)
    if (object === null) continue
    objects.push(object.value)
    start = object.end
  }
  return objects
}

/** Parse structured output deterministically; never repairs malformed JSON. */
function extractAgentReturnJson(text: string): ExternalReviewPayload | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const direct = parseObject(trimmed)
  if (direct !== null) return direct
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]
  if (fenced !== undefined) {
    const parsedFence = parseObject(fenced)
    if (parsedFence !== null) return parsedFence
  }
  let last: ExternalReviewPayload | null = null
  for (const candidate of balancedObjects(trimmed)) {
    const parsed = parseObject(candidate)
    if (parsed !== null) last = parsed
  }
  return last
}

function truncateDiff(diff: string): { text: string; bytes: number; truncated: boolean } {
  const bytes = Buffer.byteLength(diff, 'utf8')
  if (bytes <= EXTERNAL_REVIEW_MAX_DIFF_BYTES) return { text: diff, bytes, truncated: false }
  return {
    text: Buffer.from(diff, 'utf8').subarray(0, EXTERNAL_REVIEW_MAX_DIFF_BYTES).toString('utf8'),
    bytes,
    truncated: true,
  }
}

function buildPrompt(prompt: string, diff: string, truncated: boolean): string {
  const marker = truncated
    ? '\n\n[arbiter cross-model review: diff truncated at 512 KiB; degradation=diff-truncated]\n'
    : ''
  return `${prompt}\n\n--- BEGIN DIFF ---\n${diff}${marker}--- END DIFF ---\n`
}

function resultStatus(
  reasons: readonly ExternalReviewDegradationReason[],
): 'fulfilled' | 'degraded' {
  return reasons.length > 0 ? 'degraded' : 'fulfilled'
}

function resultFor(
  request: ExternalReviewRequest,
  prepared: ReturnType<typeof truncateDiff>,
  reasons: ExternalReviewDegradationReason[],
  extra: Partial<Pick<ExternalReviewResult, 'envelope' | 'recorded'>> = {},
): ExternalReviewResult {
  return {
    provider: 'codex',
    status: resultStatus(reasons),
    diffBytes: prepared.bytes,
    diffTruncated: prepared.truncated,
    degradationReasons: reasons,
    ...(reasons[0] !== undefined ? { degradationReason: reasons[0] } : {}),
    recorded: extra.recorded ?? false,
    ...(extra.envelope !== undefined ? { envelope: extra.envelope } : {}),
  }
}

function recorderArgs(request: ExternalReviewRequest, access: ExternalModelAccess): string[] {
  const script = join(request.repoRoot, 'scripts', 'record-agent-return.mjs')
  return [
    script,
    '--task',
    request.taskId,
    '--repo-root',
    request.repoRoot,
    ...(request.evidenceDir !== undefined ? ['--evidence-dir', request.evidenceDir] : []),
    '--provenance-vendor',
    access.vendor,
    '--provenance-cli',
    'codex',
    ...(access.version !== null ? ['--provenance-cli-version', access.version] : []),
    '--provenance-dispatch',
    'external-cli',
  ]
}

function outputText(outputPath: string, codex: RunCliResult): string | null {
  if (existsSync(outputPath)) {
    if (statSync(outputPath).size > EXTERNAL_REVIEW_MAX_OUTPUT_BYTES) return null
    const file = readFileTranslated(outputPath, 'utf-8')
    if (Buffer.byteLength(file, 'utf8') > EXTERNAL_REVIEW_MAX_OUTPUT_BYTES) return null
    if (file.trim() !== '') return file
  }
  return Buffer.byteLength(codex.stdout, 'utf8') > EXTERNAL_REVIEW_MAX_OUTPUT_BYTES
    ? null
    : codex.stdout
}

function invokeCodex(
  request: ExternalReviewRequest,
  prompt: string,
  outputPath: string,
  schemaPath: string,
): RunCliResult {
  const sandboxRoot = dirname(outputPath)
  const env = Object.fromEntries(
    CODEX_ENV_KEYS.flatMap((key) => {
      const value = process.env[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )
  return runCli(
    'codex',
    [
      'exec',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--ignore-user-config',
      '-c',
      'shell_environment_policy.inherit="none"',
      '--skip-git-repo-check',
      '--output-schema',
      schemaPath,
      '-o',
      outputPath,
      '-C',
      sandboxRoot,
      '-',
    ],
    {
      cwd: sandboxRoot,
      env,
      input: prompt,
      timeoutMs: request.cfg.timeoutMs,
      retries: 0,
    },
  )
}

function persistEnvelope(
  request: ExternalReviewRequest,
  access: ExternalModelAccess,
  envelope: ExternalReviewPayload,
): string | null {
  if (request.evidenceDir === undefined) {
    assertSafeDirectoryPath(
      request.repoRoot,
      join(request.repoRoot, '.arbiter', 'evidence', 'agent-returns', sanitizeTask(request.taskId)),
    )
  }
  const result = runCli('node', recorderArgs(request, access), {
    cwd: request.repoRoot,
    input: JSON.stringify({
      schema: 'arbiter-agent-return-v1',
      agent: 'codex-reviewer',
      role: 'reviewer',
      taskId: request.taskId,
      verdict: envelope.verdict,
      confidence: envelope.confidence,
      findings: envelope.findings,
      refutations: envelope.refutations,
    }),
    timeoutMs: request.cfg.timeoutMs,
    retries: 0,
  })
  return result.stdout.match(/\[record-agent-return\] OK — wrote (.+)\s*$/m)?.[1] ?? null
}

function sanitizeTask(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown'
}

const DIRECT_DISPATCH_REASONS: Partial<
  Record<ExternalReviewDegradationReason, CrossModelDispatchReason>
> = {
  'consent-missing': 'consent-absent',
  'provider-unauthenticated': 'not-authenticated',
  disabled: 'disabled-by-env',
  'provider-not-configured': 'disabled-by-env',
  'diff-truncated': 'diff-truncated',
  'coercion-failed': 'coercion-failed',
  'envelope-rejected': 'envelope-rejected',
}

function dispatchReasonFromCliError(error: unknown): CrossModelDispatchReason {
  if (!(error instanceof CliError)) return 'nonzero-exit'
  if (error.notFound) return 'cli-not-found'
  return error.timedOut ? 'timeout' : 'nonzero-exit'
}

function dispatchReasonFromUnavailableError(error: unknown): CrossModelDispatchReason {
  const detail = errorMessage(error)?.toLowerCase()
  if (detail?.includes('timed out') || detail?.includes('timeout')) return 'timeout'
  if (detail?.includes('exit') || detail?.includes('failed')) return 'nonzero-exit'
  return 'cli-not-found'
}

function dispatchReason(
  reason: ExternalReviewDegradationReason,
  error?: unknown,
): CrossModelDispatchReason {
  return (
    DIRECT_DISPATCH_REASONS[reason] ??
    (reason === 'invocation-failed'
      ? dispatchReasonFromCliError(error)
      : reason === 'provider-unavailable'
        ? dispatchReasonFromUnavailableError(error)
        : 'nonzero-exit')
  )
}

function errorMessage(error: unknown): string | null {
  if (typeof error === 'string' && error.trim() !== '') return error.trim()
  if (error instanceof Error && error.message.trim() !== '') return error.message.trim()
  return null
}

function dispatchDetail(reason: CrossModelDispatchReason, error?: unknown): string {
  const message = errorMessage(error)
  if (reason === 'cli-not-found') {
    if (error instanceof CliError && error.notFound) return `Command not found: ${error.cmd}`
    return message ?? 'Codex CLI unavailable'
  }
  if (reason === 'timeout') return message ?? 'Codex invocation timed out'
  if (reason === 'nonzero-exit') {
    if (error instanceof CliError) return `Codex exited with status ${error.exitCode}`
    return message ?? 'Codex CLI exited unsuccessfully'
  }
  const details: Record<
    Exclude<CrossModelDispatchReason, 'cli-not-found' | 'timeout' | 'nonzero-exit'>,
    string
  > = {
    'not-authenticated': 'Codex CLI is not authenticated',
    'consent-absent': 'cross-model diff egress consent is absent',
    'disabled-by-env': 'cross-model review is disabled by configuration or environment',
    'coercion-failed': 'Codex output did not contain a valid review payload',
    'envelope-rejected': 'the recorder rejected the Codex envelope',
    'diff-truncated': 'diff exceeded the 512 KiB review limit',
  }
  return details[reason]
}

function relativeEvidencePath(repoRoot: string, path: string | null): string | null {
  if (path === null) return null
  return relative(repoRoot, path).replaceAll('\\', '/')
}

function requestedEntries(
  request: ExternalReviewRequest,
  plan: CrossModelPlan,
): CrossModelDispatchArtifact['requested'] {
  if (
    !request.cfg.enabled ||
    request.cfg.slots.codeReview <= 0 ||
    plan.phase !== 'refactor' ||
    externalSlotsForTier(request.tier ?? 'Standard') === 0
  )
    return []
  return [{ provider: 'codex', vertical: request.vertical ?? plan.external[0] ?? 'bugs' }]
}

function fulfilledEntries(
  request: ExternalReviewRequest,
  result: ExternalReviewResult,
  envelopePath: string | null,
): CrossModelDispatchArtifact['fulfilled'] {
  if (
    result.status !== 'fulfilled' ||
    result.envelope === undefined ||
    !result.recorded ||
    envelopePath === null
  )
    return []
  return [
    {
      provider: 'codex',
      cliVersion: request.access?.version ?? 'unknown',
      envelope: relativeEvidencePath(request.repoRoot, envelopePath) ?? envelopePath,
    },
  ]
}

function degradedEntries(
  request: ExternalReviewRequest,
  plan: CrossModelPlan,
  result: ExternalReviewResult,
  error?: unknown,
): CrossModelDispatchArtifact['degraded'] {
  if (
    request.cfg.slots.codeReview <= 0 ||
    plan.phase !== 'refactor' ||
    externalSlotsForTier(request.tier ?? 'Standard') === 0
  )
    return []
  if (result.status !== 'degraded') return []
  const vertical = request.vertical ?? plan.external[0] ?? 'bugs'
  const originalReason = result.degradationReasons.at(-1) ?? plan.degradationReason
  if (originalReason === undefined) return []
  const reason = dispatchReason(originalReason, error)
  return [
    {
      provider: 'codex',
      vertical,
      substitute: 'anthropic',
      reason,
      detail: dispatchDetail(reason, error),
    },
  ]
}

function writeDispatchEvidence(
  request: ExternalReviewRequest,
  plan: CrossModelPlan,
  result: ExternalReviewResult,
  envelopePath: string | null,
  error?: unknown,
): void {
  const artifact: CrossModelDispatchArtifact = {
    schema: CROSS_MODEL_DISPATCH_SCHEMA,
    taskId: request.taskId,
    branch: currentBranch(request.repoRoot),
    sha: headSha(request.repoRoot),
    ts: new Date().toISOString(),
    phase: request.phase ?? plan.phase,
    requested: requestedEntries(request, plan),
    fulfilled: fulfilledEntries(request, result, envelopePath),
    degraded: degradedEntries(request, plan, result, error ?? request.access?.error),
  }
  const content = `${JSON.stringify(artifact, null, 2)}\n`
  if (request.dispatchEvidenceDir !== undefined) {
    writeFileContained(
      request.dispatchEvidenceDir,
      join(sanitizeTask(request.taskId), 'dispatch.json'),
      content,
    )
    return
  }
  writeFileContained(
    request.repoRoot,
    join('.arbiter', 'evidence', 'cross-model', sanitizeTask(request.taskId), 'dispatch.json'),
    content,
  )
}

function outsideRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)
}

/** Reject symlinked or out-of-repository directory components before default evidence writes. */
function assertSafeDirectoryPath(repoRoot: string, targetPath: string): void {
  let repoResolved: string
  try {
    repoResolved = realpathSync(repoRoot)
  } catch (error) {
    throw toFsError(error, repoRoot)
  }
  const target = resolve(targetPath)
  if (outsideRoot(repoResolved, target)) {
    throw new Error(`${targetPath} resolves outside the repository`)
  }
  let current = target
  while (current !== repoResolved) {
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) throw new Error(`${current} must not be a symbolic link`)
      if (!stat.isDirectory()) throw new Error(`${current} must be a directory`)
      if (outsideRoot(repoResolved, realpathSync(current))) {
        throw new Error(`${current} resolves outside the repository`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw toFsError(error, current)
      }
    }
    current = dirname(current)
  }
}

/** Reject a pre-existing .arbiter link before default evidence writes can follow it. */
function assertSafeArbiterEvidenceRoot(repoRoot: string): void {
  for (const path of [
    join(repoRoot, '.arbiter'),
    join(repoRoot, '.arbiter', 'evidence'),
    join(repoRoot, '.arbiter', 'evidence', 'cross-model'),
    join(repoRoot, '.arbiter', 'evidence', 'agent-returns'),
  ]) {
    assertSafeDirectoryPath(repoRoot, path)
  }
}

function finalizeResult(
  request: ExternalReviewRequest,
  plan: CrossModelPlan,
  result: ExternalReviewResult,
  envelopePath: string | null = null,
  error?: unknown,
): ExternalReviewResult {
  writeDispatchEvidence(request, plan, result, envelopePath, error)
  if (request.cfg.onUnavailable === 'fail' && result.status === 'degraded') {
    throw new Error(`cross-model review unavailable: ${result.degradationReasons.join(', ')}`)
  }
  return result
}

function cleanupTemp(dir: string): void {
  try {
    rmTranslated(dir, { recursive: true, force: true })
    // FAIL-OPEN-INTENT: scratch cleanup is best effort after the result/artifact is finalized.
  } catch (error) {
    getLogger().warn(
      'cross_model_review.temp_cleanup_failed',
      { path: dir },
      `could not remove external-review scratch directory: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function resultWithoutExternal(
  request: ExternalReviewRequest,
  plan: CrossModelPlan,
  prepared: ReturnType<typeof truncateDiff>,
): ExternalReviewResult {
  const noSeat =
    request.cfg.slots.codeReview <= 0 ||
    externalSlotsForTier(request.tier ?? 'Standard') === 0 ||
    plan.phase !== 'refactor'
  const reasons = noSeat
    ? []
    : [request.preflightDegradation ?? plan.degradationReason ?? 'provider-unavailable']
  const result = resultFor(request, prepared, reasons)
  return request.cfg.enabled
    ? finalizeResult(request, plan, result, null, request.preflightError)
    : result
}

function persistExternalPayload(
  request: ExternalReviewRequest,
  plan: CrossModelPlan,
  prepared: ReturnType<typeof truncateDiff>,
  reasons: ExternalReviewDegradationReason[],
  payload: ExternalReviewPayload,
): ExternalReviewResult {
  let envelopePath: string | null
  try {
    if (request.access === undefined)
      throw new Error('external access disappeared before persistence')
    envelopePath = persistEnvelope(request, request.access, payload)
    if (envelopePath === null) throw new Error('recorder did not confirm envelope persistence')
    // FAIL-OPEN-INTENT: recorder failures become an explicit degradation and never a fulfilled review.
  } catch (error) {
    return finalizeResult(
      request,
      plan,
      resultFor(request, prepared, [...reasons, 'envelope-rejected'], { envelope: payload }),
      null,
      error,
    )
  }
  return finalizeResult(
    request,
    plan,
    resultFor(request, prepared, reasons, {
      envelope: payload,
      recorded: true,
    }),
    envelopePath,
  )
}

function prepareExternalReview(request: ExternalReviewRequest): {
  prepared: ReturnType<typeof truncateDiff>
  initial: CrossModelPlan
} {
  if (
    request.cfg.enabled &&
    (request.dispatchEvidenceDir === undefined || request.evidenceDir === undefined)
  ) {
    assertSafeArbiterEvidenceRoot(request.repoRoot)
  }
  const prepared = truncateDiff(request.diff)
  const tier = request.tier ?? 'Standard'
  const initial = planCrossModelSlots({
    tier,
    phase: request.phase ?? 'refactor',
    totalSlots: externalSlotsForTier(tier),
    verticals: [request.vertical ?? 'bugs'],
    cfg: request.cfg,
    ...(request.access !== undefined ? { access: request.access } : {}),
  })
  return { prepared, initial }
}

/** Invoke one external seat and hand its validated envelope to the existing recorder. */
function invokeExternalReview(request: ExternalReviewRequest): ExternalReviewResult {
  const { prepared, initial } = prepareExternalReview(request)
  if (initial.external.length === 0) {
    return resultWithoutExternal(request, initial, prepared)
  }
  const reasons: ExternalReviewDegradationReason[] = prepared.truncated ? ['diff-truncated'] : []
  const prompt = buildPrompt(request.prompt, prepared.text, prepared.truncated)
  let scratch: string | null = null
  try {
    scratch = mkdtempTranslated(join(tmpdir(), 'arbiter-cross-model-review-'))
    const outputPath = join(scratch, 'return.json')
    const schemaPath = join(request.repoRoot, EXTERNAL_REVIEW_SCHEMA)
    const codex = invokeCodex(request, prompt, outputPath, schemaPath)
    const output = outputText(outputPath, codex)
    const payload = output === null ? null : extractAgentReturnJson(output)
    if (payload === null) {
      return finalizeResult(
        request,
        initial,
        resultFor(request, prepared, [...reasons, 'coercion-failed']),
        null,
      )
    }
    return persistExternalPayload(request, initial, prepared, reasons, payload)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('cross-model review unavailable:'))
      throw error
    return finalizeResult(
      request,
      initial,
      resultFor(request, prepared, [...reasons, 'invocation-failed']),
      null,
      error,
    )
  } finally {
    if (scratch !== null) cleanupTemp(scratch)
  }
}

export {
  externalSlotsForTier,
  planCrossModelSlots,
  extractAgentReturnJson,
  assertSafeArbiterEvidenceRoot,
  invokeExternalReview,
}
