// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PlanJsonV1, type ReviewJsonV1 } from '../types/plan.js'
import { runVerify, type RunVerifyResult } from '../verify/run.js'
import type { VerifyPlanRule } from '../verify/rules/types.js'
import { jsonOutput } from '../utils/json-output.js'

export interface VerifyPlanOptions {
  file: string
  dir?: string
  reviewer?: string
  failOnWarn?: boolean
  json?: boolean
  extraRules?: VerifyPlanRule[]
}

export interface VerifyPlanResult {
  exitCode: 0 | 2
  status: ReviewJsonV1['status']
  runId?: string
  reviewPath?: string
}

function writeErrorReview(
  pointerDir: string,
  taskId: string,
  reviewer: string,
  ruleId: string,
  message: string,
): void {
  try {
    mkdirSync(pointerDir, { recursive: true })
  } catch (err) {
    process.stderr.write(
      `[arbiter] could not create pointer dir ${pointerDir}: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return
  }
  const review: ReviewJsonV1 = {
    timestamp: new Date().toISOString(),
    task_id: taskId,
    run_id: 'error',
    status: 'ERROR',
    reviewer,
    verification: {
      ok: false,
      violations: [
        {
          rule_id: ruleId,
          severity: 'ERROR',
          message,
          ssot_pointer: null,
          evidence: { paths: [] },
        },
      ],
      notes: [],
    },
    blocking: true,
    blocking_reason: message,
  }
  try {
    writeFileSync(join(pointerDir, 'REVIEW.json'), JSON.stringify(review, null, 2), 'utf-8')
  } catch {
    // best-effort; don't let write failure mask the original error
  }
}

function reportError(pointerDir: string, reviewer: string, ruleId: string, msg: string): void {
  writeErrorReview(pointerDir, 'unknown', reviewer, ruleId, msg)
}

function parsePlan(
  planSource: string,
): { ok: true; data: PlanJsonV1 } | { ok: false; msg: string; ruleId: string } {
  let raw: unknown
  try {
    raw = JSON.parse(planSource)
  } catch (err) {
    return {
      ok: false,
      msg: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ruleId: 'SCHEMA',
    }
  }
  const parsed = PlanJsonV1.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      msg: `schema validation failed: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      ruleId: 'SCHEMA',
    }
  }
  return { ok: true, data: parsed.data }
}

function emitError(json: boolean | undefined, filePath: string, msg: string): void {
  if (json) {
    jsonOutput('verify plan', 'error', { file: filePath }, [msg])
  } else {
    process.stderr.write(`Error: ${msg}\n`)
  }
}

function emitVerifyResult(
  json: boolean | undefined,
  result: RunVerifyResult,
  exitCode: 0 | 2,
  reviewPath: string,
): void {
  if (json) {
    jsonOutput('verify plan', exitCode === 0 ? 'ok' : 'error', {
      status: result.status,
      runId: result.runId,
      violations: result.review.verification.violations.length,
      reviewPath,
      runDir: result.runDir,
    })
    return
  }
  process.stdout.write(
    `verify plan: ${result.status} (runId=${result.runId}, violations=${result.review.verification.violations.length})\n`,
  )
  for (const v of result.review.verification.violations) {
    process.stdout.write(`  [${v.severity} ${v.rule_id}] ${v.message}\n`)
  }
  process.stdout.write(`review: ${reviewPath}\n`)
}

export function runVerifyPlan(opts: VerifyPlanOptions): VerifyPlanResult {
  const dir = resolve(opts.dir ?? '.')
  const filePath = resolve(opts.file)
  const pointerDir = join(dir, '.arbiter', 'plan')
  const reviewer = opts.reviewer ?? 'bridge-reviewer'

  if (!existsSync(filePath)) {
    const msg = `plan file not found: ${filePath}`
    reportError(pointerDir, reviewer, 'IO', msg)
    emitError(opts.json, filePath, msg)
    return { exitCode: 2, status: 'ERROR' }
  }

  let planSource: string
  try {
    planSource = readFileSync(filePath, 'utf-8')
  } catch (err) {
    const msg = `failed to read plan file: ${err instanceof Error ? err.message : String(err)}`
    reportError(pointerDir, reviewer, 'IO', msg)
    emitError(opts.json, filePath, msg)
    return { exitCode: 2, status: 'ERROR' }
  }
  const parseResult = parsePlan(planSource)
  if (!parseResult.ok) {
    reportError(pointerDir, reviewer, parseResult.ruleId, parseResult.msg)
    emitError(opts.json, filePath, parseResult.msg)
    return { exitCode: 2, status: 'ERROR' }
  }

  const plan = parseResult.data

  if (!plan.review_bridge.enabled) {
    const skippedReview: ReviewJsonV1 = {
      timestamp: new Date().toISOString(),
      task_id: plan.task_id,
      run_id: 'skipped',
      status: 'SKIPPED',
      reviewer,
      verification: {
        ok: true,
        violations: [],
        notes: ['review_bridge.enabled:false'],
      },
      blocking: false,
      blocking_reason: null,
    }
    mkdirSync(pointerDir, { recursive: true })
    const reviewPath = join(pointerDir, 'REVIEW.json')
    writeFileSync(join(pointerDir, 'PLAN.json'), planSource, 'utf-8')
    writeFileSync(reviewPath, JSON.stringify(skippedReview, null, 2), 'utf-8')
    if (opts.json) {
      jsonOutput('verify plan', 'ok', { status: 'SKIPPED', reviewPath })
    } else {
      process.stdout.write(`verify plan: SKIPPED (review_bridge.enabled:false)\n`)
    }
    return { exitCode: 0, status: 'SKIPPED', reviewPath }
  }

  let result: RunVerifyResult
  try {
    result = runVerify({
      plan,
      planSource,
      targetDir: dir,
      ...(opts.reviewer !== undefined ? { reviewer: opts.reviewer } : {}),
      ...(opts.failOnWarn !== undefined ? { failOnWarn: opts.failOnWarn } : {}),
      extraRules: opts.extraRules ?? [],
    })
  } catch (err) {
    const msg = `verification engine failed: ${err instanceof Error ? err.message : String(err)}`
    reportError(pointerDir, reviewer, 'RUNTIME', msg)
    emitError(opts.json, filePath, msg)
    return { exitCode: 2, status: 'ERROR' }
  }

  const exitCode: 0 | 2 = result.status === 'APPROVED' ? 0 : 2
  const reviewPath = join(result.pointerDir, 'REVIEW.json')
  emitVerifyResult(opts.json, result, exitCode, reviewPath)
  return { exitCode, status: result.status, runId: result.runId, reviewPath }
}
