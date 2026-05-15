// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { verifySummarySha } from '../risk/sha-check.js'
import { loadSummaryFile } from './load.js'

const REQUIRED_FIELDS = [
  'head_sha',
  'head_sha_short',
  'obs_gate',
  'tests',
  'coverage',
  'mutation',
  'security',
] as const

export type RequiredField = (typeof REQUIRED_FIELDS)[number]

export interface ValidationOk {
  ok: true
}

export interface ValidationFail {
  ok: false
  errors: string[]
}

export type ValidationResult = ValidationOk | ValidationFail

export interface EvidenceSummary {
  head_sha: string
  head_sha_short: string
  obs_gate: 'PASS' | 'FAIL'
  tests: Record<string, unknown>
  coverage: Record<string, unknown>
  mutation: Record<string, unknown>
  security: Record<string, unknown>
  // ADR-030 optional fields
  timestamp?: string
  commit?: string
  duration_seconds?: number
}

export function validateSummarySchema(body: Record<string, unknown>): ValidationResult {
  const errors: string[] = []

  for (const field of REQUIRED_FIELDS) {
    if (!(field in body) || body[field] === undefined || body[field] === null) {
      errors.push(`missing required field: ${field}`)
    }
  }

  if ('obs_gate' in body && body['obs_gate'] !== 'PASS' && body['obs_gate'] !== 'FAIL') {
    errors.push(`obs_gate must be "PASS" or "FAIL", got: ${String(body['obs_gate'])}`)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true }
}

export type VerifyStage = 'missing' | 'parse' | 'schema' | 'sha' | 'head' | 'pass'

export interface VerifyOutcome {
  ok: boolean
  stage: VerifyStage
  errors: string[]
}

export interface VerifySummaryArgs {
  dir: string
  headSha?: string
}

export function verifySummary({ dir, headSha }: VerifySummaryArgs): VerifyOutcome {
  const summaryPath = join(dir, '.evidence', 'SUMMARY.json')

  const loaded = loadSummaryFile(summaryPath)
  if (!loaded.ok) {
    const stage: VerifyStage = loaded.reason.includes('not found') ? 'missing' : 'parse'
    return { ok: false, stage, errors: [loaded.reason] }
  }

  const schemaResult = validateSummarySchema(loaded.body)
  if (!schemaResult.ok) {
    return { ok: false, stage: 'schema', errors: schemaResult.errors }
  }

  const shaResult = verifySummarySha(loaded.body)
  if (!shaResult.ok) {
    return {
      ok: false,
      stage: 'sha',
      errors: [shaResult.reason ?? 'sha mismatch'],
    }
  }

  if (headSha !== undefined) {
    const storedHead = loaded.body['head_sha']
    if (storedHead !== headSha) {
      return {
        ok: false,
        stage: 'head',
        errors: [
          `head_sha mismatch: summary has "${String(storedHead)}", current HEAD is "${headSha}"`,
        ],
      }
    }
  }

  return { ok: true, stage: 'pass', errors: [] }
}
