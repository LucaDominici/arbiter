// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/gen-status.test.ts
// TDD tests for scripts/gen-status.mjs — generated STATUS.md dashboard.

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, chmodSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import {
  collectData,
  buildStatus,
  buildMilestoneSection,
  runCli,
} from '../../scripts/gen-status.mjs'

const SCRIPT = resolve('scripts/gen-status.mjs')

// `gh` unreachable — PATH scoped to node's own directory only (same trick as
// __tests__/scripts/pr-merge-watch.test.ts). Used to prove a code path never shells out.
const NODE_ONLY_PATH = dirname(process.execPath)

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gen-status-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

type OpenEpicRow = { issue: string; title: string; state: string }

function makeFixtures(
  dir: string,
  opts: {
    matrixRows?: string[]
    missionText?: string
    /** Rows for the "**Open epics:**" table (#2409 fallback source). `null` omits the section entirely. */
    openEpics?: OpenEpicRow[] | null
  } = {},
): void {
  // Internal docs (post public/internal split, #1770); PRD.md stays public
  const internalProduct = join(dir, 'docs', 'internal', 'PRODUCT')
  const publicProduct = join(dir, 'docs', 'PRODUCT')
  mkdirSync(internalProduct, { recursive: true })
  mkdirSync(publicProduct, { recursive: true })

  // FEATURE_MATRIX.md
  const matrixRows = opts.matrixRows ?? [
    '| REQ-001 | Init wizard | N01 | L1 | Verified | src/init.ts | __tests__/init.test.ts | docs/REFERENCE/INIT.md | | done |',
    '| REQ-002 | Audit trail | N08 | L4 | Done | src/audit.ts | | docs/REFERENCE/AUDIT.md | | done |',
    '| REQ-003 | Brownfield | N02 | L2 | Partial | src/brown.ts | | | | partial |',
    '| REQ-004 | Snapshot | N03 | L3 | Missing | | | | #42 | missing |',
  ]
  writeFileSync(
    join(internalProduct, 'FEATURE_MATRIX.md'),
    `---\ntitle: 'FEATURE_MATRIX'\ndoc_version: '1.0.0'\nstatus: active\nlast_review: '2026-06-04'\nowner: ''\ncanonical_id: ''\ntags: []\nrelated: []\n---\n\n# FEATURE_MATRIX\n\n${matrixRows.join('\n')}\n`,
  )

  // PRD.md
  const missionText =
    opts.missionText ?? 'Arbiter installs governance in one command. No drift, no duplication.'
  writeFileSync(
    join(publicProduct, 'PRD.md'),
    `---\ntitle: 'PRD'\ndoc_version: '1.0.0'\nstatus: active\nlast_review: '2026-06-04'\nowner: ''\ncanonical_id: ''\ntags: []\nrelated: []\n---\n\n# Arbiter PRD\n\n## Vision\n\n${missionText}\n\n## Non-Goals\n\nSome non-goal.\n`,
  )

  // MILESTONES.md — headings are flavor only (#2409 no longer parses "## M<n>" for state);
  // the "**Open epics:**" table is the fallback milestone source.
  const openEpics =
    opts.openEpics === undefined
      ? [{ issue: '#100', title: 'Default Epic', state: 'OPEN' }]
      : opts.openEpics
  const epicsSection =
    openEpics === null
      ? ''
      : `\n**Open epics:**\n\n| Epic | Title | State |\n| --- | --- | --- |\n${openEpics.map((e) => `| ${e.issue} | ${e.title} | ${e.state} |`).join('\n')}\n`
  writeFileSync(
    join(internalProduct, 'MILESTONES.md'),
    `---\ntitle: 'Milestones'\ndoc_version: '1.0.0'\nstatus: active\nlast_review: '2026-06-04'\nowner: ''\ncanonical_id: ''\ntags: []\nrelated: []\n---\n\n# Milestones\n\n## M1 — Docs Foundation ✅ DONE\n\nSome scope.\n${epicsSection}`,
  )
}

