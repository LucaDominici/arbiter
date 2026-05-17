// SPDX-License-Identifier: Apache-2.0
/**
 * Framework-generality gate: every artifact shipped in the #711-720 batch
 * must be free of Viafera-specific domain vocabulary outside of designated
 * provenance/reference sections. Failing here means a deliverable will embed
 * logistics-domain text into the generated files of every arbiter consumer.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const BANNED = /\b(viafera|shipment|freight|driver|carrier|load|cargo|dispatch|logistics)\b/i

// Lines that are exempt because they're inside a Provenance or Reference section
function strippedBody(content: string): string {
  const lines = content.split('\n')
  let inExempt = false
  const kept: string[] = []
  for (const line of lines) {
    if (/^## (Provenance|Reference Implementations)/i.test(line)) {
      inExempt = true
    } else if (/^## /.test(line)) {
      inExempt = false
    }
    if (!inExempt) kept.push(line)
  }
  return kept.join('\n')
}

function assertNoBannedVocabulary(relPath: string): void {
  const abs = join(process.cwd(), relPath)
  if (!existsSync(abs)) {
    // File hasn't been written yet (expected in pure-template test runs) — skip.
    return
  }
  const body = strippedBody(readFileSync(abs, 'utf-8'))
  const match = body.match(BANNED)
  expect(
    match,
    `${relPath} contains banned domain vocabulary: "${match?.[0]}" — strip Viafera-specific content from the template body`,
  ).toBeNull()
}

const BATCH_FILES = [
  'src/templates/governance/enterprise-compliance-baseline.md.ejs',
  'src/templates/governance/gdpr-erasure-runbook.md.ejs',
  'src/templates/governance/gdpr-erasure-hooks/java-spring.java.ejs',
  'src/templates/governance/gdpr-erasure-hooks/ts-express.ts.ejs',
  'src/templates/governance/gdpr-erasure-hooks/go-chi.go.ejs',
  'src/templates/scripts/contract-integrity/openapi-snapshot.mjs.ejs',
  'src/templates/scripts/contract-integrity/dto-parity.mjs.ejs',
  'src/templates/scripts/contract-integrity/operation-smoke.mjs.ejs',
  'src/templates/scripts/contract-integrity/dead-code.mjs.ejs',
  'src/templates/scripts/contract-integrity/test-hygiene.mjs.ejs',
  'docs/METHOD/EXTRACTION_PLAYBOOK.md',
]

describe('Framework-generality gate — #711-720 batch artifacts', () => {
  for (const relPath of BATCH_FILES) {
    it(`${relPath} — no banned domain vocabulary outside Provenance sections`, () => {
      assertNoBannedVocabulary(relPath)
    })
  }
})
