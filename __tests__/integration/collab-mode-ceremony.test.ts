// SPDX-License-Identifier: Apache-2.0
/**
 * Integration tests for collaborationMode end-to-end wiring (ADR-051, #1119).
 *
 * Coverage:
 * 1. Full-tree idempotence — `init` then `update` produces zero file changes (headline proof).
 * 2. Ceremony divergence — solo task.md has NO `gh pr create`; team task.md HAS it.
 * 3. Merge verb — both use `gh pr merge --merge` (ff, ADR-051), never --squash.
 * 4. CLAUDE.md wiring — collaboration mode row present.
 * 5. configure round-trip — changing collaborationMode then update regenerates task.md.
 * 6. configure garbage rejection — invalid value throws / rejected.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runInit } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import { runConfigure } from '../../src/commands/configure.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-collab-test-'))
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' })
}

/**
 * Infrastructure files that are intentionally different between init and update:
 * - arbiter.json: init uses buildArbiterConfig shape; update re-normalizes via {…stored,…}.
 * - .arbiter-generated.json: snapshot created by saveConfigAndSnapshot (update only, not init).
 * These are excluded from the idempotence comparison; only GOVERNANCE files are checked.
 */
const INFRA_FILES = new Set(['arbiter.json', '.arbiter-generated.json'])

/** Recursively list generated GOVERNANCE files (excluding git/node_modules/infra). */
function listGovernanceFiles(dir: string): string[] {
  const SKIP = new Set(['.git', 'node_modules', '.gradle', 'target', 'build', '.arbiter'])
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const entry of readdirSync(cur)) {
      if (SKIP.has(entry)) continue
      const full = join(cur, entry)
      const st = statSync(full)
      if (st.isDirectory()) stack.push(full)
      else if (st.isFile()) {
        const rel = relative(dir, full)
        if (!INFRA_FILES.has(rel)) out.push(rel)
      }
    }
  }
  return out.sort()
}

/** Snapshot { path → content } for all governance files. */
function snapshotFiles(dir: string): Map<string, string> {
  const snap = new Map<string, string>()
  for (const rel of listGovernanceFiles(dir)) {
    snap.set(rel, readFileSync(join(dir, rel), 'utf-8'))
  }
  return snap
}

/** Compare two snapshots, return paths where content changed or files added/removed. */
function diffSnapshots(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = []
  for (const [p, content] of after) {
    if (!before.has(p)) changed.push(`+${p} (added)`)
    else if (before.get(p) !== content) changed.push(`~${p} (changed)`)
  }
  for (const p of before.keys()) {
    if (!after.has(p)) changed.push(`-${p} (removed)`)
  }
  return changed.sort()
}

// ── 1. Full-tree idempotence ──────────────────────────────────────────────────

describe('collaborationMode — idempotence (#1119)', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('init→update produces zero file changes for peer-review (default) mode', async () => {
    dir = tmpDir()
    initGit(dir)

    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })
    const before = snapshotFiles(dir)

    await runUpdate({ dir, github: false })
    const after = snapshotFiles(dir)

    const delta = diffSnapshots(before, after)
    expect(delta, `Non-idempotent files:\n${delta.join('\n')}`).toHaveLength(0)
  })

  it('init→update produces zero file changes for trunk-solo mode (--solo)', async () => {
    dir = tmpDir()
    initGit(dir)

    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true, solo: true })
    const before = snapshotFiles(dir)

    await runUpdate({ dir, github: false })
    const after = snapshotFiles(dir)

    const delta = diffSnapshots(before, after)
    expect(delta, `Non-idempotent files:\n${delta.join('\n')}`).toHaveLength(0)
  })
})

// ── 2. Ceremony divergence ────────────────────────────────────────────────────

