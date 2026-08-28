// SPDX-License-Identifier: Apache-2.0
// #2357 — one optional Codex reviewer seat, with the recorder as the trust boundary.
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExternalModelAccess } from '../detectors/external-model.js'
import type { CrossModelReviewConfig, CrossModelReviewProvider } from '../wizard/types.js'
import type { TaskPhase } from '../commands/task-state.js'
import type { ShipTier } from '../commands/ship-tier.js'
import { mkdtempTranslated, readFileTranslated, rmTranslated } from '../utils/fs.js'
import { getLogger } from '../utils/logger.js'
import { runCli, type RunCliResult } from '../utils/run-cli.js'

export const EXTERNAL_REVIEW_SCHEMA = 'schemas/agent-return-external.schema.json'
export const EXTERNAL_REVIEW_MAX_DIFF_BYTES = 512 * 1024

export type ExternalReviewDegradationReason =
  | 'disabled'
  | 'consent-missing'
  | 'provider-unavailable'
  | 'provider-unauthenticated'
  | 'provider-not-configured'
  | 'diff-truncated'
  | 'invocation-failed'
  | 'coercion-failed'
  | 'envelope-rejected'

export interface ExternalReviewPayload {
  verdict: 'PASS' | 'WARN' | 'FAIL'
  confidence: number
  findings: Array<Record<string, unknown>>
  refutations: Array<Record<string, unknown>>
}

export interface CrossModelPlan {
  tier: ShipTier
  phase: TaskPhase
  external: string[]
  anthropic: string[]
  degradationReason?: ExternalReviewDegradationReason
}

export interface ExternalReviewRequest {
  repoRoot: string
  taskId: string
  prompt: string
  diff: string
  cfg: CrossModelReviewConfig
  access?: ExternalModelAccess
  evidenceDir?: string
}

export interface ExternalReviewResult {
  provider: CrossModelReviewProvider
  status: 'fulfilled' | 'degraded'
  diffBytes: number
  diffTruncated: boolean
  degradationReasons: ExternalReviewDegradationReason[]
  degradationReason?: ExternalReviewDegradationReason
  envelope?: ExternalReviewPayload
  recorded: boolean
  /** Prompt sent to the child, retained for deterministic tests and dispatch evidence. */
  prompt?: string
}

type SlotInput = {
  tier: ShipTier
  phase: TaskPhase
  totalSlots: number
  verticals: readonly string[]
  cfg?: CrossModelReviewConfig
  access?: ExternalModelAccess
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
  if (!input.access?.available) return null
  if (!input.access.authenticated) return null
  return Math.min(slotCount(input.totalSlots), Math.max(0, cfg.slots.codeReview))
}

function fallbackReason(input: SlotInput): ExternalReviewDegradationReason {
  if (input.cfg === undefined || !input.cfg.enabled) return 'disabled'
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
export function planCrossModelSlots(input: SlotInput): CrossModelPlan {
  if (input.phase !== 'refactor') return fallbackPlan(input, 'disabled')
  const count = configuredSlotCount(input)
  if (count === null || count === 0) return fallbackPlan(input, fallbackReason(input))
  const labels = input.verticals.length > 0 ? input.verticals : ['bugs']
  const externalVertical = preferredVertical(labels)
  const external = Array.from({ length: count }, (_, index) => {
    if (index === 0) return externalVertical
    return labels[index % labels.length] ?? 'bugs'
  })
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
  } catch {
    return null
  }
}

function isPayloadObject(value: unknown): value is ExternalReviewPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    (record.verdict === 'PASS' || record.verdict === 'WARN' || record.verdict === 'FAIL') &&
    typeof record.confidence === 'number' &&
    Array.isArray(record.findings) &&
    Array.isArray(record.refutations)
  )
}

