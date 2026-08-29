// SPDX-License-Identifier: Apache-2.0
// CATALOG: gate: scripts/check-tabletop-evidence.mjs (L1)
// CATALOG: Red phase: every test FAILS until scripts/check-tabletop-evidence.mjs exists.
//
// #2429 — the tabletop evidence gate. A tabletop is high-recall/low-precision by design, so
// it only pays for itself if every blocker/major finding terminates in an owner (an issue ref
// or `fixed:<sha>`). This gate is that terminator: frontmatter must satisfy
// schemas/tabletop-evidence.schema.json, the findings table must parse into the seven
// declared columns, and an unowned blocker/major fails the build.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-tabletop-evidence.mjs')
const EVIDENCE_REL = '.arbiter/evidence/tabletop'

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function stage(files: Record<string, string> | null): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tabletop-evidence-'))
  if (files !== null) {
    mkdirSync(join(dir, EVIDENCE_REL), { recursive: true })
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, EVIDENCE_REL, name), body)
    }
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const HEADER = [
  '| step | doc claim (path:line) | observed | severity | class | proposed permanent check | owner |',
  '| --- | --- | --- | --- | --- | --- | --- |',
].join('\n')

function evidence(rows: string[], counts = { blocker: 0, major: 1, minor: 1 }): string {
  return [
    '---',
    'scenario: greenfield-init-ts',
    'sha: 8c24ef4a1b2c3d4e5f60718293a4b5c6d7e8f900',
    'date: 2026-08-29',
    'persona: TypeScript library author installing arbiter for the first time',
    'steps: 3',
    'findings:',
    `  blocker: ${counts.blocker}`,
    `  major: ${counts.major}`,
    `  minor: ${counts.minor}`,
    '---',
    '',
    '# Tabletop — greenfield-init-ts',
    '',
    HEADER,
    ...rows,
    '',
  ].join('\n')
}

const OWNED_MAJOR =
  '| 2 | docs/QUICKSTART.md:12 | init prints no next step | major | doc-drift | assert the next-step banner in the init smoke test | #2429 |'
const MINOR =
  '| 3 | README.md:40 | wizard label reads "level" not "governance level" | minor | ux | none — cosmetic | — |'

describe('check-tabletop-evidence (#2429)', () => {
  it('passes vacuously when the evidence directory does not exist', () => {
    const { dir, cleanup } = stage(null)
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.out).toMatch(/OK|SKIP/)
    } finally {
      cleanup()
    }
  })

  it('passes vacuously when the evidence directory is empty', () => {
    const { dir, cleanup } = stage({})
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('accepts a well-formed evidence file with owned findings', () => {
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([OWNED_MAJOR, MINOR]),
    })
    try {
      const r = run(dir)
      expect(r.out).toContain('OK')
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('accepts `fixed:<sha>` as an owner', () => {
    const fixed = OWNED_MAJOR.replace('| #2429 |', '| fixed:8c24ef4a |')
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': evidence([fixed, MINOR]) })
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails on a blocker finding with no owner', () => {
    const unowned = OWNED_MAJOR.replace('| major |', '| blocker |').replace('| #2429 |', '|  |')
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([unowned, MINOR], {
        blocker: 1,
        major: 0,
        minor: 1,
      }),
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('owner')
    } finally {
      cleanup()
    }
  })

  it('fails on a major finding whose owner cell is a bare em-dash', () => {
    const unowned = OWNED_MAJOR.replace('| #2429 |', '| — |')
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([unowned, MINOR]),
    })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails on frontmatter missing a schema-required key', () => {
    const bad = evidence([OWNED_MAJOR, MINOR]).replace(/^persona: .*\n/m, '')
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': bad })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('persona')
    } finally {
      cleanup()
    }
  })

  it('fails on a file with no frontmatter at all', () => {
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': `# nope\n\n${HEADER}\n` })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails when the findings table header does not carry the seven declared columns', () => {
    const body = evidence([OWNED_MAJOR, MINOR]).replace('| owner |', '|')
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': body })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails when the frontmatter counts disagree with the table rows', () => {
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([OWNED_MAJOR, MINOR], {
        blocker: 0,
        major: 3,
        minor: 1,
      }),
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('major')
    } finally {
      cleanup()
    }
  })

  it('finds the findings table past an unrelated seven-column table in the narrative', () => {
    const decoy = [
      '| a | b | c | d | e | f | g |',
      '| - | - | - | - | - | - | - |',
      '| 1 | 2 | 3 | 4 | 5 | 6 | 7 |',
      '',
    ].join('\n')
    const body = evidence([OWNED_MAJOR, MINOR]).replace(
      '# Tabletop — greenfield-init-ts\n',
      `# Tabletop — greenfield-init-ts\n\n${decoy}`,
    )
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': body })
    try {
      const r = run(dir)
      expect(r.out).toContain('OK')
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('accepts a clean tabletop: header, separator, and no findings rows', () => {
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([], { blocker: 0, major: 0, minor: 0 }),
    })
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails when the findings table has no separator row under its header', () => {
    const body = evidence([OWNED_MAJOR, MINOR]).replace(
      '| --- | --- | --- | --- | --- | --- | --- |\n',
      '',
    )
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': body })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('separator')
    } finally {
      cleanup()
    }
  })

  it('reports only the schema error when `findings` is a scalar, not three count mismatches', () => {
    const body = evidence([OWNED_MAJOR, MINOR]).replace(
      ['findings:', '  blocker: 0', '  major: 1', '  minor: 1'].join('\n'),
      'findings: 2',
    )
    const { dir, cleanup } = stage({ 'greenfield-init-ts-2026-08-29.md': body })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('findings: expected an object')
      expect(r.out).not.toContain('frontmatter says undefined')
    } finally {
      cleanup()
    }
  })

  it('fails on an unknown severity or class value', () => {
    const badClass = MINOR.replace('| ux |', '| vibes |')
    const { dir, cleanup } = stage({
      'greenfield-init-ts-2026-08-29.md': evidence([OWNED_MAJOR, badClass]),
    })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })
})
