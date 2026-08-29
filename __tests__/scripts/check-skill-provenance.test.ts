// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  normalizeLine,
  hashLine,
  lineHashSet,
  overlapCount,
  evaluatePairs,
  MIN_LINE_LENGTH,
  OVERLAP_THRESHOLD,
} from '../../scripts/check-skill-provenance.mjs'

const SCRIPT = resolve('scripts/check-skill-provenance.mjs')
const dirs: string[] = []

function tmpRoot(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop() as string
    rmSync(dir, { recursive: true, force: true })
  }
})

function run(args: string[]) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const SUBSTANTIVE = 'this line is long enough to count as a substantive line of prose'
const SHORT = 'too short'

describe('normalizeLine / hashLine / lineHashSet (pure logic)', () => {
  it('drops lines shorter than MIN_LINE_LENGTH', () => {
    expect(SHORT.length).toBeLessThan(MIN_LINE_LENGTH)
    expect(normalizeLine(SHORT)).toBeNull()
  })

  it('keeps and lowercases substantive lines', () => {
    expect(normalizeLine(`  ${SUBSTANTIVE.toUpperCase()}  `)).toBe(SUBSTANTIVE)
  })

  it('hashLine is deterministic sha256 hex, never returns the source text', () => {
    const h1 = hashLine(SUBSTANTIVE)
    const h2 = hashLine(SUBSTANTIVE)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).not.toContain(SUBSTANTIVE)
  })

  it('lineHashSet ignores short lines and blank lines', () => {
    const set = lineHashSet(`${SHORT}\n\n${SUBSTANTIVE}\n`)
    expect(set.size).toBe(1)
    expect(set.has(hashLine(SUBSTANTIVE))).toBe(true)
  })
})

describe('overlapCount / evaluatePairs', () => {
  it('counts only hashes common to both sets', () => {
    const a = new Set(['x', 'y', 'z'])
    const b = new Set(['y', 'z', 'w'])
    expect(overlapCount(a, b)).toBe(2)
  })

  it('evaluatePairs emits one entry per (file, companion) pair with overlap > 0', () => {
    const a = hashLine('line one is definitely long enough to be substantive')
    const b = hashLine('line two is also definitely long enough to be substantive')
    const localHashSets = new Map([
      ['.claude/skills/example/SKILL.md', new Set([a, b])],
      ['.claude/commands/other.md', new Set(['unrelated-hash'])],
    ])
    const companionHashLists = { 'superpowers:probe': [a, b] }
    const pairs = evaluatePairs(localHashSets, companionHashLists)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({
      file: '.claude/skills/example/SKILL.md',
      companionId: 'superpowers:probe',
      count: 2,
    })
  })
})

describe('CLI gate mode', () => {
  it('passes clean fixture: local skill overlaps a companion by 0 lines', () => {
    const root = tmpRoot('provenance-clean-')
    mkdirSync(join(root, '.claude/skills/example'), { recursive: true })
    writeFileSync(
      join(root, '.claude/skills/example/SKILL.md'),
      '---\nname: example\n---\n\nAn entirely original arbiter-authored sentence about testing.\n',
    )
    const hashesPath = join(root, 'hashes.json')
    writeFileSync(
      hashesPath,
      JSON.stringify({
        $schemaVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        companions: {
          'superpowers:probe': [hashLine('a totally unrelated companion sentence of prose')],
        },
      }),
    )
    const result = run(['--root', root, '--hashes', hashesPath])
    expect(result.status).toBe(0)
  })

  it('fails a fixture that shares >= OVERLAP_THRESHOLD hashed lines with one companion skill', () => {
    const root = tmpRoot('provenance-dirty-')
    mkdirSync(join(root, '.claude/skills/example'), { recursive: true })
    const sharedLines = Array.from(
      { length: OVERLAP_THRESHOLD },
      (_, i) => `this is shared substantive companion line number ${i} padded to length`,
    )
    writeFileSync(
      join(root, '.claude/skills/example/SKILL.md'),
      `---\nname: example\n---\n\n${sharedLines.join('\n')}\n`,
    )
    const hashesPath = join(root, 'hashes.json')
    writeFileSync(
      hashesPath,
      JSON.stringify({
        $schemaVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        companions: { 'superpowers:probe': sharedLines.map(hashLine) },
      }),
    )
    const result = run(['--root', root, '--hashes', hashesPath])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('superpowers:probe')
    expect(result.stderr).toMatch(new RegExp(`${OVERLAP_THRESHOLD}`))
  })

  it('excludes __tests__/fixtures/skill-trees stubs from the local corpus', () => {
    const root = tmpRoot('provenance-fixtures-')
    mkdirSync(join(root, '__tests__/fixtures/skill-trees/with-superpowers/.claude/skills/tdd'), {
      recursive: true,
    })
    const sharedLines = Array.from(
      { length: OVERLAP_THRESHOLD },
      (_, i) => `this is shared substantive companion line number ${i} padded to length`,
    )
    writeFileSync(
      join(root, '__tests__/fixtures/skill-trees/with-superpowers/.claude/skills/tdd/SKILL.md'),
      sharedLines.join('\n'),
    )
    // A real, in-scope file with wholly original prose — proves the stub was excluded (not just
    // that the scan matched zero files, which would pass vacuously for the wrong reason).
    mkdirSync(join(root, '.claude/skills/example'), { recursive: true })
    writeFileSync(
      join(root, '.claude/skills/example/SKILL.md'),
      'An entirely original arbiter-authored sentence unrelated to the companion fixture.\n',
    )
    const hashesPath = join(root, 'hashes.json')
    writeFileSync(
      hashesPath,
      JSON.stringify({
        $schemaVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        companions: { 'superpowers:probe': sharedLines.map(hashLine) },
      }),
    )
    const result = run(['--root', root, '--hashes', hashesPath])
    expect(result.status).toBe(0)
  })

  it('exits 2 (never a silent pass) when the committed hash file is missing', () => {
    const root = tmpRoot('provenance-missing-hashes-')
    mkdirSync(join(root, '.claude/skills/example'), { recursive: true })
    writeFileSync(join(root, '.claude/skills/example/SKILL.md'), 'irrelevant content\n')
    const result = run(['--root', root, '--hashes', join(root, 'does-not-exist.json')])
    expect(result.status).toBe(2)
  })
})

describe('CLI refresh mode (--refresh-hashes) fails closed offline', () => {
  it('exits non-zero and writes nothing when gh is unavailable, never a partial hash file', () => {
    const root = tmpRoot('provenance-refresh-offline-')
    const sourcesPath = join(root, 'sources.json')
    writeFileSync(
      sourcesPath,
      JSON.stringify({
        $schemaVersion: 1,
        sources: [
          {
            companion: 'superpowers',
            skillId: 'probe',
            repo: 'obra/superpowers',
            path: 'skills/probe/SKILL.md',
            license: 'MIT',
          },
        ],
      }),
    )
    const hashesPath = join(root, 'hashes.json')
    const result = run([
      '--refresh-hashes',
      '--sources',
      sourcesPath,
      '--hashes',
      hashesPath,
      '--gh-bin',
      resolve(root, 'no-such-gh-binary'),
    ])
    expect(result.status).not.toBe(0)
    expect(() => readFileSync(hashesPath, 'utf-8')).toThrow()
  })
})

describe('--self-test', () => {
  it('exits 0', () => {
    const result = run(['--self-test'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('self-test OK')
  })
})
