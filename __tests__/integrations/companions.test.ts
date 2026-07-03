// SPDX-License-Identifier: Apache-2.0
//
// #1730 — companion-plugin awareness. resolveCompanions maps HOME-installed skills to their
// ship-phase companion policy under the self-and-mode guards, then two pure formatters render
// the green-phase instruction and the `Companion:` announcement. Detection is HOME-ONLY: a
// hostile target repo can never spoof activation because the resolver has no targetDir input.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CompanionEvidenceV1,
  companionEvidencePath,
  resolveCompanions,
  companionGreenInstruction,
  companionStatusLine,
  writeCompanionEvidence,
} from '../../src/integrations/companions.js'
import { clearSkillCache, detectInstalledSkills } from '../../src/integrations/skill-detector.js'

const homes: string[] = []

/** Build a throwaway ~/.claude-shaped home, optionally with a real ponytail skill installed. */
function makeHome(withPonytail: boolean): string {
  const home = mkdtempSync(join(tmpdir(), 'arbiter-companion-home-'))
  homes.push(home)
  if (withPonytail) {
    const dir = join(home, 'plugins', 'cache', 'ponytail', '4.8.4', 'skills', 'ponytail')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ponytail\nversion: 4.8.4\n---\n# Ponytail\n`)
  } else {
    mkdirSync(join(home, 'plugins'), { recursive: true })
  }
  return home
}

beforeEach(() => clearSkillCache())
afterEach(() => {
  clearSkillCache()
  while (homes.length) {
    const h = homes.pop()
    if (h) rmSync(h, { recursive: true, force: true })
  }
})

describe('resolveCompanions (#1730)', () => {
  it('detects ponytail installed in the user home and defaults to full mode', () => {
    const active = resolveCompanions({ self: false, claudeHome: makeHome(true) })
    expect(active).toHaveLength(1)
    expect(active[0]?.label).toBe('ponytail')
    expect(active[0]?.mode).toBe('full')
  })

  it('returns [] when no companion is installed (graceful degradation)', () => {
    expect(resolveCompanions({ self: false, claudeHome: makeHome(false) })).toEqual([])
  })

  it('never activates a companion on arbiter-self, even when installed', () => {
    expect(resolveCompanions({ self: true, claudeHome: makeHome(true) })).toEqual([])
  })

  it('config override enabled:false disables an installed companion', () => {
    const active = resolveCompanions({
      self: false,
      claudeHome: makeHome(true),
      overrides: { ponytail: { enabled: false } },
    })
    expect(active).toEqual([])
  })

  it('config override mode:lite downgrades the resolved mode', () => {
    const active = resolveCompanions({
      self: false,
      claudeHome: makeHome(true),
      overrides: { ponytail: { mode: 'lite' } },
    })
    expect(active[0]?.mode).toBe('lite')
  })

  it('is a HOME-ONLY signal: the resolver takes a single options object and no targetDir', () => {
    // Structural spoofing guard: a hostile repo cannot pass its own tree to this resolver,
    // so a committed .claude/plugins/ponytail in a target repo can never force activation.
    expect(resolveCompanions.length).toBeLessThanOrEqual(1)
    expect(resolveCompanions({ self: false, claudeHome: makeHome(false) })).toEqual([])
  })

  it('ignores a spoofed companion committed inside the target repo, even as cwd (red-team HIGH-1)', () => {
    // Behavioural spoofing guard: cwd IS a hostile repo that commits a ponytail plugin layout
    // in its own tree. With an empty user home, resolution must still be empty — the repo tree
    // is never scanned, no matter what the process cwd is.
    const hostileRepo = mkdtempSync(join(tmpdir(), 'arbiter-hostile-repo-'))
    homes.push(hostileRepo)
    const spoof = join(
      hostileRepo,
      '.claude',
      'plugins',
      'cache',
      'ponytail',
      '4.8.4',
      'skills',
      'ponytail',
    )
    mkdirSync(spoof, { recursive: true })
    writeFileSync(join(spoof, 'SKILL.md'), `---\nname: ponytail\nversion: 4.8.4\n---\n# Ponytail\n`)
    const emptyHome = makeHome(false)
    const prevCwd = process.cwd()
    try {
      process.chdir(hostileRepo)
      clearSkillCache()
      expect(resolveCompanions({ self: false, claudeHome: emptyHome })).toEqual([])
      expect(detectInstalledSkills({ targetDir: '', claudeHome: emptyHome })).toEqual([])
    } finally {
      process.chdir(prevCwd)
      clearSkillCache()
    }
  })
})

