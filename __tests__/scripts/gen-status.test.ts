// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/gen-status.test.ts
// TDD tests for scripts/gen-status.mjs — generated STATUS.md dashboard.

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { collectData, buildStatus, runCli } from '../../scripts/gen-status.mjs'

const SCRIPT = resolve('scripts/gen-status.mjs')

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gen-status-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function makeFixtures(
  dir: string,
  opts: {
    matrixRows?: string[]
    missionText?: string
    milestones?: Array<{ title: string; done: boolean }>
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

  // MILESTONES.md
  const milestones = opts.milestones ?? [
    { title: 'M1 — Docs Foundation', done: true },
    { title: 'M2 — PRD', done: true },
    { title: 'M3 — Architecture', done: false },
    { title: 'M4 — Testing', done: false },
  ]
  const milestoneContent = milestones
    .map((m) => `## ${m.title}${m.done ? ' ✅ DONE' : ''}\n\nSome scope.\n`)
    .join('\n')
  writeFileSync(
    join(internalProduct, 'MILESTONES.md'),
    `---\ntitle: 'Milestones'\ndoc_version: '1.0.0'\nstatus: active\nlast_review: '2026-06-04'\nowner: ''\ncanonical_id: ''\ntags: []\nrelated: []\n---\n\n# Milestones\n\n${milestoneContent}`,
  )
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

  it('identifies first non-DONE milestone as current', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, {
        milestones: [
          { title: 'M1 — Alpha', done: true },
          { title: 'M2 — Beta', done: false },
          { title: 'M3 — GA', done: false },
        ],
      })
      const data = collectData(dir)
      expect(data.currentMilestone).toContain('M2')
    } finally {
      cleanup()
    }
  })

  it('returns null currentMilestone when all milestones are done', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, {
        milestones: [
          { title: 'M1 — Alpha', done: true },
          { title: 'M2 — Beta', done: true },
        ],
      })
      const data = collectData(dir)
      expect(data.currentMilestone).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('lists all open milestones', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, {
        milestones: [
          { title: 'M1 — Alpha', done: true },
          { title: 'M2 — Beta', done: false },
          { title: 'M3 — GA', done: false },
        ],
      })
      const data = collectData(dir)
      expect(data.openMilestones).toHaveLength(2)
      expect(data.openMilestones[0]).toContain('M2')
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

  it('includes current milestone section', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const data = collectData(dir)
      const out = buildStatus(data)
      expect(out).toContain('M3')
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
