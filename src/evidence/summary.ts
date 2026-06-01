// SPDX-License-Identifier: Apache-2.0

const REQUIRED_FIELDS = [
  'head_sha',
  'head_sha_short',
  'obs_gate',
  'tests',
  'coverage',
  'mutation',
  'security',
] as const

export interface ValidationOk {
  ok: true
}

export interface ValidationFail {
  ok: false
  errors: string[]
}

export type ValidationResult = ValidationOk | ValidationFail

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