describe('companion formatters (#1730)', () => {
  it('companionGreenInstruction is empty for no companions', () => {
    expect(companionGreenInstruction([])).toBe('')
  })

  it('companionGreenInstruction carries the YAGNI ladder, the mode, and the safety-net guardrail', () => {
    const active = resolveCompanions({ self: false, claudeHome: makeHome(true) })
    const instr = companionGreenInstruction(active)
    // Conjunctive: every load-bearing element must survive edits to the registry text.
    expect(instr).toMatch(/YAGNI/i)
    expect(instr).toMatch(/ladder/i)
    expect(instr).toMatch(/stdlib/i)
    expect(instr).toMatch(/full mode/)
    expect(instr).not.toContain('{mode}')
    expect(instr).toMatch(/never use ultra/i)
    expect(instr).toMatch(/gates remain the safety net/i)
  })

  it('companionStatusLine renders label (mode); empty for none', () => {
    expect(companionStatusLine([])).toBe('')
    const active = resolveCompanions({ self: false, claudeHome: makeHome(true) })
    expect(companionStatusLine(active)).toMatch(/ponytail \(full\)/)
  })

  it('sanitizes an out-of-union override mode at resolution — ultra falls back to the policy default', () => {
    // Defense-in-depth below the schema validator: even if a malformed override map reaches
    // resolution (e.g. a caller bypassing loadConfig), `ultra` must never survive.
    const active = resolveCompanions({
      self: false,
      claudeHome: makeHome(true),
      overrides: { ponytail: { mode: 'ultra' as unknown as 'lite' } },
    })
    expect(active).toHaveLength(1)
    expect(active[0]?.mode).toBe('full')
  })

  it('formatters render multiple companions in the given (registry) order, deterministically', () => {
    const a = {
      id: 'ponytail:ponytail',
      label: 'ponytail',
      mode: 'lite' as const,
      policy: { label: 'ponytail', defaultMode: 'full' as const, greenInstruction: 'A {mode}.' },
    }
    const b = {
      id: 'caveman:caveman',
      label: 'caveman',
      mode: 'full' as const,
      policy: { label: 'caveman', defaultMode: 'full' as const },
    }
    expect(companionStatusLine([a, b])).toBe('ponytail (lite), caveman (full)')
    expect(companionStatusLine([b, a])).toBe('caveman (full), ponytail (lite)')
    // announce-only companion (no greenInstruction) contributes nothing to the green text
    expect(companionGreenInstruction([a, b])).toBe('A lite.')
  })
})

describe('companion evidence writer (#1745)', () => {
  const activeCompanion = {
    id: 'ponytail:ponytail',
    label: 'ponytail',
    mode: 'full' as const,
    policy: { label: 'ponytail', defaultMode: 'full' as const, greenInstruction: 'DRAFT {mode}' },
  }

  it('writes a companion evidence file with companions, diffStats, and recordedAt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-companion-evidence-'))
    homes.push(dir)
    const recordedAt = '2026-07-03T00:00:00.000Z'
    const out = writeCompanionEvidence({
      repoDir: dir,
      taskId: '#1745',
      isArbiterSelf: false,
      companions: [activeCompanion],
      recordedAt,
      gatherDiffStats: () => ({ files: 3, insertions: 12, deletions: 4 }),
    })
    expect(out).toBe(companionEvidencePath('#1745', dir))
    expect(existsSync(out ?? '')).toBe(true)
    const raw = JSON.parse(readFileSync(out ?? '', 'utf-8')) as unknown
    expect(CompanionEvidenceV1.safeParse(raw).success).toBe(true)
    expect(raw).toEqual({
      $schemaVersion: 1,
      companions: [{ id: 'ponytail:ponytail', mode: 'full' }],
      diffStats: { files: 3, insertions: 12, deletions: 4 },
      recordedAt,
    })
  })

  it('writes nothing for a companion-free verification', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-companion-evidence-empty-'))
    homes.push(dir)
    expect(
      writeCompanionEvidence({
        repoDir: dir,
        taskId: '#1745',
        isArbiterSelf: false,
        companions: [],
        gatherDiffStats: () => ({ files: 3, insertions: 12, deletions: 4 }),
      }),
    ).toBeNull()
    expect(existsSync(companionEvidencePath('#1745', dir))).toBe(false)
  })

  it('writes nothing for arbiter-self even when companions are present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-companion-evidence-self-'))
    homes.push(dir)
    expect(
      writeCompanionEvidence({
        repoDir: dir,
        taskId: '#1745',
        isArbiterSelf: true,
        companions: [activeCompanion],
        gatherDiffStats: () => ({ files: 3, insertions: 12, deletions: 4 }),
      }),
    ).toBeNull()
    expect(existsSync(companionEvidencePath('#1745', dir))).toBe(false)
  })
})
