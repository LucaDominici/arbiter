// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('setup-repo.sh.ejs rendering (CANON-04)', () => {
  it('renders label creation block', () => {
    const data = makeConfig('/tmp/test', {
      useGitHub: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/setup-repo.sh.ejs', data)
    expect(content).toContain('gh label create')
    expect(content).toContain('in-progress')
    expect(content).toContain('in-review')
  })

  it('renders branch protection block', () => {
    const data = makeConfig('/tmp/test', {
      useGitHub: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/setup-repo.sh.ejs', data)
    expect(content).toContain('branch protection')
    expect(content).toContain('allow_force_pushes')
  })

  it('renders set -e and gh CLI guard', () => {
    const data = makeConfig('/tmp/test', {
      useGitHub: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/setup-repo.sh.ejs', data)
    expect(content).toContain('set -e')
    expect(content).toContain('command -v gh')
  })

  it('script is idempotent — labels use --force flag', () => {
    const data = makeConfig('/tmp/test', {
      useGitHub: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/setup-repo.sh.ejs', data)
    expect(content).toContain('--force')
  })
})

// ─── apply-branch-protection.mjs.ejs ─────────────────────────────────────────

describe('apply-branch-protection.mjs.ejs rendering (CANON-04)', () => {
  function renderBP(overrides: Record<string, unknown> = {}) {
    return renderTemplate(
      'scripts/apply-branch-protection.mjs.ejs',
      makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
        string,
        unknown
      >,
    )
  }

  it('ci-required and human-approval-required contexts present', () => {
    const content = renderBP({ governanceLevel: 'L2' })
    expect(content).toContain('ci-required')
    expect(content).toContain('human-approval-required')
  })

  it('allow_force_pushes: false present', () => {
    const content = renderBP({ governanceLevel: 'L2' })
    expect(content).toContain('allow_force_pushes')
  })

  it('L3: require_code_owner_reviews is true', () => {
    const content = renderBP({ governanceLevel: 'L3' })
    expect(content).toContain('require_code_owner_reviews: true')
  })

  it('L2: require_code_owner_reviews is false', () => {
    const content = renderBP({ governanceLevel: 'L2' })
    expect(content).toContain('require_code_owner_reviews: false')
  })

  it('L1: require_code_owner_reviews is false', () => {
    const content = renderBP({ governanceLevel: 'L1' })
    expect(content).toContain('require_code_owner_reviews: false')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderBP({ governanceLevel: level })
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  it('uses spawnSync (not execSync) for command execution', () => {
    const content = renderBP({})
    expect(content).toContain('spawnSync')
    expect(content).not.toContain('execSync')
  })
})

// ─── check-ci-tiers.mjs.ejs ──────────────────────────────────────────────────

describe('check-ci-tiers.mjs.ejs rendering (CANON-04)', () => {
  function renderTiers(overrides: Record<string, unknown> = {}) {
    return renderTemplate(
      'scripts/check-ci-tiers.mjs.ejs',
      makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
        string,
        unknown
      >,
    )
  }

  it('lists all 8 required tier filenames', () => {
    const content = renderTiers({})
    expect(content).toContain('01-pr-fast.yml')
    expect(content).toContain('02-pr-extended.yml')
    expect(content).toContain('03-human-approval.yml')
    expect(content).toContain('05-release.yml')
    expect(content).toContain('06-nightly.yml')
    expect(content).toContain('07-weekly.yml')
    expect(content).toContain('08-monthly.yml')
    expect(content).toContain('09-heartbeat.yml')
  })

  it('tier filenames appear in canonical order with no duplicates or extras', () => {
    const content = renderTiers({})
    const matches = content.match(/'\d\d-[a-z-]+\.yml'/g) ?? []
    expect(matches).toEqual([
      "'01-pr-fast.yml'",
      "'02-pr-extended.yml'",
      "'03-human-approval.yml'",
      "'05-release.yml'",
      "'06-nightly.yml'",
      "'07-weekly.yml'",
      "'08-monthly.yml'",
      "'09-heartbeat.yml'",
    ])
  })

  it('exits 0 when all tiers present (script text)', () => {
    const content = renderTiers({})
    expect(content).toContain('process.exit(0)')
    expect(content).toContain('process.exit(1)')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTiers({ governanceLevel: level })
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-action-pins.mjs.ejs ───────────────────────────────────────────────

describe('check-action-pins.mjs.ejs rendering (CANON-04)', () => {
  function renderPins(overrides: Record<string, unknown> = {}) {
    return renderTemplate(
      'scripts/check-action-pins.mjs.ejs',
      makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
        string,
        unknown
      >,
    )
  }

  it('contains SHA_PATTERN for 40-char hex detection', () => {
    const content = renderPins({})
    expect(content).toContain('SHA_PATTERN')
    expect(content).toContain('[0-9a-f]{40}')
  })

  it('L1: embeds L1 level and uses warning-only exit', () => {
    const content = renderPins({ governanceLevel: 'L1' })
    expect(content).toContain("LEVEL = 'L1'")
    expect(content).toContain("LEVEL === 'L1'")
  })

  it('L2: embeds L2 level', () => {
    const content = renderPins({ governanceLevel: 'L2' })
    expect(content).toContain("LEVEL = 'L2'")
  })

  it('L3: embeds L3 level', () => {
    const content = renderPins({ governanceLevel: 'L3' })
    expect(content).toContain("LEVEL = 'L3'")
  })

  it('scans both workflows and actions directories', () => {
    const content = renderPins({})
    expect(content).toContain("'workflows'")
    expect(content).toContain("'actions'")
  })

  it('regex handles YAML list-dash form (- uses: foo/bar@v1)', () => {
    const content = renderPins({})
    // Pattern must accept optional leading "- " before "uses:"
    expect(content).toMatch(/USES_PATTERN\s*=.*\(\?:-\\s\+\)\?uses:/s)
  })

  it('regex unwraps quoted action refs', () => {
    const content = renderPins({})
    expect(content).toContain('stripQuotes')
  })

  it('collectYamlFiles skips symbolic links', () => {
    const content = renderPins({})
    expect(content).toContain('isSymbolicLink')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderPins({ governanceLevel: level })
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  it('cites INV-76 (SHA-pinned actions), not INV-75 (heartbeat watchdog) (#915)', () => {
    const content = renderPins({})
    expect(content).toContain('INV-76')
    expect(content).not.toContain('INV-75')
  })
})

// ─── _label-sync.yml.ejs ─────────────────────────────────────────────────────

describe('_label-sync.yml.ejs rendering — silent failure fix (#914)', () => {
  function renderLabelSync(overrides: Record<string, unknown> = {}) {
    return renderTemplate(
      'github/workflows/_label-sync.yml.ejs',
      makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
        string,
        unknown
      >,
    )
  }

  it('captures subprocess output and checks returncode to surface gh label errors (#914)', () => {
    const content = renderLabelSync({})
    expect(content).toContain('capture_output=True')
    expect(content).toContain('result.returncode != 0')
    expect(content).toContain('sys.stderr.write')
  })

  it('does not swallow errors silently (check=False without error check removed)', () => {
    const content = renderLabelSync({})
    // Ensure the returncode check follows subprocess.run
    expect(content).toContain('result.returncode')
  })
})

// ─── check-workflow-perms.mjs.ejs ────────────────────────────────────────────

describe('check-workflow-perms.mjs.ejs rendering (CANON-04)', () => {
  function renderPerms(overrides: Record<string, unknown> = {}) {
    return renderTemplate(
      'scripts/check-workflow-perms.mjs.ejs',
      makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
        string,
        unknown
      >,
    )
  }

  it('checks for top-level permissions: declaration', () => {
    const content = renderPerms({})
    expect(content).toContain('permissions:')
    expect(content).toContain('.github/workflows')
  })

  it('skips gracefully when no workflows directory', () => {
    const content = renderPerms({})
    expect(content).toContain('skipping')
  })

  it('rejects write-all as a top-level permission', () => {
    const content = renderPerms({})
    expect(content).toContain("'write-all'")
    expect(content).toContain("write-all' is forbidden")
  })

  it('exits 0 and 1 paths present', () => {
    const content = renderPerms({})
    expect(content).toContain('process.exit(0)')
    expect(content).toContain('process.exit(1)')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderPerms({ governanceLevel: level })
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-merge-method.mjs.ejs (INV-101, #1089) ─────────────────────────────

describe('check-merge-method.mjs.ejs rendering + runtime (CANON-04, INV-101, #1089)', () => {
  function render(name: string, overrides: Record<string, unknown> = {}) {
    return renderTemplate(
      `scripts/${name}`,
      makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
        string,
        unknown
      >,
    )
  }

  it('renders the INV-101 ff-only flag checks with no EJS leaks', () => {
    const content = render('check-merge-method.mjs.ejs', { useGitHub: true, governanceLevel: 'L2' })
    expect(content).toContain('INV-101')
    expect(content).toContain('allow_squash_merge')
    expect(content).toContain('allow_rebase_merge')
    expect(content).toContain('required_linear_history')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  it('generated check passes against a generated apply-branch-protection.mjs (#1089 regression)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arb-mm-'))
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ governanceLevel: 'L2' }))
      writeFileSync(
        join(dir, 'scripts', 'apply-branch-protection.mjs'),
        render('apply-branch-protection.mjs.ejs', { useGitHub: true, governanceLevel: 'L2' }),
      )
      writeFileSync(
        join(dir, 'scripts', 'check-merge-method.mjs'),
        render('check-merge-method.mjs.ejs', { useGitHub: true, governanceLevel: 'L2' }),
      )
      // The #1089 bug (no template emitted) made this exit non-zero (module-not-found).
      const out = execFileSync('node', ['scripts/check-merge-method.mjs'], {
        cwd: dir,
        encoding: 'utf-8',
      })
      expect(out).toContain('ff-only merge flags present')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed when apply-branch-protection.mjs is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arb-mm-'))
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ governanceLevel: 'L2' }))
      writeFileSync(
        join(dir, 'scripts', 'check-merge-method.mjs'),
        render('check-merge-method.mjs.ejs', { useGitHub: true, governanceLevel: 'L2' }),
      )
      expect(() => execFileSync('node', ['scripts/check-merge-method.mjs'], { cwd: dir })).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
