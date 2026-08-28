// SPDX-License-Identifier: Apache-2.0
// #2357 — the /ship-facing boundary for the optional external review seat.
import { join, resolve } from 'node:path'
import { detectExternalModel, type ExternalModelAccess } from '../detectors/external-model.js'
import {
  assertSafeArbiterEvidenceRoot,
  invokeExternalReview,
} from '../integrations/external-review.js'
import { resolveShipProfile } from './ship-profile.js'
import { normTier, type ShipTier } from './ship-tier.js'
import type { TaskPhase } from './task-state.js'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { readFileContained, toFsError, writeFileContained } from '../utils/fs.js'
import { runCli } from '../utils/run-cli.js'
import type { CrossModelReviewConfig } from '../wizard/types.js'
import { currentBranch, headSha } from '../evidence/git-checks.js'

const SHIP_CROSS_MODEL_PROMPT =
  'Review this change for bugs, type safety, security, data integrity, and silent failures.'

interface CrossModelReviewCommandOptions {
  taskId: string
  prompt: string
  diff?: string
  dir?: string
  tier?: string
  phase?: TaskPhase
  vertical?: string
}

/** Run the configured Codex seat; the diff defaults to stdin so it never enters argv. */
function runCrossModelReview(
  options: CrossModelReviewCommandOptions,
): ReturnType<typeof invokeExternalReview> {
  const repoRoot = resolve(options.dir ?? process.cwd())
  const tier = normTier(options.tier)
  const profile = resolveShipProfile(repoRoot)
  const cfg = profile.crossModelReview
  if (!cfg?.enabled) {
    throw new Error('crossModelReview.enabled must be true to run an external review')
  }
  if (!cfg.diffEgressConsent) {
    throw new Error('crossModelReview.diffEgressConsent must be true to send the diff')
  }
  const result = invokeExternalReview({
    repoRoot,
    taskId: options.taskId,
    prompt: options.prompt,
    diff: options.diff ?? readStdin(),
    cfg,
    access: detectExternalModel('codex'),
    tier,
    phase: options.phase ?? 'refactor',
    vertical: options.vertical ?? 'bugs',
  })
  if (existsSync(repoRoot))
    writeExternalReviewSidecar(repoRoot, options.taskId, result, tier, profile.collaborationMode)
  return result
}

interface ShipCrossModelReviewOptions {
  dir: string
  taskId: string
  tier: ShipTier
  phase: TaskPhase
  vertical: string
  cfg: CrossModelReviewConfig
  collaborationMode?: 'trunk-solo' | 'peer-review' | 'gated-review'
  access?: ExternalModelAccess
}

type ReviewSidecar = {
  count?: unknown
  agents?: unknown
  branch?: unknown
  sha?: unknown
  taskId?: unknown
}

function isRecord(value: unknown): value is ReviewSidecar {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertSafeSidecarFile(path: string): void {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`${path} must not be a symbolic link`)
    if (!stat.isFile()) throw new Error(`${path} must be a regular file`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw toFsError(error, path)
  }
}

