// SPDX-License-Identifier: Apache-2.0
// TDD RED: #1050 — nightly-required RESULTS array omits `fuzz` + `soak-e2e`.
// After fix: every job listed in `needs:` of nightly-required must also appear
// in the RESULTS bash array.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOW_PATH = resolve('.github/workflows/06-nightly.yml')

function parseNightlyRequiredNeeds(src: string): string[] {
  // Locate the nightly-required job block specifically, not evidence-collect or others.
  // The job name in the YAML is always "  nightly-required:" (two-space indent at top level).
  const jobStart = src.indexOf('\n  nightly-required:')
  if (jobStart < 0) return []
  const jobSlice = src.slice(jobStart)
  // Capture only list items under `needs:` — lines starting with whitespace+dash, plus blank lines.
  // Stops at the next sibling key (4-space indent + non-dash character, e.g. `    if: always()`).
  const needsMatch = jobSlice.match(/\n {4}needs:\s*\n((?:[ \t]+-[^\n]*\n?|\n)*)/)
  if (!needsMatch) return []
  return needsMatch[1]
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter((j) => j.length > 0 && !j.startsWith('#'))
}

function parseResultsArray(src: string): string[] {
  // Extract the RESULTS=(...) bash array in the nightly-required job
  const match = src.match(/RESULTS=\(\s*([\s\S]+?)\s*\)/)
  if (!match) return []
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((l) => l.length > 0)
}

describe('#1050 — nightly-required RESULTS completeness', () => {
  it('RESULTS array includes every job in needs:', () => {
    const src = readFileSync(WORKFLOW_PATH, 'utf-8')
    const needs = parseNightlyRequiredNeeds(src)
    const results = parseResultsArray(src)

    expect(needs.length).toBeGreaterThan(0)
    const missingFromResults = needs.filter(
      (job) => !results.some((r) => r.includes(`needs.${job}.result`)),
    )
    expect(
      missingFromResults,
      `These jobs in needs: are missing from RESULTS: ${missingFromResults.join(', ')}`,
    ).toHaveLength(0)
  })

  it('RESULTS array includes fuzz', () => {
    const src = readFileSync(WORKFLOW_PATH, 'utf-8')
    const results = parseResultsArray(src)
    expect(results.some((r) => r.includes('needs.fuzz.result'))).toBe(true)
  })

  it('RESULTS array includes soak-e2e', () => {
    const src = readFileSync(WORKFLOW_PATH, 'utf-8')
    const results = parseResultsArray(src)
    expect(results.some((r) => r.includes('needs.soak-e2e.result'))).toBe(true)
  })
})