/** A fake `gh` binary (shell script) that answers `--version` and `api ... milestones...`. */
function makeFakeGh(dir: string, milestonesJson: string): string {
  const binDir = join(dir, 'fakebin')
  mkdirSync(binDir, { recursive: true })
  const ghPath = join(binDir, 'gh')
  writeFileSync(
    ghPath,
    `#!/bin/sh\ncase "$*" in\n  *milestones*) cat <<'JSON'\n${milestonesJson}\nJSON\n  ;;\n  *) echo "gh version 2.0.0 (fake)" ;;\nesac\n`,
  )
  chmodSync(ghPath, 0o755)
  return binDir
}

// ---------------------------------------------------------------------------
// collectData()
// ---------------------------------------------------------------------------

describe('collectData()', () => {
  it('counts Verified rows correctly', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      expect(data.counts.Verified).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('counts Done rows correctly', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      expect(data.counts.Done).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('counts Partial rows correctly', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      expect(data.counts.Partial).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('counts Missing rows correctly', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      expect(data.counts.Missing).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('lists partial REQ IDs', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      expect(data.partialReqs).toContain('REQ-003')
    } finally {
      cleanup()
    }
  })

  it('lists missing REQ IDs', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      expect(data.missingReqs).toContain('REQ-004')
    } finally {
      cleanup()
    }
  })

  it('extracts mission from PRD §Vision paragraph', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, { missionText: 'Arbiter is the answer.' })
      const data = collectData(dir)
      expect(data.mission).toContain('Arbiter is the answer.')
    } finally {
      cleanup()
    }
  })

  it('throws or returns error indicator when FEATURE_MATRIX.md is missing', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs', 'PRODUCT'), { recursive: true })
      expect(() => collectData(dir)).toThrow()
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// collectData() — milestones (#2409)
// ---------------------------------------------------------------------------

describe('collectData() — milestones (#2409)', () => {
  it('fallback source: keeps only OPEN rows from the "**Open epics:**" table', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, {
        openEpics: [
          { issue: '#100', title: 'Epic One', state: 'OPEN' },
          { issue: '#101', title: 'Epic Two', state: 'CLOSED' },
          { issue: '#102', title: 'Epic Three', state: 'OPEN' },
        ],
      })
      const data = collectData(dir)
      expect(data.milestones).toEqual({
        source: 'fallback',
        items: [
          { issue: '#100', title: 'Epic One' },
          { issue: '#102', title: 'Epic Three' },
        ],
      })
    } finally {
      cleanup()
    }
  })

  it('fallback source: empty item list when the table has no OPEN rows (not "unavailable")', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, { openEpics: [{ issue: '#1', title: 'Done epic', state: 'CLOSED' }] })
      const data = collectData(dir)
      expect(data.milestones).toEqual({ source: 'fallback', items: [] })
    } finally {
      cleanup()
    }
  })

  it('unavailable source: no live attempt and no "**Open epics:**" table present', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, { openEpics: null })
      const data = collectData(dir)
      expect(data.milestones).toEqual({ source: 'unavailable' })
    } finally {
      cleanup()
    }
  })

  it('live source: tryLive + permitGitHub:true + reachable gh → live milestones win over the fallback table', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, { openEpics: [{ issue: '#1', title: 'must be ignored', state: 'OPEN' }] })
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ permitGitHub: true }))
      const fakeBin = makeFakeGh(
        dir,
        JSON.stringify([
          { title: 'M-A Test', open_issues: 3, closed_issues: 1, due_on: '2026-09-11T00:00:00Z' },
        ]),
      )
      const originalPath = process.env.PATH
      try {
        process.env.PATH = `${fakeBin}:${originalPath}`
        const data = collectData(dir, { tryLive: true })
        expect(data.milestones).toEqual({
          source: 'live',
          items: [{ title: 'M-A Test', openIssues: 3, closedIssues: 1, dueOn: '2026-09-11' }],
        })
      } finally {
        process.env.PATH = originalPath
      }
    } finally {
      cleanup()
    }
  })

  it('live requested but permitGitHub is not set → falls back to the epics table, no gh call', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, { openEpics: [{ issue: '#5', title: 'Fallback Epic', state: 'OPEN' }] })
      // No arbiter.json written — permitGitHub defaults to false (deny-by-default).
      const data = collectData(dir, { tryLive: true })
      expect(data.milestones).toEqual({
        source: 'fallback',
        items: [{ issue: '#5', title: 'Fallback Epic' }],
      })
    } finally {
      cleanup()
    }
  })

  it('tryLive omitted (default false) never touches gh even when permitted', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, { openEpics: [{ issue: '#5', title: 'Fallback Epic', state: 'OPEN' }] })
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ permitGitHub: true }))
      const originalPath = process.env.PATH
      try {
        process.env.PATH = NODE_ONLY_PATH // gh unreachable — a spawn attempt throws, not silently succeeds
        const data = collectData(dir) // tryLive not passed
        expect(data.milestones).toEqual({
          source: 'fallback',
          items: [{ issue: '#5', title: 'Fallback Epic' }],
        })
      } finally {
        process.env.PATH = originalPath
      }
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// buildMilestoneSection() — golden output (#2409)
// ---------------------------------------------------------------------------