function readSidecar(repoRoot: string): ReviewSidecar | null {
  const relativePath = join('.arbiter', 'agents-dispatched.json')
  const path = join(repoRoot, '.arbiter', 'agents-dispatched.json')
  try {
    assertSafeArbiterEvidenceRoot(repoRoot)
    assertSafeSidecarFile(path)
    if (!existsSync(path)) return null
    const parsed: unknown = JSON.parse(readFileContained(repoRoot, relativePath))
    if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`)
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`cannot read dispatch sidecar ${path}: ${String(error)}`, { cause: error })
  }
}

function isCurrentSidecar(
  existing: ReviewSidecar | null,
  branch: string,
  sha: string,
  taskId: string,
): existing is ReviewSidecar {
  return (
    existing !== null &&
    existing.branch === branch &&
    existing.sha === sha &&
    existing.taskId === taskId
  )
}

function hasCurrentFulfilledReview(repoRoot: string, taskId: string): boolean {
  if (!existsSync(join(repoRoot, '.git'))) return false
  const branch = currentBranch(repoRoot)
  const sha = headSha(repoRoot)
  if (branch === 'unknown' || sha === 'unknown') return false
  const sidecar = readSidecar(repoRoot)
  if (!(
    isCurrentSidecar(sidecar, branch, sha, taskId) &&
    Array.isArray(sidecar.agents) &&
    sidecar.agents.includes('codex-reviewer')
  ))
    return false
  try {
    return (
      runCli(
        'node',
        [join(repoRoot, 'scripts', 'check-cross-model-review.mjs'), '--require-fulfilled'],
        {
          cwd: repoRoot,
          timeoutMs: 5_000,
          retries: 0,
        },
      ).exitCode === 0
    )
    // FAIL-OPEN-INTENT: stale or unavailable fulfilment evidence is a cache miss; rerun review.
  } catch {
    return false
  }
}

function readSidecarAgents(existing: ReviewSidecar): string[] | null {
  if (existing.agents === undefined) return null
  if (
    !Array.isArray(existing.agents) ||
    !existing.agents.every((agent) => typeof agent === 'string')
  ) {
    throw new Error('existing dispatch sidecar has invalid agent names')
  }
  const agents = [...existing.agents]
  if (new Set(agents).size !== agents.length)
    throw new Error('existing dispatch sidecar has duplicate agents')
  if (
    existing.count !== undefined &&
    (typeof existing.count !== 'number' ||
      !Number.isInteger(existing.count) ||
      existing.count < 0 ||
      existing.count > agents.length)
  ) {
    throw new Error('existing dispatch sidecar has an invalid count')
  }
  return agents
}

function sidecarAgents(
  existing: ReviewSidecar | null,
  branch: string,
  sha: string,
  taskId: string,
  context: {
    tier: ShipTier
    collaborationMode: 'trunk-solo' | 'peer-review' | 'gated-review'
  },
): { count: number; agents: string[] } {
  const panelSize =
    context.collaborationMode === 'trunk-solo' ? 1 : context.tier === 'Standard' ? 2 : 1
  const fresh =
    panelSize === 2
      ? { count: 2, agents: ['anthropic-reviewer', 'codex-reviewer'] }
      : { count: 1, agents: ['codex-reviewer'] }
  if (!isCurrentSidecar(existing, branch, sha, taskId)) return fresh
  const agents = readSidecarAgents(existing)
  if (agents === null) return fresh
  if (agents.length === 0) return fresh
  if (panelSize === 2 && agents.length === 1) {
    const first = agents[0] ?? 'anthropic-reviewer'
    return {
      count: 2,
      agents: [first === 'codex-reviewer' ? 'anthropic-reviewer' : first, 'codex-reviewer'],
    }
  }
  if (!agents.includes('codex-reviewer')) agents[agents.length - 1] = 'codex-reviewer'
  return { count: agents.length, agents }
}

/** Record the fulfilled external seat for a CLI review path without inflating the panel. */
function writeExternalReviewSidecar(
  repoRoot: string,
  taskId: string,
  result: ReturnType<typeof invokeExternalReview>,
  tier: ShipTier = 'Standard',
  collaborationMode: 'trunk-solo' | 'peer-review' | 'gated-review' = 'peer-review',
): void {
  if (result.status !== 'fulfilled' || !result.recorded || result.envelope === undefined) return
  assertSafeArbiterEvidenceRoot(repoRoot)
  const sidecarPath = join(repoRoot, '.arbiter', 'agents-dispatched.json')
  assertSafeSidecarFile(sidecarPath)
  const branch = currentBranch(repoRoot)
  const sha = headSha(repoRoot)
  if (branch === 'unknown' || sha === 'unknown')
    throw new Error('cannot bind dispatch sidecar to Git HEAD')
  const panel = sidecarAgents(readSidecar(repoRoot), branch, sha, taskId, {
    tier,
    collaborationMode,
  })
  writeFileContained(
    repoRoot,
    join('.arbiter', 'agents-dispatched.json'),
    `${JSON.stringify({ ...panel, taskId, branch, sha }, null, 2)}\n`,
  )
}

function assertReviewTreeClean(repoRoot: string): void {
  const status = runCli('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: repoRoot,
    timeoutMs: 15_000,
  }).stdout
  const unreviewed = status
    .split(/\r?\n/)
    .filter((line) => line.length > 2)
    .map((line) => line.slice(3))
    .filter((path) => path.length > 0 && !path.startsWith('.arbiter/'))
  if (unreviewed.length > 0) {
    throw new Error(
      `working tree has uncommitted changes; commit before external review (${unreviewed.join(', ')})`,
    )
  }
}

/** Run the automatic refactor-step bridge; consent-off runs only the local degradation recorder. */
function runShipCrossModelReview(
  options: ShipCrossModelReviewOptions,
): ReturnType<typeof invokeExternalReview> {
  const repoRoot = resolve(options.dir)
  let diff = ''
  let access = options.cfg.diffEgressConsent ? options.access : undefined
  let preflightError: unknown
  let preflightDegradation: 'invocation-failed' | undefined
  if (options.cfg.diffEgressConsent) {
    try {
      assertReviewTreeClean(repoRoot)
      if (options.cfg.enabled && hasCurrentFulfilledReview(repoRoot, options.taskId)) {
        return {
          provider: 'codex',
          status: 'fulfilled',
          diffBytes: 0,
          diffTruncated: false,
          degradationReasons: [],
          recorded: true,
        }
      }
      diff = runCli('git', ['diff', '--binary', 'origin/main...HEAD'], {
        cwd: repoRoot,
        timeoutMs: 15_000,
      }).stdout
      // FAIL-OPEN-INTENT: a preflight failure is recorded as an explicit degradation; no diff is sent.
    } catch (error) {
      access = undefined
      preflightError = error
      preflightDegradation = 'invocation-failed'
    }
  }
  const result = invokeExternalReview({
    repoRoot,
    taskId: options.taskId,
    prompt: SHIP_CROSS_MODEL_PROMPT,
    diff,
    cfg: options.cfg,
    ...(access !== undefined ? { access } : {}),
    ...(preflightDegradation !== undefined ? { preflightDegradation, preflightError } : {}),
    tier: options.tier,
    phase: options.phase,
    vertical: options.vertical,
  })
  if (existsSync(repoRoot))
    writeExternalReviewSidecar(
      repoRoot,
      options.taskId,
      result,
      options.tier,
      options.collaborationMode ?? 'peer-review',
    )
  return result
}

export { runCrossModelReview, runShipCrossModelReview, writeExternalReviewSidecar }

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch (error) {
    throw toFsError(error, 'stdin')
  }
}
