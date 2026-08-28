// SPDX-License-Identifier: Apache-2.0
// #2357 — the /ship-facing boundary for the optional external review seat.
import { resolve } from 'node:path'
import { detectExternalModel, type ExternalModelAccess } from '../detectors/external-model.js'
import { invokeExternalReview, type ExternalReviewResult } from '../integrations/external-review.js'
import { resolveShipProfile } from './ship-profile.js'
import { normTier, type ShipTier } from './ship-tier.js'
import type { TaskPhase } from './task-state.js'
import { readFileSync } from 'node:fs'
import { toFsError } from '../utils/fs.js'
import { runCli } from '../utils/run-cli.js'
import type { CrossModelReviewConfig } from '../wizard/types.js'

export const SHIP_CROSS_MODEL_PROMPT =
  'Review this change for bugs, type safety, security, data integrity, and silent failures.'

export interface CrossModelReviewCommandOptions {
  taskId: string
  prompt: string
  diff?: string
  dir?: string
  tier?: string
  phase?: TaskPhase
  vertical?: string
}

/** Run the configured Codex seat; the diff defaults to stdin so it never enters argv. */
export function runCrossModelReview(options: CrossModelReviewCommandOptions): ExternalReviewResult {
  const repoRoot = resolve(options.dir ?? process.cwd())
  const profile = resolveShipProfile(repoRoot)
  const cfg = profile.crossModelReview
  if (!cfg?.enabled) {
    throw new Error('crossModelReview.enabled must be true to run an external review')
  }
  if (!cfg.diffEgressConsent) {
    throw new Error('crossModelReview.diffEgressConsent must be true to send the diff')
  }
  return invokeExternalReview({
    repoRoot,
    taskId: options.taskId,
    prompt: options.prompt,
    diff: options.diff ?? readStdin(),
    cfg,
    access: detectExternalModel('codex'),
    tier: normTier(options.tier),
    phase: options.phase ?? 'refactor',
    vertical: options.vertical ?? 'bugs',
  })
}

export interface ShipCrossModelReviewOptions {
  dir: string
  taskId: string
  tier: ShipTier
  phase: TaskPhase
  vertical: string
  cfg: CrossModelReviewConfig
  access?: ExternalModelAccess
}

/** Run the automatic refactor-step bridge; consent-off runs only the local degradation recorder. */
export function runShipCrossModelReview(
  options: ShipCrossModelReviewOptions,
): ExternalReviewResult {
  const repoRoot = resolve(options.dir)
  let diff = ''
  let access = options.cfg.diffEgressConsent ? options.access : undefined
  if (options.cfg.diffEgressConsent) {
    try {
      diff = runCli('git', ['diff', '--binary', 'origin/main...HEAD'], {
        cwd: repoRoot,
        timeoutMs: 15_000,
      }).stdout
    } catch {
      // The integration still writes the enabled-run degradation artifact; no diff is sent.
      access = undefined
    }
  }
  return invokeExternalReview({
    repoRoot,
    taskId: options.taskId,
    prompt: SHIP_CROSS_MODEL_PROMPT,
    diff,
    cfg: options.cfg,
    ...(access !== undefined ? { access } : {}),
    tier: options.tier,
    phase: options.phase,
    vertical: options.vertical,
  })
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch (error) {
    throw toFsError(error, 'stdin')
  }
}
