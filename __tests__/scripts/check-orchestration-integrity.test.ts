// SPDX-License-Identifier: Apache-2.0
// #2387: the orchestration surface (ship/drain/skills + their template twins) drifts in two
// mechanically-detectable ways that no gate saw before this one:
//   A. a referenced skill/command/agent name that does not exist on disk — shipped live in
//      skill-forced-eval.mjs, which told the model to invoke /test-driven-development,
//      /verification-before-completion and a context7-docs subagent, none of which exist;
//   B. a mandatory ceremony step re-marked optional — wave-drain's Phase 2.5 adversarial plan
//      gate was headed "Optional", and newer models read that literally and skip it.
// These tests prove the gate catches both, and that the real repo surface is clean.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseReferences,
  findDanglingReferences,
  findOptionalCeremony,
} from '../../scripts/check-orchestration-integrity.mjs'

const SCRIPT = resolve('scripts/check-orchestration-integrity.mjs')

/** A surface dir with the given docs plus a registry of real skill/command/agent names. */
function surface(docs: Record<string, string>, registry: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-orch-'))
  for (const [rel, body] of Object.entries(docs)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body)
  }
  for (const name of registry) {
    mkdirSync(join(dir, '.claude', 'skills', name), { recursive: true })
    writeFileSync(join(dir, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`)
  }
  return dir
}

// ─── parseReferences ─────────────────────────────────────────────────────────

describe('parseReferences', () => {
  it('extracts slash-command references', () => {
    expect(parseReferences('run /review-code before merging')).toContain('review-code')
  })

  it('extracts backticked skill references introduced by the word skill', () => {
    expect(parseReferences('invoke the `tdd` skill per unit')).toContain('tdd')
    expect(parseReferences('skill `wave-drain` owns the wave')).toContain('wave-drain')
  })

  it('ignores prose that merely contains a slash (paths, dates, fractions)', () => {
    const refs = parseReferences('see src/templates/claude and hop 1/3 on 2026/08/27')
    expect(refs).toEqual([])
  })

  it('deduplicates repeated references', () => {
    expect(parseReferences('/ship then /ship again')).toEqual(['ship'])
  })
})

// ─── findDanglingReferences (AC-1) ───────────────────────────────────────────

describe('findDanglingReferences', () => {
  it('flags a reference with no skill, command or agent file behind it', () => {
    const dir = surface(
      { '.claude/commands/ship.md': 'Step 1: invoke the `test-driven-development` skill.\n' },
      ['tdd'],
    )
    try {
      const found = findDanglingReferences(dir)
      expect(found).toHaveLength(1)
      expect(found[0].reference).toBe('test-driven-development')
      expect(found[0].file).toContain('ship.md')
      expect(found[0].line).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accepts a reference that resolves to a real skill', () => {
    const dir = surface({ '.claude/commands/ship.md': 'invoke the `tdd` skill\n' }, ['tdd'])
    try {
      expect(findDanglingReferences(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── findOptionalCeremony (AC-2) ─────────────────────────────────────────────

describe('findOptionalCeremony', () => {
  it('flags an optionality marker on a line naming a mandatory ceremony step', () => {
    const dir = surface({
      '.claude/skills/wave-drain/SKILL.md': '## Phase 2.5 — Optional 3-hop plan gate\n',
    })
    try {
      const found = findOptionalCeremony(dir)
      expect(found).toHaveLength(1)
      expect(found[0].marker.toLowerCase()).toBe('optional')
      expect(found[0].ceremony.toLowerCase()).toContain('plan gate')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves an optionality marker alone when no ceremony term shares the line', () => {
    const dir = surface({
      '.claude/commands/wt-open.md': 'The slug argument is optional.\n',
    })
    try {
      expect(findOptionalCeremony(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves a ceremony term alone when it is stated unconditionally', () => {
    const dir = surface({
      '.claude/skills/wave-drain/SKILL.md': '## Phase 2.5 — Per-issue 3-hop plan gate (default-on)\n',
    })
    try {
      expect(findOptionalCeremony(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── CLI contract (AC-3) ─────────────────────────────────────────────────────

describe('check-orchestration-integrity CLI', () => {
  it('exits 0 on arbiter’s own orchestration surface', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8' })
    expect(r.stderr + r.stdout).toBeTruthy()
    expect(r.status).toBe(0)
  })

  it('exits 1 and names the offending file when the surface has drifted', () => {
    const dir = surface({
      '.claude/commands/ship.md': 'invoke the `no-such-skill` skill\n',
    })
    try {
      const r = spawnSync('node', [SCRIPT, `--root=${dir}`], { encoding: 'utf-8' })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('no-such-skill')
      expect(r.stderr).toContain('ship.md')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 with usage on --help', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage:')
  })
})