describe('buildMilestoneSection() — golden (#2409)', () => {
  it('live source, with items', () => {
    const out = buildMilestoneSection({
      source: 'live',
      items: [{ title: 'M-A Truth', openIssues: 8, closedIssues: 2, dueOn: '2026-09-11' }],
    })
    expect(out).toBe(
      '\n## Milestones\n\n_Source: live GitHub milestones._\n\n' +
        '| Milestone | Open | Closed | Due |\n| --- | --- | --- | --- |\n' +
        '| M-A Truth | 8 | 2 | 2026-09-11 |\n',
    )
  })

  it('live source, no open milestones', () => {
    const out = buildMilestoneSection({ source: 'live', items: [] })
    expect(out).toBe(
      '\n## Milestones\n\n_Source: live GitHub milestones._\n\nNo open milestones.\n',
    )
  })

  it('fallback source, with items', () => {
    const out = buildMilestoneSection({
      source: 'fallback',
      items: [{ issue: '#1491', title: 'Release-readiness remediation' }],
    })
    expect(out).toBe(
      '\n## Milestones\n\n_Source: MILESTONES.md open epics table (offline fallback)._\n\n' +
        '| Epic | Title |\n| --- | --- |\n' +
        '| #1491 | Release-readiness remediation |\n',
    )
  })

  it('fallback source, no open epics', () => {
    const out = buildMilestoneSection({ source: 'fallback', items: [] })
    expect(out).toBe(
      '\n## Milestones\n\n_Source: MILESTONES.md open epics table (offline fallback)._\n\nNo open epics.\n',
    )
  })

  it('unavailable source — the explicit offline message, never a frozen "complete" block', () => {
    const out = buildMilestoneSection({ source: 'unavailable' })
    expect(out).toBe('\n## Milestones\n\nmilestones: source unavailable (offline)\n')
  })
})

// ---------------------------------------------------------------------------
// buildStatus()
// ---------------------------------------------------------------------------

