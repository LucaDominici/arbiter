import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PlanJsonV1, ReviewJsonV1 } from '../types/plan.js'
import { buildRegistry } from './rules/registry.js'
import type { VerifyPlanRule } from './rules/types.js'

export interface RunVerifyOptions {
  plan: PlanJsonV1
  planSource: string
  targetDir: string
  reviewer?: string
  failOnWarn?: boolean
  extraRules?: VerifyPlanRule[]
}

export interface RunVerifyResult {
  runId: string
  status: ReviewJsonV1['status']
  review: ReviewJsonV1
  runDir: string
  pointerDir: string
}

function mintRunId(targetDir: string): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const time = now.toISOString().slice(11, 19).replace(/:/g, '')
  for (let attempt = 0; attempt < 3; attempt++) {
    const suffix = randomBytes(2).toString('hex')
    const id = `bridge-${date}-${time}-${suffix}`
    const dir = join(targetDir, '.arbiter', 'plan', 'runs', id)
    if (!existsSync(dir)) return id
  }
  return `bridge-${date}-${time}-${randomBytes(2).toString('hex')}`
}

function makeErrorReview(
  taskId: string,
  runId: string,
  reviewer: string,
  ruleId: string,
  message: string,
): ReviewJsonV1 {
  return {
    timestamp: new Date().toISOString(),
    task_id: taskId,
    run_id: runId,
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
}

function determineStatus(
  violations: ReviewJsonV1['verification']['violations'],
  failOnWarn: boolean,
  notes: string[],
): ReviewJsonV1['status'] {
  const hasErrors = violations.some((v) => v.severity === 'ERROR')
  const hasWarns = violations.some((v) => v.severity === 'WARN')
  if (hasErrors) return 'REJECTED'
  if (hasWarns && failOnWarn) return 'REJECTED'
  if (hasWarns) notes.push('Plan approved with warnings — review before merge')
  return 'APPROVED'
}

function persist(
  runDir: string,
  pointerDir: string,
  planSource: string,
  review: ReviewJsonV1,
): void {
  const reviewJson = JSON.stringify(review, null, 2)
  try {
    writeFileSync(join(runDir, 'PLAN.json'), planSource, 'utf-8')
    writeFileSync(join(runDir, 'REVIEW.json'), reviewJson, 'utf-8')
    writeFileSync(join(pointerDir, 'PLAN.json'), planSource, 'utf-8')
    writeFileSync(join(pointerDir, 'REVIEW.json'), reviewJson, 'utf-8')
  } catch (err) {
    process.stderr.write(
      `[arbiter] persist failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    throw err
  }
}

export function runVerify(opts: RunVerifyOptions): RunVerifyResult {
  const { plan, planSource, targetDir, extraRules = [] } = opts
  const reviewer = opts.reviewer ?? plan.review_bridge.reviewer
  const failOnWarn = opts.failOnWarn ?? plan.review_bridge.fail_on_warn

  const runId = mintRunId(targetDir)
  const runDir = join(targetDir, '.arbiter', 'plan', 'runs', runId)
  const pointerDir = join(targetDir, '.arbiter', 'plan')

  mkdirSync(runDir, { recursive: true })
  mkdirSync(pointerDir, { recursive: true })

  const registryResult = buildRegistry(extraRules)
  if (registryResult.error !== undefined) {
    const review = makeErrorReview(plan.task_id, runId, reviewer, 'REGISTRY', registryResult.error)
    persist(runDir, pointerDir, planSource, review)
    return { runId, status: 'ERROR', review, runDir, pointerDir }
  }

  const ctx = { targetDir }
  const violations: ReviewJsonV1['verification']['violations'] = []
  const notes: string[] = []

  for (const rule of registryResult.rules) {
    let applies: boolean
    try {
      applies = rule.applicability(plan)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const review = makeErrorReview(
        plan.task_id,
        runId,
        reviewer,
        'RUNTIME',
        `Rule "${rule.id}" applicability threw: ${message}`,
      )
      persist(runDir, pointerDir, planSource, review)
      return { runId, status: 'ERROR', review, runDir, pointerDir }
    }
    if (!applies) continue
    try {
      const ruleViolations = rule.evaluate(plan, ctx)
      for (const v of ruleViolations) {
        violations.push({
          rule_id: v.rule_id,
          severity: v.severity,
          message: v.message,
          ssot_pointer: v.ssot_pointer,
          evidence: v.evidence,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const review = makeErrorReview(
        plan.task_id,
        runId,
        reviewer,
        'RUNTIME',
        `Rule "${rule.id}" threw: ${message}`,
      )
      persist(runDir, pointerDir, planSource, review)
      return { runId, status: 'ERROR', review, runDir, pointerDir }
    }
  }

  const status = determineStatus(violations, failOnWarn, notes)
  const errCount = violations.filter((v) => v.severity === 'ERROR').length
  const blockingReason =
    status === 'REJECTED'
      ? errCount > 0
        ? `${errCount} ERROR violation(s)`
        : 'WARN violations with fail_on_warn:true'
      : null

  const review: ReviewJsonV1 = {
    timestamp: new Date().toISOString(),
    task_id: plan.task_id,
    run_id: runId,
    status,
    reviewer,
    verification: { ok: status === 'APPROVED', violations, notes },
    blocking: status === 'REJECTED',
    blocking_reason: blockingReason,
  }

  persist(runDir, pointerDir, planSource, review)
  return { runId, status, review, runDir, pointerDir }
}
