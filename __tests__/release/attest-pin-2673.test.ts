// SPDX-License-Identifier: Apache-2.0
// #2673: release workflow red — attest-build-provenance re-pin + stryker entry repair.
// The 0.6.0 tag (#2672) failed before publishing: attest-build-provenance@520aba2 (labeled v2)
// no longer resolves upstream, and Stryker's vitest.configFile pointed at a nonexistent
// vite.config.ts. This pins the fix so a future re-pin regresses loudly instead of red on tag.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const PIN = 'actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be'

const ATTEST_FILES = [
  '.github/actions/sign-and-attest/action.yml',
  '.github/workflows/05-release.yml',
  'src/templates/github/actions/sign-and-attest/action.yml.ejs',
  'src/templates/github/workflows/05-release.yml.ejs',
]

describe('release 05-release attest pin (#2673)', () => {
  it.each(ATTEST_FILES)('%s pins attest-build-provenance to the resolvable v2.4.0 SHA', (file) => {
    const content = readFileSync(resolve(root, file), 'utf-8')
    expect(content).toContain(PIN)
  })

  it('stryker.config.json points vitest at the in-place stryker config, not vite.config.ts', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'stryker.config.json'), 'utf-8'))
    expect(config.vitest.configFile).toBe('vitest.stryker.config.ts')
  })

  // #2673: the mutation-blocking job never went green on any release run since May -- the full
  // candidate surface (generators/**/*.ts + init.ts + catalog.ts) is 9297 mutants at concurrency
  // 2. break: 60 stays untouched; the surface is bounded by MEASURED PER-MUTANT COST, not just
  // mutant count -- github.ts (319 mutants) looked cheap by count, but each of its mutants is
  // covered by hundreds of render/e2e tests under perTest coverage, collapsing throughput to
  // ~2min/mutant (a real proving run projected >10h and was killed). init.ts + githooks.ts +
  // gitignore.ts + security.ts (the real gitleaks/PII/ZAP generator) = 270 mutants, all cheap,
  // at concurrency: 4 (this runner has 24 cores/62GB, was under-used at 2). check-all.ts (804)
  // and registry.ts (535) each individually exceed the remaining budget; github.ts and
  // catalog.ts (2482) are debt with their measured per-mutant cost as the reason
  // (docs/internal/release-playbook.md § Mutation surface debt), not silently dropped.
  it('mutation surface is bounded to the highest-criticality, cheapest-to-test generators', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'stryker.config.json'), 'utf-8'))
    const mutate: string[] = config.mutate
    expect(mutate).not.toContain('src/invariants/catalog.ts')
    expect(mutate).not.toContain('src/generators/**/*.ts')
    expect(mutate).not.toContain('src/generators/check-all.ts')
    expect(mutate).not.toContain('src/generators/registry.ts')
    expect(mutate).not.toContain('src/generators/github.ts')
    expect(mutate).toContain('src/commands/init.ts')
    expect(mutate).toContain('src/generators/githooks.ts')
    expect(mutate).toContain('src/generators/gitignore.ts')
    expect(mutate).toContain('src/generators/security.ts')
    expect(mutate.filter((g) => g.startsWith('src/generators/') && !g.startsWith('!')).length).toBe(
      3,
    )
  })

  // Measured: 270 mutants at concurrency 4 on a contended machine (other gates running
  // concurrently) took 60min 0s wall time -- equal to the CI job's 60-minute budget, no margin.
  // Raised to 6 (24-core/62GB runner, still under-used) for headroom; see
  // docs/internal/release-playbook.md § Mutation surface debt for the full measured table.
  it('concurrency is raised again for CI headroom after the c=4 run measured 0 margin', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'stryker.config.json'), 'utf-8'))
    expect(config.concurrency).toBe(6)
  })
})
