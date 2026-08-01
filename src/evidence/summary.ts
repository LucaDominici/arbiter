// SPDX-License-Identifier: Apache-2.0
import { validateProvenance } from './provenance.js'

const REQUIRED_FIELDS = [
  'head_sha',
  'head_sha_short',
  'obs_gate',
  'tests',
  'coverage',
  'mutation',
  'security',
] as const

interface ValidationOk {
  ok: true
}

interface ValidationFail {
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

  // #2164: provenance is optional, but when present must validate cleanly — same
  // exit-1-on-schema-error convention as every other field here (no new exit-code
  // path on this side; AC-1's exit-2 request is scoped to the bundle/JSON Schema gate).
  if (body['provenance'] !== undefined) {
    errors.push(...validateProvenance(body['provenance']))
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true }
}
