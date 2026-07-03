// SPDX-License-Identifier: Apache-2.0
//
// #1730 — companion-plugin awareness. resolveCompanions maps HOME-installed skills to their
// ship-phase companion policy under the self-and-mode guards, then two pure formatters render
// the green-phase instruction and the `Companion:` announcement. Detection is HOME-ONLY: a
// hostile target repo can never spoof activation because the resolver has no targetDir input.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveCompanions,
  companionGreenInstruction,
  companionStatusLine,
  diagnoseCompanions,
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

  it.each(['java', 'kotlin', 'csharp'])(
    'defaults %s stacks to lite mode when the companion is installed',
    (language) => {
      const active = resolveCompanions({ self: false, claudeHome: makeHome(true), language })
      expect(active[0]?.mode).toBe('lite')
    },
  )

  it.each(['typescript', 'javascript', 'python'])(
    'keeps %s stacks at full mode by default',
    (language) => {
      const active = resolveCompanions({ self: false, claudeHome: makeHome(true), language })
      expect(active[0]?.mode).toBe('full')
    },
  )

  it('explicit override mode:full beats the conservative java lite default', () => {
    const active = resolveCompanions({
      self: false,
      claudeHome: makeHome(true),
      language: 'java',
      overrides: { ponytail: { mode: 'full' } },
    })
    expect(active[0]?.mode).toBe('full')
  })

  it('explicit override mode:lite beats the typescript full default', () => {
    const active = resolveCompanions({
      self: false,
      claudeHome: makeHome(true),
      language: 'typescript',
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

  it('sanitizes an out-of-union override mode at resolution — ultra falls back to stack default before policy default', () => {
    // Defense-in-depth below the schema validator: even if a malformed override map reaches
    // resolution (e.g. a caller bypassing loadConfig), `ultra` must never survive.
    const active = resolveCompanions({
      self: false,
      claudeHome: makeHome(true),
      language: 'java',
      overrides: { ponytail: { mode: 'ultra' as unknown as 'lite' } },
    })
    expect(active).toHaveLength(1)
    expect(active[0]?.mode).toBe('lite')
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

describe('diagnoseCompanions (#1747 — arbiter doctor Companions section)', () => {
  it('reports installed:true, policy-default mode/source when nothing overrides it', () => {
    const rows = diagnoseCompanions({ claudeHome: makeHome(true) })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'ponytail:ponytail',
      label: 'ponytail',
      installed: true,
      disabledByConfig: false,
      mode: 'full',
      modeSource: 'policy default',
    })
  })

  it('reports installed:false (not an error) when nothing is installed, still resolving a mode', () => {
    const rows = diagnoseCompanions({ claudeHome: makeHome(false) })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.installed).toBe(false)
    expect(rows[0]?.mode).toBe('full')
    expect(rows[0]?.modeSource).toBe('policy default')
  })

  it('reports disabledByConfig:true for an installed companion disabled via arbiter.json', () => {
    const rows = diagnoseCompanions({
      claudeHome: makeHome(true),
      overrides: { ponytail: { enabled: false } },
    })
    expect(rows[0]?.installed).toBe(true)
    expect(rows[0]?.disabledByConfig).toBe(true)
  })

  it('sources an explicit mode override as "arbiter.json override"', () => {
    const rows = diagnoseCompanions({
      claudeHome: makeHome(true),
      overrides: { ponytail: { mode: 'lite' } },
    })
    expect(rows[0]?.mode).toBe('lite')
    expect(rows[0]?.modeSource).toBe('arbiter.json override')
  })

  it('sources a conservative stack default (java) as "stack default" absent any override', () => {
    const rows = diagnoseCompanions({ claudeHome: makeHome(true), language: 'java' })
    expect(rows[0]?.mode).toBe('lite')
    expect(rows[0]?.modeSource).toBe('stack default')
  })

  it('never diverges from resolveCompanions on the active-mode value (shared precedence chain)', () => {
    const home = makeHome(true)
    const active = resolveCompanions({ self: false, claudeHome: home, language: 'java' })
    const rows = diagnoseCompanions({ claudeHome: home, language: 'java' })
    expect(rows[0]?.mode).toBe(active[0]?.mode)
  })
})
