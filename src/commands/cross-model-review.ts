// SPDX-License-Identifier: Apache-2.0
// #2357 — the /ship-facing boundary for the optional external review seat.
import { resolve } from 'node:path'
import { detectExternalModel } from '../detectors/external-model.js'
import { invokeExternalReview, type ExternalReviewResult } from '../integrations/external-review.js'
import { resolveShipProfile } from './ship-profile.js'
import { normTier } from './ship-tier.js'
import type { TaskPhase } from './task-state.js'
import { readFileSync } from 'node:fs'
import { toFsError } from '../utils/fs.js'

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

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch (error) {
    throw toFsError(error, 'stdin')
  }
}
