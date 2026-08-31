// SPDX-License-Identifier: Apache-2.0
// #2435 AC-2 — `review-completion` reconciles the review dispatch sidecar against the agent
// returns. Registered `kind: warn`, it could not fail a build, so `/ship` could reach
// `verification` with no review ever dispatched and nothing red. It is a hard check at L2.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const REGISTRY_TPL = 'src/templates/scripts/gate-registry.yml.ejs'
const SELF_CHECK_ALL = 'scripts/check-all.mjs'

/** The single registry line declaring gate `id`. */
function registryEntry(id: string): string {
  const line = readFileSync(REGISTRY_TPL, 'utf-8')
    .split('\n')
    .find((l) => l.includes(`{ id: ${id},`))
  expect(line, `no gate-registry entry for id ${id}`).toBeDefined()
  return line as string
}

describe('#2435 AC-2 — review-completion is a hard check at L2', () => {
  it('the emitted gate registry declares kind: check at level L2 (AC-2)', () => {
    const entry = registryEntry('review-completion')
    expect(entry).toMatch(/level:\s*L2\b/)
    expect(entry).toMatch(/kind:\s*check\b/)
    expect(entry).not.toMatch(/kind:\s*warn\b/)
  })

  it("arbiter's own check-all.mjs runs it as a hard check, not a warn (AC-2)", () => {
    const source = readFileSync(SELF_CHECK_ALL, 'utf-8')
    const line = source
      .split('\n')
      .find((l) => l.includes("'scripts/check-review-completion.mjs'"))
    expect(line, 'check-review-completion.mjs is not wired into scripts/check-all.mjs').toBeDefined()
    expect(line as string).toContain('runCheck(')
    expect(line as string).not.toContain('runWarnCheck(')
  })
})