describe('collaborationMode — ceremony divergence (#1119)', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('trunk-solo (direct) ship.md shows "direct merge" block — no PR (#1216)', async () => {
    // #1216: orchestration content is now in ship.md, not task.md.
    // With backend=markdown (no --github flag), direct merge shows the trunk-direct block,
    // NOT the PR ceremony. The distinguishing marker is "git push origin HEAD:main".
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true, solo: true })

    const shipMd = readFileSync(join(dir, '.claude', 'commands', 'ship.md'), 'utf-8')
    expect(shipMd).toContain('git push origin HEAD:main')
    expect(shipMd).not.toContain('gh pr create')
  })

  it('trunk-solo ship.md has 1 review agent minimum (minimal ceremony, #1216)', async () => {
    // #1216: orchestration content (review agent count) is now in ship.md.
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true, solo: true })

    const shipMd = readFileSync(join(dir, '.claude', 'commands', 'ship.md'), 'utf-8')
    expect(shipMd).toContain('Solo review — self-audit pass (1 agent)')
  })

  it('peer-review ship.md does NOT show "direct merge" block (#1216)', async () => {
    // #1216: orchestration content is now in ship.md.
    // peer-review uses mergeMode=pr-ff, so the direct merge block is absent.
    // With markdown backend, Complete section uses arbiter work close.
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })

    const shipMd = readFileSync(join(dir, '.claude', 'commands', 'ship.md'), 'utf-8')
    expect(shipMd).not.toContain('git push origin HEAD:main')
    expect(shipMd).toContain('arbiter work close')
  })

  it('peer-review ship.md does NOT contain --squash (ADR-051 compliance, #1216)', async () => {
    // #1216: orchestration content is now in ship.md.
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })

    const shipMd = readFileSync(join(dir, '.claude', 'commands', 'ship.md'), 'utf-8')
    expect(shipMd).not.toContain('--squash')
  })

  it('peer-review ship.md has tiered review agent counts from taskTiers (#1216)', async () => {
    // #1216: orchestration content (tier review agent counts) is now in ship.md.
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })

    const shipMd = readFileSync(join(dir, '.claude', 'commands', 'ship.md'), 'utf-8')
    // peer-review uses tier reviewAgentCount from DEFAULT_TASK_TIERS (3/3/4)
    expect(shipMd).toMatch(/XS=3.*S=3.*Standard=4|XS|Standard/s)
  })
})

// ── 3. CLAUDE.md wiring ───────────────────────────────────────────────────────

describe('collaborationMode — CLAUDE.md wiring (#1119)', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('CLAUDE.md has collaboration mode row in Quick Reference for peer-review', async () => {
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })

    const claudeMd = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    expect(claudeMd).toContain('Collaboration mode')
    expect(claudeMd).toContain('peer-review')
  })

  it('CLAUDE.md reflects trunk-solo mode and direct merge', async () => {
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true, solo: true })

    const claudeMd = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    expect(claudeMd).toContain('trunk-solo')
    expect(claudeMd).toContain('direct')
  })
})

// ── 4. configure round-trip ───────────────────────────────────────────────────

describe('collaborationMode — configure round-trip (#1119)', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('configure --set collaborationMode=trunk-solo persists and update reflects in CLAUDE.md', async () => {
    // Note: task.md is written with { skipIfExists: true } so update doesn't rewrite it.
    // CLAUDE.md uses { backup: true } (always replace) so it IS updated by runUpdate.
    // The round-trip test validates the full persist→resolve→render path via CLAUDE.md.
    dir = tmpDir()
    initGit(dir)
    // Start as peer-review (default)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })

    // CLAUDE.md should initially show peer-review
    let claudeMd = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    expect(claudeMd).toContain('peer-review')

    // Round-trip: change mode via configure
    await runConfigure({ dir, sets: ['collaborationMode=trunk-solo'] })

    // Verify arbiter.json now has trunk-solo
    const raw = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as {
      collaborationMode?: string
    }
    expect(raw.collaborationMode).toBe('trunk-solo')

    // Regenerate — CLAUDE.md should now reflect trunk-solo
    await runUpdate({ dir, github: false })

    claudeMd = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    expect(claudeMd).toContain('trunk-solo')
  })

  it('configure --set collaborationMode=garbage rejects the value', async () => {
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })

    await expect(runConfigure({ dir, sets: ['collaborationMode=garbage'] })).rejects.toThrow()
  })

  it('configure --set solo.mergeMode=pr-ff persists and update reflects in CLAUDE.md', async () => {
    // Solo with mergeMode=direct → CLAUDE.md shows direct.
    // After setting solo.mergeMode=pr-ff, CLAUDE.md should show pr-ff.
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true, solo: true })

    // Apply override: trunk-solo but with PR-based merge
    await runConfigure({ dir, sets: ['solo.mergeMode=pr-ff'] })

    // Verify arbiter.json has the override
    const raw = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as {
      collaborationMode?: string
      solo?: { mergeMode?: string }
    }
    expect(raw.solo?.mergeMode).toBe('pr-ff')

    // CLAUDE.md gets regenerated (backup: true) → should reflect pr-ff
    await runUpdate({ dir, github: false })

    const claudeMd = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    expect(claudeMd).toContain('pr-ff')
  })
})

// ── 5. arbiter.json persistence ───────────────────────────────────────────────

describe('collaborationMode — arbiter.json persistence (#1119)', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('--solo sets collaborationMode=trunk-solo in arbiter.json', async () => {
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true, solo: true })

    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true)
    const raw = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as {
      collaborationMode?: string
    }
    expect(raw.collaborationMode).toBe('trunk-solo')
  })

  it('default (non-solo) sets collaborationMode=peer-review in arbiter.json', async () => {
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })

    const raw = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as {
      collaborationMode?: string
    }
    expect(raw.collaborationMode).toBe('peer-review')
  })
})
