// SPDX-License-Identifier: Apache-2.0
// #1873 T6 — wave-drain skill v2 + /drain v2 carry the parallel-wave protocol
// proven 2026-07-09/10 and ratified in ADR-103: gate mutex, anti-stall
// (gate-wait vs turn-stall), watchdog sweep, conflicts-with serial lane,
// optional 3-hop plan gate, end-of-wave reaper, hybrid convergence model with
// the cross-repo appendix. Also guards the dual-side invariant (self file ==
// template) and the supersession of the old orchestrator prompt.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

const skillSelf = join(repoRoot, '.claude', 'skills', 'wave-drain', 'SKILL.md')
const skillTemplate = join(
  repoRoot,
  'src',
  'templates',
  'claude',
  'skills',
  'wave-drain',
  'SKILL.md.ejs',
)
const drainSelf = join(repoRoot, '.claude', 'commands', 'drain.md')
const drainTemplate = join(repoRoot, 'src', 'templates', 'claude', 'commands', 'drain.md.ejs')
const promptPath = join(repoRoot, '.claude', 'prompts', 'opus-4.8-harness-wave-orchestrator.md')

describe('wave-drain SKILL.md v2 — parallel protocol (#1873, ADR-103)', () => {
  const md = readFileSync(skillSelf, 'utf-8')

  it('is dual-side: self file is byte-equal to the claude template', () => {
    expect(md).toBe(readFileSync(skillTemplate, 'utf-8'))
  })

  it('states the ADR-103 legality conditions and the ratified convergence model', () => {
    expect(md).toMatch(/ADR-103/)
    expect(md).toMatch(/dedicated worktree/i)
    expect(md).toMatch(/distinct branch/i)
    expect(md).toMatch(/disjoint file-sets/i)
    expect(md).toMatch(/owner-ratified\s*\n?2026-07-10/)
    expect(md).toMatch(/ONE wave PR/)
  })

  it('prescribes the gate mutex primitive with SIGKILL/OOM release and serial fallback', () => {
    expect(md).toMatch(/arbiter gate-exec/)
    expect(md).toMatch(/flock\(1\)/)
    expect(md).toMatch(/SIGKILL\/OOM/)
    expect(md).toMatch(/--max-parallel 1/)
  })

  it('separates gate-wait (deterministic) from turn-stall (bounded by the watchdog sweep)', () => {
    expect(md).toMatch(/Gate-wait/i)
    expect(md).toMatch(/Turn-stall/i)
    expect(md).toMatch(/watchdog sweep/i)
    expect(md).toMatch(/bounded/)
  })

  it('routes declared conflicts to a serial lane (conflicts-with)', () => {
    expect(md).toMatch(/conflicts-with:#N/)
    expect(md).toMatch(/serial lane/i)
  })

  it('has the per-issue 3-hop plan gate default-on with tier-scaled skeptics', () => {
    expect(md).toMatch(/Phase 2\.5/)
    expect(md).toMatch(/default-on/)
    expect(md).toMatch(/needs-plan/)
    expect(md).toMatch(/hop 1\/3/)
    expect(md).toMatch(/file:line/)
    expect(md).toMatch(/refutation_skeptics/)
  })

  it('caps parallelism by machine headroom', () => {
    expect(md).toMatch(/nproc - 2/)
  })

  it('isolates per-worktree caches (symlink-children + VITE_CACHE_DIR belt-and-braces)', () => {
    expect(md).toMatch(/symlink-children/)
    expect(md).toMatch(/VITE_CACHE_DIR/)
  })

  it('computes the fan-in order from the REAL branch diffs', () => {
    expect(md).toMatch(/git diff --name-only/)
  })

  it('reaps zombies at end of wave with the prune primitive (dry-run first)', () => {
    expect(md).toMatch(/arbiter worktree prune --stale/)
    expect(md).toMatch(/--execute/)
  })

  it('carries the cross-repo appendix: flock one-liner, merge-train, explicit caveats', () => {
    expect(md).toMatch(/Appendix — Cross-repo/i)
    expect(md).toMatch(/flock \/tmp\/<repo>-gate\.lock/)
    expect(md).toMatch(/merge-train/i)
    // The three failure modes the governed wave-PR model eliminates:
    expect(md).toMatch(/Crash mid-train/i)
    expect(md).toMatch(/Branch protection/i)
    expect(md).toMatch(/Exclusion instability/i)
  })

  it('keeps the v1 contract intact (Phase 0.5 harvest + FindingEntry + iron law)', () => {
    expect(md).toMatch(/Phase 0\.5/)
    expect(md).toMatch(/FindingEntry/)
    expect(md).toMatch(/Iron Law/)
  })
})

describe('/drain v2 — entrypoint (#1873, ADR-103)', () => {
  const md = readFileSync(drainSelf, 'utf-8')

  it('is dual-side: self file is byte-equal to the claude template', () => {
    expect(md).toBe(readFileSync(drainTemplate, 'utf-8'))
  })

  it('wires the v2 protocol: mutex, cap, 3-hop, prune, convergence', () => {
    expect(md).toMatch(/arbiter gate-exec/)
    expect(md).toMatch(/nproc - 2/)
    expect(md).toMatch(/needs-plan/)
    expect(md).toMatch(/arbiter worktree prune --stale/)
    expect(md).toMatch(/ADR-103/)
    expect(md).toMatch(/one wave PR/i)
  })
})

describe('opus-4.8 harness-wave orchestrator prompt — superseded (#1873 T6)', () => {
  const md = readFileSync(promptPath, 'utf-8')

  it('is marked deprecated in frontmatter and SUPERSEDED in the body', () => {
    expect(md).toMatch(/status: deprecated/)
    expect(md).toMatch(/SUPERSEDED \(#1873, ADR-103\)/)
    expect(md).toMatch(/wave-drain/)
  })
})
