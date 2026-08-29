import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-doc-links.mjs')

function run(dir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd: dir,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'doc-links-test-'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeCanonicalPaths(dir: string, content: string): void {
  mkdirSync(join(dir, 'docs', 'internal', 'METHOD'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'internal', 'METHOD', 'CANONICAL_PATHS.md'), content)
}

describe('check-doc-links (#255)', () => {
  it('exits 0 when no docs found', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when all local links resolve', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'docs', 'TARGET.md'), '# Target\n')
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [target](TARGET.md) for details.\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a local link is broken and no redirect exists', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [missing](MISSING.md) for details.\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('MISSING.md')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a broken link has a CANONICAL_PATHS redirect to an existing file (AC#5)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'docs', 'new'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'new', 'FILE.md'), '# Moved here\n')
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n| `docs/OLD.md` | `docs/new/FILE.md` |\n',
      )
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [old doc](OLD.md).\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a CANONICAL_PATHS redirect target also does not exist', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n| `docs/OLD.md` | `docs/ALSO_MISSING.md` |\n',
      )
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [old doc](OLD.md).\n')
      const result = run(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('ignores http/https links', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'docs', 'SOURCE.md'),
        'See [external](https://example.com/docs) for details.\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores anchor-only links', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [section](#installation).\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('reports the source file and broken link in output', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [missing](MISSING.md).\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('SOURCE.md')
    } finally {
      cleanup()
    }
  })

  it('respects .docs-links-ignore allowlist', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, '.docs-links-ignore'), 'docs/INTENTIONAL_BROKEN.md\n')
      writeFileSync(
        join(dir, 'docs', 'SOURCE.md'),
        'See [intentionally broken](INTENTIONAL_BROKEN.md).\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── website/ coverage (F2 #1838, item 3) ─────────────────────────────────────
// website/ was excluded entirely before this wave: VitePress route paths like
// `/comparisons/spec-kit` aren't relative filesystem paths, so naive file-
// existence resolution produced false positives. 3 dead links in
// website/governance/index.md passed silently until a human caught them by
// hand (F1, #1837) — these tests prove the gate now catches that class of
// drift on its own, with a synthetic dead link in website/ (as instructed),
// while still resolving VitePress's own route conventions correctly.

function makeWebsiteDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'doc-links-website-test-'))
  mkdirSync(join(dir, 'website'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-doc-links — website/ coverage (#1838 item 3)', () => {
  it('exits 1 for a synthetic dead link in website/ (regression: #1837 dead-link class)', () => {
    const { dir, cleanup } = makeWebsiteDir()
    try {
      writeFileSync(
        join(dir, 'website', 'index.md'),
        'See [synthetic dead link](/this-route-does-not-exist) for details.\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('this-route-does-not-exist')
    } finally {
      cleanup()
    }
  })

  it('resolves a `/`-absolute VitePress route to <route>/index.md when it ends in "/"', () => {
    const { dir, cleanup } = makeWebsiteDir()
    try {
      mkdirSync(join(dir, 'website', 'concepts'), { recursive: true })
      writeFileSync(join(dir, 'website', 'concepts', 'index.md'), '# Concepts\n')
      writeFileSync(join(dir, 'website', 'index.md'), 'See [concepts](/concepts/) for details.\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('resolves a `/`-absolute VitePress route to <route>.md when it has no trailing slash', () => {
    const { dir, cleanup } = makeWebsiteDir()
    try {
      mkdirSync(join(dir, 'website', 'reference'), { recursive: true })
      writeFileSync(join(dir, 'website', 'reference', 'cli.md'), '# CLI\n')
      writeFileSync(join(dir, 'website', 'index.md'), 'See [cli](/reference/cli) for details.\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('resolves a bare relative sibling link with no extension (VitePress cleanUrls convention)', () => {
    const { dir, cleanup } = makeWebsiteDir()
    try {
      mkdirSync(join(dir, 'website', 'recipes'), { recursive: true })
      writeFileSync(join(dir, 'website', 'recipes', 'plugin.md'), '# Plugin recipe\n')
      writeFileSync(
        join(dir, 'website', 'recipes', 'index.md'),
        'See [plugin](plugin) for details.\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('resolves a `/`-absolute route to a website/public/ asset', () => {
    const { dir, cleanup } = makeWebsiteDir()
    try {
      mkdirSync(join(dir, 'website', 'public'), { recursive: true })
      writeFileSync(join(dir, 'website', 'public', 'logo.svg'), '<svg/>')
      writeFileSync(join(dir, 'website', 'index.md'), 'See [logo](/logo.svg) for details.\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('does NOT apply VitePress extension-guessing outside website/ (no regression on docs/)', () => {
    const { dir, cleanup } = makeDir()
    try {
      // A bare extensionless relative link in docs/ is not a VitePress page —
      // it must still resolve as a literal filename, i.e. stay broken.
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'TARGET.md'), '# Target\n')
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [target](TARGET) for details.\n')
      const result = run(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })
})

// ─── self-referential GitHub blob/tree links (F2 #1838, item 3) ──────────────
// A https://github.com/<owner>/<repo>/(blob|tree)/<ref>/<path> URL is a local
// link wearing a remote costume — isLocal() skips it as http(s), so a repo
// path move can leave it dangling with no gate ever looking at it. This is
// exactly the live bug this wave found in website/.vitepress/config.ts (ADR
// Ledger / Decisions nav links still pointed at the pre-#1770 docs/ADR and
// docs/SYSTEM/DECISIONS.md paths) — fixed in this PR, guarded here.

describe('check-doc-links — self-referential GitHub blob/tree links', () => {
  it('exits 1 for a synthetic dead self-link inside website/.vitepress/config.ts', () => {
    const { dir, cleanup } = makeWebsiteDir()
    try {
      mkdirSync(join(dir, 'website', '.vitepress'), { recursive: true })
      writeFileSync(
        join(dir, 'website', '.vitepress', 'config.ts'),
        "export default { link: 'https://github.com/LucaDominici/arbiter/tree/main/docs/DOES-NOT-EXIST' }\n",
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('docs/DOES-NOT-EXIST')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the self-link target exists (regression guard for the #1770 path-move fix)', () => {
    const { dir, cleanup } = makeWebsiteDir()
    try {
      mkdirSync(join(dir, 'docs', 'internal', 'ADR'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'internal', 'ADR', '001-example.md'), '# ADR 1\n')
      mkdirSync(join(dir, 'website', '.vitepress'), { recursive: true })
      writeFileSync(
        join(dir, 'website', '.vitepress', 'config.ts'),
        "export default { link: 'https://github.com/LucaDominici/arbiter/blob/main/docs/internal/ADR/001-example.md' }\n",
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('follows a CANONICAL_PATHS redirect for a self-link target that moved', () => {
    const { dir, cleanup } = makeWebsiteDir()
    try {
      mkdirSync(join(dir, 'docs', 'new'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'new', 'DECISIONS.md'), '# Decisions\n')
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n| `docs/OLD_DECISIONS.md` | `docs/new/DECISIONS.md` |\n',
      )
      mkdirSync(join(dir, 'website', '.vitepress'), { recursive: true })
      writeFileSync(
        join(dir, 'website', '.vitepress', 'config.ts'),
        "export default { link: 'https://github.com/LucaDominici/arbiter/blob/main/docs/OLD_DECISIONS.md' }\n",
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── #2408: docs/internal/** coverage + frontmatter `related:` validation ─────
// `internal` sat in SKIP_PATH_SEGMENTS, so nothing verified links under the SSOT
// backbone; and no gate ever looked at frontmatter `related:` paths, which is
// where the M-A audit found dead `docs/ADR/**` entries left over from the
// docs/internal/ split.

function runWithArgs(dir: string, args: string[]): { status: number; stdout: string } {
  const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: result.status ?? 1, stdout: result.stdout ?? '' }
}

function fm(related: string): string {
  return `---\ntitle: 'X'\ndoc_version: '1.0.0'\nstatus: active\nlast_review: '2026-08-29'\nowner: ''\ncanonical_id: ''\ntags: []\nrelated: ${related}\n---\n\n# X\n`
}

describe('check-doc-links — docs/internal/** coverage (#2408)', () => {
  it('exits 1 for a broken link under docs/internal/ (internal no longer skipped)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'docs', 'internal', 'METHOD'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'internal', 'METHOD', 'SOURCE.md'),
        'See [missing](MISSING.md) for details.\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('MISSING.md')
    } finally {
      cleanup()
    }
  })
})

describe('check-doc-links — frontmatter related: validation (#2408)', () => {
  it('exits 1 when a related: entry names a path that does not exist', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'docs', 'internal', 'ADR'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'internal', 'ADR', '050-x.md'), fm("['docs/SYSTEM/GONE.md']"))
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('docs/SYSTEM/GONE.md')
    } finally {
      cleanup()
    }
  })

  it('accepts repo-root, doc-relative and docs/-relative related: shapes', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'internal', 'PRODUCT', 'TARGET.md'), '# T\n')
      writeFileSync(join(dir, 'docs', 'PUBLIC.md'), '# P\n')
      writeFileSync(
        join(dir, 'docs', 'internal', 'PRODUCT', 'SOURCE.md'),
        fm("['docs/internal/PRODUCT/TARGET.md', 'TARGET.md', 'PUBLIC.md', 'PRODUCT/TARGET.md']"),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores non-path related: entries (bare ADR slugs, skill names)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), fm("['088-ship-as-entrypoint', 'tdd', '053']"))
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

describe('check-doc-links — dated allowlist (#2408)', () => {
  function writeAllowlist(dir: string, entries: unknown[]): string {
    const path = join(dir, 'allowlist.json')
    writeFileSync(path, JSON.stringify({ $schemaVersion: 1, description: 'test', entries }))
    return path
  }

  it('suppresses a listed file and reports the allowlisted count', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'docs', 'internal'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'internal', 'SOURCE.md'), 'See [missing](MISSING.md).\n')
      const allowlist = writeAllowlist(dir, [
        {
          path: 'docs/internal/SOURCE.md',
          rule: 'doc-links',
          reason: 'target is a decision owned by a sibling batch issue',
          issue: '#2411',
          expires: '2099-01-01',
        },
      ])
      const result = runWithArgs(dir, [`--allowlist=${allowlist}`])
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/1 file\(s\) allowlisted/)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an allowlist entry has expired', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'docs', 'OK.md'), '# ok\n')
      const allowlist = writeAllowlist(dir, [
        {
          path: 'docs/internal/SOURCE.md',
          rule: 'doc-links',
          reason: 'target is a decision owned by a sibling batch issue',
          issue: '#2411',
          expires: '2020-01-01',
        },
      ])
      const result = runWithArgs(dir, [`--allowlist=${allowlist}`])
      expect(result.status).toBe(1)
      expect(result.stdout).toMatch(/expired/)
    } finally {
      cleanup()
    }
  })
})
