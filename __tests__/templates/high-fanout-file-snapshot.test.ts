// SPDX-License-Identifier: Apache-2.0
/**
 * Full-content approval snapshots for arbiter's HIGHEST-FANOUT templates
 * (literature GAP 3 — heterogeneous approval workflow).
 *
 * The bake harness (fixture-bake.test.ts) hashes generated content across 26
 * fixtures but stores only the sha256 — a mismatch says WHICH file changed,
 * never WHAT changed. For the handful of templates nearly every consumer
 * project receives (CLAUDE.md, the fast-PR CI workflow, the gate script
 * itself), a full-text approval file is more valuable: `git diff` on the
 * snapshot shows the exact template-body change in the PR, no `-u` re-run
 * required to see it.
 *
 * Uses Vitest's native `toMatchFileSnapshot` (standard `vitest -u` update
 * loop) rather than a bespoke update flag — selective adoption for these 3
 * templates only, NOT a wholesale migration of the ~230 existing render
 * tests (a golden master complements focused assertions; it does not
 * replace them — Codurance / ApprovalTests).
 *
 * One representative config per template — a common real-world shape
 * (TypeScript backend-web-db, L2, GitHub-hosted, peer-review) — not a
 * kitchen-sink or exhaustive matrix; that combinatorial axis is covered by
 * the existing per-branch render tests plus fixture-bake's 26-fixture matrix.
 */
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig, renderCheckAll } from '../helpers.js'

const REPRESENTATIVE_CONFIG = {
  ...makeConfig('/tmp/arbiter-high-fanout-snapshot', {
    language: 'typescript',
    buildTool: 'npm',
    archetype: 'backend-web-db',
    governanceLevel: 'L2',
    useGitHub: true,
    githubOwner: 'octo-org',
    githubRepo: 'octo-repo',
    hasPublicApi: true,
    hasDatabase: true,
    collaborationMode: 'peer-review',
  }),
  coverageEnabled: true,
  coverageThreshold: 80,
} as unknown as Record<string, unknown>

describe('high-fanout template full-content approval snapshots', () => {
  it('claude/CLAUDE.md.ejs matches the approved snapshot', async () => {
    const rendered = renderTemplate('claude/CLAUDE.md.ejs', REPRESENTATIVE_CONFIG)
    await expect(rendered).toMatchFileSnapshot('__snapshots__/high-fanout/CLAUDE.md')
  })

  it('github/workflows/01-pr-fast.yml.ejs matches the approved snapshot', async () => {
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', REPRESENTATIVE_CONFIG)
    await expect(rendered).toMatchFileSnapshot('__snapshots__/high-fanout/01-pr-fast.yml')
  })

  it('scripts/check-all.mjs.ejs matches the approved snapshot', async () => {
    const rendered = renderCheckAll(REPRESENTATIVE_CONFIG)
    await expect(rendered).toMatchFileSnapshot('__snapshots__/high-fanout/check-all.mjs')
  })
})
