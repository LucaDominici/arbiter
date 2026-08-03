// SPDX-License-Identifier: Apache-2.0
// T4 (gold-doc-tranches-t3-t5.md §2, gold-doc-capability H4) — per-doc freshness gate. Before
// this file (and scripts/check-doc-freshness.mjs) existed, nothing failed when a required doc's
// `last_review` was years old (check-doc-style.mjs only validates the ISO *format*, and
// check-monthly-freshness.mjs only checks a CI stamp, never a doc). RED before, GREEN after.
import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-doc-freshness.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(manifest: string, profile?: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'doc-freshness-test-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), manifest)
  if (profile) writeFileSync(join(dir, 'standards', 'doc-profile'), profile)
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000)
  return d.toISOString().slice(0, 10)
}

function frontmatter(lastReview: string | null, extra = ''): string {
  return [
    '---',
    "title: 'x'",
    "doc_version: '0.1.0'",
    'status: draft',
    ...(lastReview !== null ? [`last_review: '${lastReview}'`] : []),
    "owner: ''",
    "canonical_id: ''",
    'tags: []',
    'related: []',
    extra,
    '---',
    '',
    '# x',
    '',
  ].join('\n')
}

describe('check-doc-freshness (T4, #H4)', () => {
  it('--help exits 0', () => {
    const { dir, cleanup } = makeRepo('checks: []\n')
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('no manifest -> SKIP, exit 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doc-freshness-noskip-'))
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('SKIP')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('age bar: high-churn doc 200 days old is STALE; the same doc reclassified regulatory is fresh (bar isolation)', () => {
    const highChurn = `checks:
  - path: docs/arch.md
    tier: mandatory
    applies: always
    freshness_class: high-churn
`
    const { dir, cleanup } = makeRepo(highChurn)
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'arch.md'), frontmatter(daysAgo(200)))
      const r = run(dir, ['--json'])
      expect(r.status).toBe(1)
      const j = JSON.parse(r.stdout)
      const doc = j.docs.find((d: { path: string }) => d.path === 'docs/arch.md')
      expect(doc.verdict).toBe('stale')
      expect(doc.age_days).toBeGreaterThanOrEqual(200)
      expect(doc.bar).toBe(90)
    } finally {
      cleanup()
    }

    const regulatory = `checks:
  - path: docs/arch.md
    tier: mandatory
    applies: always
    freshness_class: regulatory
`
    const r2 = makeRepo(regulatory)
    try {
      mkdirSync(join(r2.dir, 'docs'), { recursive: true })
      writeFileSync(join(r2.dir, 'docs', 'arch.md'), frontmatter(daysAgo(200)))
      const r = run(r2.dir)
      expect(r.status).toBe(0) // 200d < 365d bar
    } finally {
      r2.cleanup()
    }
  })

  it('fail-closed: empty last_review on a required doc is STALE', () => {
    const manifest = `checks:
  - path: docs/x.md
    tier: mandatory
    applies: always
    freshness_class: policy
`
    const { dir, cleanup } = makeRepo(manifest)
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'x.md'), frontmatter(''))
      const r = run(dir, ['--json'])
      expect(r.status).toBe(1)
      const j = JSON.parse(r.stdout)
      expect(j.docs[0].verdict).toBe('stale')
      expect(j.docs[0].reason).toContain('last_review')
    } finally {
      cleanup()
    }
  })

  it('fail-closed: a required doc with NO frontmatter block at all is STALE', () => {
    const manifest = `checks:
  - path: docs/x.md
    tier: mandatory
    applies: always
    freshness_class: policy
`
    const { dir, cleanup } = makeRepo(manifest)
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'x.md'), '# x\n\nno frontmatter here.\n')
      const r = run(dir)
      expect(r.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('exemption: decision-class (ADR) is age-exempt regardless of last_review age', () => {
    const manifest = `checks:
  - path: docs/ADR
    tier: mandatory
    applies: always
    freshness_class: decision
    glob: 'docs/ADR/[0-9]*.md'
    adr: true
`
    const { dir, cleanup } = makeRepo(manifest)
    try {
      mkdirSync(join(dir, 'docs', 'ADR'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'ADR', '001-old.md'), frontmatter(daysAgo(3000)))
      const r = run(dir, ['--json'])
      expect(r.status).toBe(0)
      const j = JSON.parse(r.stdout)
      expect(j.docs[0].exempt).toBe('decision-immutable')
    } finally {
      cleanup()
    }
  })

  it('exemption: status: archived tombstone is never stale', () => {
    const manifest = `checks:
  - path: docs/old.md
    tier: recommended
    applies: always
    freshness_class: high-churn
`
    const { dir, cleanup } = makeRepo(manifest)
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'old.md'),
        [
          '---',
          "title: 'old'",
          "doc_version: '0.1.0'",
          'status: archived',
          `last_review: '${daysAgo(3000)}'`,
          "owner: ''",
          "canonical_id: ''",
          'tags: []',
          'related: []',
          '---',
          '',
          '# old',
          '',
        ].join('\n'),
      )
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exemption: a non-.md target (e.g. LICENSE) is never graded for frontmatter', () => {
    const manifest = `checks:
  - path: LICENSE
    tier: mandatory
    applies: always
`
    const { dir, cleanup } = makeRepo(manifest)
    try {
      writeFileSync(join(dir, 'LICENSE'), 'Apache-2.0\n')
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exemption: CHANGELOG.md is changesets-managed, never graded for frontmatter', () => {
    const manifest = `checks:
  - path: CHANGELOG.md
    tier: mandatory
    applies: always
`
    const { dir, cleanup } = makeRepo(manifest)
    try {
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\nNo frontmatter here.\n')
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it("a check with no applicable/present file is simply not graded (presence is check-doc-set.mjs's job)", () => {
    const manifest = `checks:
  - path: docs/never-written.md
    tier: mandatory
    applies: always
    freshness_class: policy
`
    const { dir, cleanup } = makeRepo(manifest)
    try {
      const r = run(dir, ['--json'])
      expect(r.status).toBe(0)
      const j = JSON.parse(r.stdout)
      expect(j.docs).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('right-sizing: a `skip` tiers{} cell is never graded (inherits from the engine, not re-derived)', () => {
    const manifest = `checks:
  - path: docs/enterprise-only.md
    tiers: { solo: 'o', small: 'r', enterprise: 'R' }
    applies: always
    freshness_class: policy
`
    const { dir, cleanup } = makeRepo(manifest)
    try {
      // No arbiter.json -> default collaborationMode peer-review -> column 'small' -> cell 'r'
      // (recommended, graded) rather than solo's 'o' (skip, ungraded) — write nothing and confirm
      // it's graded (small column), then re-run forcing solo via arbiter.json and confirm skip.
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'trunk-solo' }))
      const r = run(dir, ['--json'])
      const j = JSON.parse(r.stdout)
      expect(j.tierColumn).toBe('solo')
      expect(j.docs).toEqual([]) // 'o' cell -> skip -> never graded, even though the file is absent
    } finally {
      cleanup()
    }
  })

  it('T1b interlock: a `tier_floor` in doc-profile is honored the SAME way presence honors it — never disagreeing', () => {
    const manifest = `checks:
  - path: docs/enterprise-only.md
    tiers: { solo: 'o', small: 'r', enterprise: 'R' }
    applies: always
    freshness_class: policy
`
    const { dir, cleanup } = makeRepo(manifest, 'overlays: []\ntier_floor: enterprise\n')
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'trunk-solo' }))
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'enterprise-only.md'), frontmatter(''))
      const r = run(dir, ['--json'])
      const j = JSON.parse(r.stdout)
      // Without the floor this row is 'o' (skip) at solo and never graded (see the test above);
      // WITH the floor the effective column is enterprise ('R'), so it IS graded, and fails
      // closed on the empty last_review.
      expect(j.tierColumn).toBe('enterprise')
      expect(j.docs).toHaveLength(1)
      expect(j.docs[0].verdict).toBe('stale')
      expect(r.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  describe('change-coupling (strongest signal)', () => {
    function initGitRepo(dir: string): void {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], {
        cwd: dir,
        stdio: 'ignore',
      })
      execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir, stdio: 'ignore' })
    }

    function commitAll(dir: string, message: string, isoDate: string): void {
      execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['commit', '-m', message], {
        cwd: dir,
        stdio: 'ignore',
        env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
      })
    }

    it('a commit touching `couples_to` AFTER last_review makes the doc STALE (coupling overrides a fresh age)', () => {
      const manifest = `checks:
  - path: docs/design.md
    tier: mandatory
    applies: always
    freshness_class: regulatory
    couples_to: ['src/x.ts']
`
      const { dir, cleanup } = makeRepo(manifest)
      try {
        initGitRepo(dir)
        mkdirSync(join(dir, 'docs'), { recursive: true })
        mkdirSync(join(dir, 'src'), { recursive: true })
        writeFileSync(join(dir, 'docs', 'design.md'), frontmatter(daysAgo(10))) // well within the 365d bar
        writeFileSync(join(dir, 'src', 'x.ts'), 'export const x = 1\n')
        commitAll(dir, 'initial', '2020-01-01T00:00:00Z')
        // Now change the coupled file AFTER the doc's last_review.
        writeFileSync(join(dir, 'src', 'x.ts'), 'export const x = 2\n')
        commitAll(dir, 'change x', new Date().toISOString())

        const r = run(dir, ['--json'])
        expect(r.status).toBe(1)
        const j = JSON.parse(r.stdout)
        expect(j.docs[0].coupling).toBe('stale')
        expect(j.docs[0].verdict).toBe('stale')
      } finally {
        cleanup()
      }
    })

    it('re-dating last_review PAST the coupled commit clears the staleness', () => {
      const manifest = `checks:
  - path: docs/design.md
    tier: mandatory
    applies: always
    freshness_class: regulatory
    couples_to: ['src/x.ts']
`
      const { dir, cleanup } = makeRepo(manifest)
      try {
        initGitRepo(dir)
        mkdirSync(join(dir, 'docs'), { recursive: true })
        mkdirSync(join(dir, 'src'), { recursive: true })
        writeFileSync(join(dir, 'src', 'x.ts'), 'export const x = 1\n')
        writeFileSync(join(dir, 'docs', 'design.md'), frontmatter(daysAgo(1)))
        commitAll(dir, 'initial', new Date(Date.now() - 5 * 86_400_000).toISOString())
        writeFileSync(join(dir, 'src', 'x.ts'), 'export const x = 2\n')
        commitAll(dir, 'change x', new Date(Date.now() - 3 * 86_400_000).toISOString())
        // Review the doc TODAY, after the coupled commit.
        writeFileSync(join(dir, 'docs', 'design.md'), frontmatter(daysAgo(0)))

        const r = run(dir, ['--json'])
        expect(r.status).toBe(0)
        const j = JSON.parse(r.stdout)
        expect(j.docs[0].coupling).toBe('fresh')
      } finally {
        cleanup()
      }
    })

    it('a non-git directory skips the coupling signal (age bar still enforced)', () => {
      const manifest = `checks:
  - path: docs/design.md
    tier: mandatory
    applies: always
    freshness_class: regulatory
    couples_to: ['src/x.ts']
`
      const { dir, cleanup } = makeRepo(manifest)
      try {
        mkdirSync(join(dir, 'docs'), { recursive: true })
        writeFileSync(join(dir, 'docs', 'design.md'), frontmatter(daysAgo(10)))
        const r = run(dir, ['--json'])
        expect(r.status).toBe(0)
        const j = JSON.parse(r.stdout)
        expect(j.docs[0].coupling).toBe('skipped')
      } finally {
        cleanup()
      }
    })

    it('a shallow clone skips the coupling signal too (a depth-1 `git log -- path` lies)', () => {
      const manifest = `checks:
  - path: docs/design.md
    tier: mandatory
    applies: always
    freshness_class: regulatory
    couples_to: ['src/x.ts']
`
      const origin = makeRepo(manifest)
      let shallowDir: string | null = null
      try {
        initGitRepo(origin.dir)
        mkdirSync(join(origin.dir, 'docs'), { recursive: true })
        mkdirSync(join(origin.dir, 'src'), { recursive: true })
        writeFileSync(join(origin.dir, 'src', 'x.ts'), 'export const x = 1\n')
        writeFileSync(join(origin.dir, 'docs', 'design.md'), frontmatter(daysAgo(10)))
        commitAll(origin.dir, 'c1', '2020-01-01T00:00:00Z')
        writeFileSync(join(origin.dir, 'src', 'x.ts'), 'export const x = 2\n')
        commitAll(origin.dir, 'c2 touch x', new Date().toISOString())

        shallowDir = mkdtempSync(join(tmpdir(), 'doc-freshness-shallow-'))
        // `--depth` is silently ignored for a plain local-path source ("use file:// instead" —
        // verified live); the file:// form is what actually produces a shallow clone.
        execFileSync('git', ['clone', '--depth', '1', `file://${origin.dir}`, shallowDir], {
          stdio: 'ignore',
        })

        const r = run(shallowDir, ['--json'])
        const j = JSON.parse(r.stdout)
        expect(j.docs[0].coupling).toBe('skipped')
      } finally {
        origin.cleanup()
        if (shallowDir) rmSync(shallowDir, { recursive: true, force: true })
      }
    })
  })

  it('a manifest-level `freshness_bars` override changes the bar for a class', () => {
    const manifest = `freshness_bars:
  policy: 30
checks:
  - path: docs/x.md
    tier: mandatory
    applies: always
    freshness_class: policy
`
    const { dir, cleanup } = makeRepo(manifest)
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'x.md'), frontmatter(daysAgo(60)))
      const r = run(dir, ['--json'])
      const j = JSON.parse(r.stdout)
      expect(j.docs[0].bar).toBe(30)
      expect(j.docs[0].verdict).toBe('stale')
    } finally {
      cleanup()
    }
  })

  it('is deterministic — identical output for identical inputs', () => {
    const manifest = `checks:
  - path: docs/x.md
    tier: mandatory
    applies: always
    freshness_class: policy
`
    const { dir, cleanup } = makeRepo(manifest)
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'x.md'), frontmatter(daysAgo(5)))
      const a = run(dir, ['--json']).stdout
      const b = run(dir, ['--json']).stdout
      expect(a).toBe(b)
    } finally {
      cleanup()
    }
  })
})