function balancedObjects(text: string): string[] {
  const objects: string[] = []
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue
    let depth = 0
    let quoted = false
    let escaped = false
    for (let index = start; index < text.length; index++) {
      const char = text[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
        continue
      }
      if (char === '"') {
        quoted = true
        continue
      }
      if (char === '{') depth++
      if (char === '}') depth--
      if (depth === 0) {
        objects.push(text.slice(start, index + 1))
        start = index
        break
      }
    }
  }
  return objects
}

/** Parse structured output deterministically; never repairs malformed JSON. */
export function extractAgentReturnJson(text: string): ExternalReviewPayload | null {
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
  extra: Partial<Pick<ExternalReviewResult, 'envelope' | 'recorded' | 'prompt'>> = {},
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
    ...(extra.prompt !== undefined ? { prompt: extra.prompt } : {}),
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

function outputText(outputPath: string, codex: RunCliResult): string {
  if (existsSync(outputPath)) {
    const file = readFileTranslated(outputPath, 'utf-8')
    if (file.trim() !== '') return file
  }
  return codex.stdout
}

function invokeCodex(
  request: ExternalReviewRequest,
  prompt: string,
  outputPath: string,
  schemaPath: string,
): RunCliResult {
  return runCli(
    'codex',
    [
      'exec',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--skip-git-repo-check',
      '--output-schema',
      schemaPath,
      '-o',
      outputPath,
      '-C',
      request.repoRoot,
      '-',
    ],
    {
      cwd: request.repoRoot,
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
): void {
  runCli('node', recorderArgs(request, access), {
    cwd: request.repoRoot,
    input: JSON.stringify({
      schema: 'arbiter-agent-return-v1',
      agent: 'codex-reviewer',
      role: 'reviewer',
      taskId: request.taskId,
      ...envelope,
    }),
    timeoutMs: request.cfg.timeoutMs,
    retries: 0,
  })
}

function cleanupTemp(dir: string): void {
  try {
    rmTranslated(dir, { recursive: true, force: true })
  } catch (error) {
    getLogger().warn(
      'cross_model_review.temp_cleanup_failed',
      { path: dir },
      `could not remove external-review scratch directory: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Invoke one external seat and hand its validated envelope to the existing recorder. */
export function invokeExternalReview(request: ExternalReviewRequest): ExternalReviewResult {
  const prepared = truncateDiff(request.diff)
  const initial = planCrossModelSlots({
    tier: 'Standard',
    phase: 'refactor',
    totalSlots: 1,
    verticals: ['bugs'],
    cfg: request.cfg,
    ...(request.access !== undefined ? { access: request.access } : {}),
  })
  if (initial.external.length === 0) {
    return resultFor(request, prepared, [initial.degradationReason ?? 'provider-unavailable'])
  }
  const reasons: ExternalReviewDegradationReason[] = prepared.truncated ? ['diff-truncated'] : []
  const prompt = buildPrompt(request.prompt, prepared.text, prepared.truncated)
  const scratch = mkdtempTranslated(join(tmpdir(), 'arbiter-cross-model-review-'))
  const outputPath = join(scratch, 'return.json')
  const schemaPath = join(request.repoRoot, EXTERNAL_REVIEW_SCHEMA)
  try {
    const codex = invokeCodex(request, prompt, outputPath, schemaPath)
    const payload = extractAgentReturnJson(outputText(outputPath, codex))
    if (payload === null)
      return resultFor(request, prepared, [...reasons, 'coercion-failed'], { prompt })
    try {
      if (request.access === undefined)
        throw new Error('external access disappeared before persistence')
      persistEnvelope(request, request.access, payload)
    } catch {
      return resultFor(request, prepared, [...reasons, 'envelope-rejected'], {
        envelope: payload,
        prompt,
      })
    }
    return resultFor(request, prepared, reasons, { envelope: payload, recorded: true, prompt })
  } catch {
    return resultFor(request, prepared, [...reasons, 'invocation-failed'], { prompt })
  } finally {
    cleanupTemp(scratch)
  }
}
