// SPDX-License-Identifier: Apache-2.0
// Exercises scripts/check-commit-footer-rationale.mjs (INV-119).
//
// The range-scan tests are HERMETIC (#1679): each builds a throwaway git repo
// (mktemp + git init + controlled commits) and drives the gate against THAT range
// via --range. They never read the live repo's origin/main..HEAD, so they pass
// regardless of what the working repo's own HEAD currently touches — closing the
// circular block where a dev's not-yet-footed suppression commit made the gate's
// own tests fail. --dry-run is deliberately NOT used for the range tests: it
// short-circuits the real range-scan, so it cannot prove the scan path runs.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const SCRIPT = resolve('scripts/check-commit-footer-rationale.mjs')
const TEMPLATE_TWIN = resolve('src/templates/scripts/check-commit-footer-rationale.mjs.ejs')

function run(args: string[], cwd: string) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd, timeout: 15000 })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function fixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'commit-footer-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// Shape of the evidence artifact the gate writes (arbiter-commit-footer-audit-v1).
interface FooterEvidence {
  schema: string
  generated_at: string
  branch: string
  range: string
  commits_scanned: number
  commits_requiring_footer: number
  commits_with_valid_footer: number
  violations: unknown[]
  result: string
}

function git(dir: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' })
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (status ${r.status ?? 'null'}): ${r.stderr ?? ''}`,
    )
  }
  return r.stdout ?? ''
}

interface HermeticRepo {
  dir: string
  range: string
  cleanup: () => void
}

/**
 * Build a throwaway git repo whose tip commit touches `suppressions/`. When
 * `withFooter` is true the commit carries a valid Suppression-Rationale trailer.
 * Returns a `base..HEAD` range that contains exactly that one suppression commit
 * (the base commit, which touches no suppression file, is excluded).
 */
function repoWithSuppressionCommit(withFooter: boolean): HermeticRepo {
  const dir = mkdtempSync(join(tmpdir(), 'commit-footer-repo-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'hermetic-committer'])
  git(dir, ['config', 'user.name', 'Hermetic Test'])
  git(dir, ['config', 'commit.gpgsign', 'false'])

  // Base commit — no suppression file; excluded from the scanned range.
  writeFileSync(join(dir, 'README.md'), '# hermetic fixture\n')
  git(dir, ['add', 'README.md'])
  git(dir, ['commit', '-q', '-m', 'chore: base commit'])
  const base = git(dir, ['rev-parse', 'HEAD']).trim()

  // Suppression-touching commit at HEAD.
  mkdirSync(join(dir, 'suppressions'), { recursive: true })
  writeFileSync(join(dir, 'suppressions', 'waiver.txt'), 'CVE-2024-1234 waived\n')
  git(dir, ['add', join('suppressions', 'waiver.txt')])
  const commitArgs = withFooter
    ? [
        'commit',
        '-q',
        '-m',
        'chore: add suppression waiver',
        '-m',
        'Suppression-Rationale: CVE-2024-1234 | low impact, no exploit path | expires:2099-12-31',
      ]
    : ['commit', '-q', '-m', 'chore: add suppression waiver without footer']
  git(dir, commitArgs)

  return {
    dir,
    range: `${base}..HEAD`,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function readEvidence(evidenceDir: string): FooterEvidence {
  const files = readdirSync(evidenceDir).filter((f) => f.endsWith('.json'))
  expect(files.length).toBeGreaterThanOrEqual(1)
  return JSON.parse(readFileSync(join(evidenceDir, files[0]), 'utf-8')) as FooterEvidence
}

describe('check-commit-footer-rationale.mjs (INV-119)', () => {
  it('passes (exit 0, PASS) for a suppression-touching commit WITH a valid footer', () => {
    const repo = repoWithSuppressionCommit(true)
    const evidence = fixture()
    try {
      const r = run(['--range', repo.range, '--evidence-dir', evidence.dir], repo.dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('PASS')
      const ev = readEvidence(evidence.dir)
      expect(ev.result).toBe('PASS')
      expect(ev.commits_requiring_footer).toBeGreaterThanOrEqual(1)
      expect(ev.commits_with_valid_footer).toBeGreaterThanOrEqual(1)
    } finally {
      repo.cleanup()
      evidence.cleanup()
    }
  })

  it('writes a PASS evidence artifact with the required schema fields', () => {
    const repo = repoWithSuppressionCommit(true)
    const evidence = fixture()
    try {
      const r = run(['--range', repo.range, '--evidence-dir', evidence.dir], repo.dir)
      expect(r.status).toBe(0)
      const ev = readEvidence(evidence.dir)
      expect(ev.schema).toBe('arbiter-commit-footer-audit-v1')
      expect(ev.generated_at).toBeTruthy()
      expect(typeof ev.branch).toBe('string')
      expect(ev.range).toBe(repo.range)
      expect(typeof ev.commits_scanned).toBe('number')
      expect(typeof ev.commits_requiring_footer).toBe('number')
      expect(typeof ev.commits_with_valid_footer).toBe('number')
      expect(Array.isArray(ev.violations)).toBe(true)
      expect(ev.result).toBe('PASS')
    } finally {
      repo.cleanup()
      evidence.cleanup()
    }
  })

  it('fails (exit 1, FOOTER-MISSING) for a suppression-touching commit WITHOUT a footer', () => {
    const repo = repoWithSuppressionCommit(false)
    const evidence = fixture()
    try {
      const r = run(['--range', repo.range, '--evidence-dir', evidence.dir], repo.dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('FOOTER-MISSING')
      const ev = readEvidence(evidence.dir)
      expect(ev.result).toBe('FAIL')
      expect(ev.commits_requiring_footer).toBeGreaterThanOrEqual(1)
      expect(ev.violations.length).toBeGreaterThanOrEqual(1)
    } finally {
      repo.cleanup()
      evidence.cleanup()
    }
  })

  it('handles --help flag without error', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('commit-footer')
  })

  it('exits 0 (with WARN) when origin/main is unreachable', () => {
    // Run in a temp dir with no git repo — origin/main is unavailable
    const { dir, cleanup } = fixture()
    try {
      // Non-git directory: git log will fail
      const r = run(['--range', 'origin/main..HEAD'], dir)
      // Must exit 0 (warn, not block) when git fails
      expect(r.status).toBe(0)
      // Should emit a warning about unavailability
      expect(r.stderr).toContain('WARN')
    } finally {
      cleanup()
    }
  })
})

describe('check-commit-footer-rationale.mjs (INV-119) — footer validation', () => {
  it('accepts Suppression-Rationale: trailer format', () => {
    // Test by running the script's validation logic indirectly via --test-trailer flag
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Suppression-Rationale: CVE-2024-1234 | low impact | expires:2026-12-31',
      ],
      '.',
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('VALID')
  })

  it('rejects commit with suppression file but no recognized footer', () => {
    const r = run(['--dry-run', '--test-trailer', ''], '.')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('FOOTER-MISSING')
  })

  it('accepts Pitest-Override-Rationale: trailer format', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Pitest-Override-Rationale: test coverage deferred | follow-up:#9999 | approver:@user',
      ],
      '.',
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('VALID')
  })

  it('accepts Trivy-Expiry-Extension: trailer format', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Trivy-Expiry-Extension: CVE-2024-5678 | new-expiry:2027-01-01 | reason:no fix available',
      ],
      '.',
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('VALID')
  })

  it('accepts Sigstore-Bypass: trailer format', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Sigstore-Bypass: cosign unavailable | retry-after:2026-07-01',
      ],
      '.',
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('VALID')
  })
})

describe('check-commit-footer-rationale.mjs (INV-119) — scaffold vs entry content (#2669)', () => {
  function hermeticRepo(): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'commit-footer-scaffold-'))
    git(dir, ['init', '-q'])
    git(dir, ['config', 'user.email', 'hermetic-committer'])
    git(dir, ['config', 'user.name', 'Hermetic Test'])
    git(dir, ['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(dir, 'README.md'), '# hermetic fixture\n')
    git(dir, ['add', 'README.md'])
    git(dir, ['commit', '-q', '-m', 'chore: base commit'])
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }

  it('passes without a trailer for a scaffold-only commit (empty .trivyignore, comments only)', () => {
    const repo = hermeticRepo()
    const evidence = fixture()
    try {
      const base = git(repo.dir, ['rev-parse', 'HEAD']).trim()
      writeFileSync(join(repo.dir, '.trivyignore'), '# no active waivers yet\n')
      mkdirSync(join(repo.dir, 'suppressions'), { recursive: true })
      writeFileSync(
        join(repo.dir, 'suppressions', 'suppressions-schema.json'),
        JSON.stringify({ $schema: 'https://example.com/schema.json', version: 1 }, null, 2) + '\n',
      )
      git(repo.dir, ['add', '.trivyignore', join('suppressions', 'suppressions-schema.json')])
      git(repo.dir, ['commit', '-q', '-m', 'chore: scaffold suppression files'])
      const range = `${base}..HEAD`

      const r = run(['--range', range, '--evidence-dir', evidence.dir], repo.dir)
      expect(r.status).toBe(0)
      const ev = readEvidence(evidence.dir)
      expect(ev.result).toBe('PASS')
      expect(ev.commits_requiring_footer).toBe(0)
    } finally {
      repo.cleanup()
      evidence.cleanup()
    }
  })

  it('fails without a trailer once a commit adds a real .trivyignore entry', () => {
    const repo = hermeticRepo()
    const evidence = fixture()
    try {
      writeFileSync(join(repo.dir, '.trivyignore'), '# no active waivers yet\n')
      git(repo.dir, ['add', '.trivyignore'])
      git(repo.dir, ['commit', '-q', '-m', 'chore: scaffold trivyignore'])
      const base = git(repo.dir, ['rev-parse', 'HEAD']).trim()

      writeFileSync(join(repo.dir, '.trivyignore'), '# no active waivers yet\nCVE-2024-9999\n')
      git(repo.dir, ['add', '.trivyignore'])
      git(repo.dir, ['commit', '-q', '-m', 'chore: waive CVE-2024-9999'])
      const range = `${base}..HEAD`

      const r = run(['--range', range, '--evidence-dir', evidence.dir], repo.dir)
      expect(r.status).toBe(1)
      const ev = readEvidence(evidence.dir)
      expect(ev.result).toBe('FAIL')
      expect(ev.commits_requiring_footer).toBeGreaterThanOrEqual(1)
    } finally {
      repo.cleanup()
      evidence.cleanup()
    }
  })

  it('passes with a well-formed Trivy-Expiry-Extension trailer on an entry-adding commit', () => {
    const repo = hermeticRepo()
    const evidence = fixture()
    try {
      writeFileSync(join(repo.dir, '.trivyignore'), '# no active waivers yet\n')
      git(repo.dir, ['add', '.trivyignore'])
      git(repo.dir, ['commit', '-q', '-m', 'chore: scaffold trivyignore'])
      const base = git(repo.dir, ['rev-parse', 'HEAD']).trim()

      writeFileSync(join(repo.dir, '.trivyignore'), '# no active waivers yet\nCVE-2024-9999\n')
      git(repo.dir, ['add', '.trivyignore'])
      git(repo.dir, [
        'commit',
        '-q',
        '-m',
        'chore: waive CVE-2024-9999',
        '-m',
        'Trivy-Expiry-Extension: CVE-2024-9999 | new-expiry:2099-01-01 | reason:vendor fix pending',
      ])
      const range = `${base}..HEAD`

      const r = run(['--range', range, '--evidence-dir', evidence.dir], repo.dir)
      expect(r.status).toBe(0)
      const ev = readEvidence(evidence.dir)
      expect(ev.result).toBe('PASS')
    } finally {
      repo.cleanup()
      evidence.cleanup()
    }
  })

  it('fails an entry-adding commit whose trailer is prefix-only (no expires: date)', () => {
    const repo = hermeticRepo()
    const evidence = fixture()
    try {
      writeFileSync(join(repo.dir, '.trivyignore'), '# no active waivers yet\n')
      git(repo.dir, ['add', '.trivyignore'])
      git(repo.dir, ['commit', '-q', '-m', 'chore: scaffold trivyignore'])
      const base = git(repo.dir, ['rev-parse', 'HEAD']).trim()

      writeFileSync(join(repo.dir, '.trivyignore'), '# no active waivers yet\nCVE-2024-9999\n')
      git(repo.dir, ['add', '.trivyignore'])
      git(repo.dir, [
        'commit',
        '-q',
        '-m',
        'chore: waive CVE-2024-9999',
        '-m',
        'Suppression-Rationale: prefix only, no date',
      ])
      const range = `${base}..HEAD`

      const r = run(['--range', range, '--evidence-dir', evidence.dir], repo.dir)
      expect(r.status).toBe(1)
      const ev = readEvidence(evidence.dir)
      expect(ev.result).toBe('FAIL')
      expect(ev.violations.length).toBeGreaterThanOrEqual(1)
    } finally {
      repo.cleanup()
      evidence.cleanup()
    }
  })
})

describe('check-commit-footer-rationale.mjs (INV-119) — trailer shape validation (#2669)', () => {
  it('rejects a Suppression-Rationale trailer with an unparsable expires date', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Suppression-Rationale: CVE-2024-1234 | x | expires:not-a-date',
      ],
      '.',
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('expires')
  })

  it('rejects a Sigstore-Bypass trailer missing retry-after entirely', () => {
    const r = run(['--dry-run', '--test-trailer', 'Sigstore-Bypass: cosign unavailable'], '.')
    expect(r.status).toBe(1)
    expect(r.stderr.toLowerCase()).toContain('retry-after')
  })

  it('rejects a Pitest-Override-Rationale trailer missing follow-up', () => {
    const r = run(
      ['--dry-run', '--test-trailer', 'Pitest-Override-Rationale: deferred | approver:@user'],
      '.',
    )
    expect(r.status).toBe(1)
    expect(r.stderr.toLowerCase()).toContain('follow-up')
  })
})

describe('check-commit-footer-rationale.mjs (INV-119) — suppression-file classification', () => {
  // Regression (wave-E integration): the title-string interpolation hardening of
  // src/templates/suppressions/suppressions-schema.json.ejs falsely tripped the gate.
  // A schema *template* emitted into target projects is not an active security waiver.
  it('does NOT classify EJS suppression templates under src/templates/ as waivers', () => {
    const r = run(['--test-path', 'src/templates/suppressions/suppressions-schema.json.ejs'], '.')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('NOT-SUPPRESSION-FILE')
  })

  it('still classifies a real top-level suppressions/ waiver as a waiver', () => {
    const r = run(['--test-path', 'suppressions/.gitleaksignore'], '.')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('SUPPRESSION-FILE')
  })

  it('still classifies a .trivyignore as a waiver', () => {
    const r = run(['--test-path', '.trivyignore'], '.')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('SUPPRESSION-FILE')
  })

  // Regression (#1840 F4 tranche 4): examples/{ts,python,go}-library/ are `arbiter init`
  // OUTPUT (regenerated by scripts/regenerate-examples.mjs) — each carries its OWN
  // suppressions/ scaffolding for the DOWNSTREAM project, the rendered counterpart of the
  // src/templates/ EJS case above. This is not arbiter's own active security waiver and
  // must not demand a Suppression-Rationale footer on this repo's commits.
  it.each([
    'examples/ts-library/suppressions/.gitleaksignore',
    'examples/python-library/suppressions/pii-allowlist.json',
    'examples/go-library/suppressions/dependency-check-suppressions.xml',
    'examples/go-library/suppressions/suppressions-schema.json',
  ])('does NOT classify generated living-example suppression scaffolding as a waiver: %s', (p) => {
    const r = run(['--test-path', p], '.')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('NOT-SUPPRESSION-FILE')
  })
})

// Reviewer finding 1 (#2669): the scaffold exemption only special-cased a hand-written
// two-key ($schema/version) fixture. The REAL rendered suppressions-schema.json.ejs adds
// $id, title, description, type, items, definitions — none of which matched, so a fresh
// `arbiter init`/`arbiter update` scaffold (zero suppression entries) still tripped the gate.
describe('check-commit-footer-rationale.mjs (INV-119) — real rendered schema shape (#2669 finding 1)', () => {
  function hermeticRepo(): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'commit-footer-schema-'))
    git(dir, ['init', '-q'])
    git(dir, ['config', 'user.email', 'hermetic-committer'])
    git(dir, ['config', 'user.name', 'Hermetic Test'])
    git(dir, ['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(dir, 'README.md'), '# hermetic fixture\n')
    git(dir, ['add', 'README.md'])
    git(dir, ['commit', '-q', '-m', 'chore: base commit'])
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }

  it('passes without a trailer for a freshly-rendered suppressions-schema.json scaffold', () => {
    const repo = hermeticRepo()
    const evidence = fixture()
    try {
      const base = git(repo.dir, ['rev-parse', 'HEAD']).trim()
      // Render the REAL template, not a hand-written fixture (per reviewer finding 1).
      const rendered = renderTemplate(
        'suppressions/suppressions-schema.json.ejs',
        makeConfig(repo.dir),
      )
      expect(rendered).toContain('"$id"')
      expect(rendered).toContain('"title"')
      mkdirSync(join(repo.dir, 'suppressions'), { recursive: true })
      writeFileSync(join(repo.dir, 'suppressions', 'suppressions-schema.json'), rendered)
      git(repo.dir, ['add', join('suppressions', 'suppressions-schema.json')])
      git(repo.dir, ['commit', '-q', '-m', 'chore: scaffold suppression schema'])
      const range = `${base}..HEAD`

      const r = run(['--range', range, '--evidence-dir', evidence.dir], repo.dir)
      expect(r.status).toBe(0)
      const ev = readEvidence(evidence.dir)
      expect(ev.result).toBe('PASS')
      expect(ev.commits_requiring_footer).toBe(0)
    } finally {
      repo.cleanup()
      evidence.cleanup()
    }
  })
})

describe('check-commit-footer-rationale.mjs (INV-119) — trailer key:value grammar (#2669 finding 2)', () => {
  it('rejects a field name that is a substring of another word (not-expires:)', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Suppression-Rationale: CVE-2024-1234 | x | not-expires:2099-01-01',
      ],
      '.',
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('expires')
  })

  it('rejects a follow-up value that is not an issue reference (follow-up:garbage)', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Pitest-Override-Rationale: deferred | follow-up:garbage | approver:@user',
      ],
      '.',
    )
    expect(r.status).toBe(1)
    expect(r.stderr.toLowerCase()).toContain('follow-up')
  })

  it('accepts a real follow-up issue reference (follow-up:#9999)', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Pitest-Override-Rationale: deferred | follow-up:#9999 | approver:@user',
      ],
      '.',
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('VALID')
  })
})

describe('check-commit-footer-rationale.mjs (INV-119) — date round-trip (#2669 finding 3)', () => {
  it('rejects an impossible calendar date that Date silently normalizes (2026-02-31)', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Suppression-Rationale: CVE-2024-1234 | x | expires:2026-02-31',
      ],
      '.',
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('expires')
  })

  it('still accepts a genuine valid date', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Suppression-Rationale: CVE-2024-1234 | x | expires:2026-02-28',
      ],
      '.',
    )
    expect(r.status).toBe(0)
  })
})

// Reviewer finding 4 / AC4 (#2669): tests must exercise the EMITTED template twin
// (src/templates/scripts/check-commit-footer-rationale.mjs.ejs), not only the arbiter-self
// copy — the two are hand-maintained twins and can silently diverge.
describe('check-commit-footer-rationale.mjs.ejs template twin (#2669 finding 4 / AC4)', () => {
  function renderedTwinPath(): { scriptPath: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'commit-footer-twin-'))
    const rendered = renderTemplate(
      'scripts/check-commit-footer-rationale.mjs.ejs',
      makeConfig(dir),
    )
    const scriptPath = join(dir, 'check-commit-footer-rationale.mjs')
    writeFileSync(scriptPath, rendered)
    return { scriptPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }

  function hermeticRepo(): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'commit-footer-twin-repo-'))
    git(dir, ['init', '-q'])
    git(dir, ['config', 'user.email', 'hermetic-committer'])
    git(dir, ['config', 'user.name', 'Hermetic Test'])
    git(dir, ['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(dir, 'README.md'), '# hermetic fixture\n')
    git(dir, ['add', 'README.md'])
    git(dir, ['commit', '-q', '-m', 'chore: base commit'])
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }

  it('the raw template source file exists and is renderable (sanity)', () => {
    expect(() => readFileSync(TEMPLATE_TWIN, 'utf-8')).not.toThrow()
  })

  it('twin: fails without a trailer once a commit adds a real .trivyignore entry', () => {
    const twin = renderedTwinPath()
    const repo = hermeticRepo()
    const evidence = fixture()
    try {
      writeFileSync(join(repo.dir, '.trivyignore'), '# no active waivers yet\n')
      git(repo.dir, ['add', '.trivyignore'])
      git(repo.dir, ['commit', '-q', '-m', 'chore: scaffold trivyignore'])
      const base = git(repo.dir, ['rev-parse', 'HEAD']).trim()

      writeFileSync(join(repo.dir, '.trivyignore'), '# no active waivers yet\nCVE-2024-9999\n')
      git(repo.dir, ['add', '.trivyignore'])
      git(repo.dir, ['commit', '-q', '-m', 'chore: waive CVE-2024-9999'])
      const range = `${base}..HEAD`

      const r = spawnSync(
        'node',
        [twin.scriptPath, '--range', range, '--evidence-dir', evidence.dir],
        { encoding: 'utf-8', cwd: repo.dir, timeout: 15000 },
      )
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('FOOTER-MISSING')
    } finally {
      twin.cleanup()
      repo.cleanup()
      evidence.cleanup()
    }
  })

  it('twin: passes without a trailer for a freshly-rendered suppressions-schema.json scaffold', () => {
    const twin = renderedTwinPath()
    const repo = hermeticRepo()
    const evidence = fixture()
    try {
      const base = git(repo.dir, ['rev-parse', 'HEAD']).trim()
      const rendered = renderTemplate(
        'suppressions/suppressions-schema.json.ejs',
        makeConfig(repo.dir),
      )
      mkdirSync(join(repo.dir, 'suppressions'), { recursive: true })
      writeFileSync(join(repo.dir, 'suppressions', 'suppressions-schema.json'), rendered)
      git(repo.dir, ['add', join('suppressions', 'suppressions-schema.json')])
      git(repo.dir, ['commit', '-q', '-m', 'chore: scaffold suppression schema'])
      const range = `${base}..HEAD`

      const r = spawnSync(
        'node',
        [twin.scriptPath, '--range', range, '--evidence-dir', evidence.dir],
        { encoding: 'utf-8', cwd: repo.dir, timeout: 15000 },
      )
      expect(r.status, r.stderr).toBe(0)
      const ev = readEvidence(evidence.dir)
      expect(ev.result).toBe('PASS')
      expect(ev.commits_requiring_footer).toBe(0)
    } finally {
      twin.cleanup()
      repo.cleanup()
      evidence.cleanup()
    }
  })

  it('twin: rejects a substring-matched not-expires trailer the same way the self-copy does', () => {
    const twin = renderedTwinPath()
    try {
      const r = spawnSync(
        'node',
        [
          twin.scriptPath,
          '--dry-run',
          '--test-trailer',
          'Suppression-Rationale: CVE-2024-1234 | x | not-expires:2099-01-01',
        ],
        { encoding: 'utf-8', timeout: 15000 },
      )
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('expires')
    } finally {
      twin.cleanup()
    }
  })
})