describe('buildStatus()', () => {
  it('contains sentinel START marker', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      const out = buildStatus(data)
      expect(out).toContain('<!-- STATUS_START -->')
    } finally {
      cleanup()
    }
  })

  it('contains sentinel END marker', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      const out = buildStatus(data)
      expect(out).toContain('<!-- STATUS_END -->')
    } finally {
      cleanup()
    }
  })

  it('includes mission text', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, { missionText: 'Arbiter is unique.' })
      const data = collectData(dir)
      const out = buildStatus(data)
      expect(out).toContain('Arbiter is unique.')
    } finally {
      cleanup()
    }
  })

  it('includes feature status count for Verified', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      const out = buildStatus(data)
      expect(out).toMatch(/Verified.*1/)
    } finally {
      cleanup()
    }
  })

  it('includes the Milestones section and never a frozen "complete" block', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, { openEpics: [{ issue: '#100', title: 'Open Epic', state: 'OPEN' }] })
      const data = collectData(dir)
      const out = buildStatus(data)
      expect(out).toContain('## Milestones')
      expect(out).toContain('#100')
      expect(out).not.toContain('All milestones complete')
    } finally {
      cleanup()
    }
  })

  it('includes links to INDEX.md and FEATURE_MATRIX.md', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      const out = buildStatus(data)
      expect(out).toContain('INDEX.md')
      expect(out).toContain('FEATURE_MATRIX.md')
    } finally {
      cleanup()
    }
  })

  it('links to PRD.md via the corrected relative path (#2409 deliverable B)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      const out = buildStatus(data)
      expect(out).toContain('[PRD.md](../../PRODUCT/PRD.md)')
    } finally {
      cleanup()
    }
  })

  it('lists partial REQs in output', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      const out = buildStatus(data)
      expect(out).toContain('REQ-003')
    } finally {
      cleanup()
    }
  })

  it('lists missing REQs in output', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      const out = buildStatus(data)
      expect(out).toContain('REQ-004')
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// runCli()
// ---------------------------------------------------------------------------

describe('runCli()', () => {
  it('write mode: creates STATUS.md and returns 0', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const statusPath = join(dir, 'docs', 'PRODUCT', 'STATUS.md')
      const code = await runCli(dir, statusPath, false)
      expect(code).toBe(0)
      const content = readFileSync(statusPath, 'utf-8')
      expect(content).toContain('<!-- STATUS_START -->')
    } finally {
      cleanup()
    }
  })

  it('check mode: returns 1 when STATUS.md is missing', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const statusPath = join(dir, 'docs', 'PRODUCT', 'STATUS.md')
      const code = await runCli(dir, statusPath, true)
      expect(code).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('check mode: returns 0 after write produces up-to-date file', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const statusPath = join(dir, 'docs', 'PRODUCT', 'STATUS.md')
      await runCli(dir, statusPath, false)
      const code = await runCli(dir, statusPath, true)
      expect(code).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('check mode: returns 1 when STATUS.md has stale content', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const statusPath = join(dir, 'docs', 'PRODUCT', 'STATUS.md')
      writeFileSync(statusPath, '# Stale content\n')
      const code = await runCli(dir, statusPath, true)
      expect(code).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('returns 1 on IO error (missing source files)', async () => {
    const code = await runCli('/nonexistent/__gen_status__', '/nonexistent/STATUS.md', false)
    expect(code).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// runCli() — --check is fallback-only and reproducible without `gh` (#2409)
// ---------------------------------------------------------------------------

describe('runCli() — --check determinism (#2409)', () => {
  it('plain --write (no --live), then --check on a machine with no gh on PATH, is green', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, { openEpics: [{ issue: '#9', title: 'Reproducible epic', state: 'OPEN' }] })
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ permitGitHub: true }))
      const statusPath = join(dir, 'docs', 'internal', 'PRODUCT', 'STATUS.md')
      await runCli(dir, statusPath, false) // opts omitted → tryLive false, matches plain CLI --write
      const originalPath = process.env.PATH
      try {
        process.env.PATH = NODE_ONLY_PATH // gh unreachable
        const code = await runCli(dir, statusPath, true)
        expect(code).toBe(0)
      } finally {
        process.env.PATH = originalPath
      }
    } finally {
      cleanup()
    }
  })

  it('--check ignores an explicit tryLive:true opt — always fallback-only', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, { openEpics: [{ issue: '#9', title: 'Reproducible epic', state: 'OPEN' }] })
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ permitGitHub: true }))
      const fakeBin = makeFakeGh(
        dir,
        JSON.stringify([
          { title: 'Should be ignored', open_issues: 1, closed_issues: 0, due_on: null },
        ]),
      )
      const statusPath = join(dir, 'docs', 'internal', 'PRODUCT', 'STATUS.md')
      await runCli(dir, statusPath, false) // committed content generated fallback-only
      const originalPath = process.env.PATH
      try {
        process.env.PATH = `${fakeBin}:${originalPath}` // gh IS reachable and would answer 'live' if asked
        const code = await runCli(dir, statusPath, true, { tryLive: true })
        expect(code).toBe(0) // --check must have ignored tryLive:true and stayed on fallback
      } finally {
        process.env.PATH = originalPath
      }
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// CLI (spawnSync) — smoke tests
// ---------------------------------------------------------------------------

describe('gen-status.mjs CLI', () => {
  it('--check exits 1 when STATUS.md is missing in a real-ish tree', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const result = spawnSync('node', [SCRIPT, '--check'], {
        encoding: 'utf-8',
        cwd: dir,
        env: { ...process.env, NODE_PATH: undefined },
      })
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('--write creates STATUS.md then --check passes', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      spawnSync('node', [SCRIPT, '--write'], { encoding: 'utf-8', cwd: dir })
      const result = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf-8', cwd: dir })
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
