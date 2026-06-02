/**
 * Parametric fail-closed tests for the anti-drift scan/suppression gate family.
 * All share the same subprocess-spawn harness; only the fixture and args differ.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

function run(script: string, args: string[], cwd?: string) {
  const r = spawnSync('node', [resolve(script), ...args], {
    encoding: 'utf-8',
    cwd: cwd ?? process.cwd(),
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gate-family-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// ─── check-secret-scan.mjs ────────────────────────────────────────────────────

describe('check-secret-scan.mjs (INV-89)', () => {
  it('exits 0 when no secrets present', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'clean.ts'), 'export const x = 1\n')
      expect(run('scripts/check-secret-scan.mjs', ['--dir', dir]).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an AWS access key pattern is detected', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'creds.ts'), 'const key = "AKIAIOSFODNN7EXAMPLE"\n')
      const result = run('scripts/check-secret-scan.mjs', ['--dir', dir])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('AWS')
    } finally {
      cleanup()
    }
  })
})

// ─── check-pii-scan.mjs ───────────────────────────────────────────────────────

describe('check-pii-scan.mjs (INV-89)', () => {
  it('exits 1 when patterns file is missing (fail-CLOSED — missing required input)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run('scripts/check-pii-scan.mjs', ['--patterns', join(dir, 'nonexistent.txt')])
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/not found|cannot read|missing/i)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when patterns file exists with valid regexes', () => {
    // check-pii-scan validates the patterns file format, not the --dir content
    const { dir, cleanup } = makeDir()
    try {
      const patternsFile = join(dir, 'pii-patterns.txt')
      writeFileSync(patternsFile, '# comment\n^test-pii-\\d{4}$\n')
      expect(run('scripts/check-pii-scan.mjs', ['--patterns', patternsFile]).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── check-suppression-rationale.mjs ─────────────────────────────────────────

describe('check-suppression-rationale.mjs (INV-89)', () => {
  it('exits 0 (skip) when suppressions/ directory is absent', () => {
    const { dir, cleanup } = makeDir()
    try {
      expect(run('scripts/check-suppression-rationale.mjs', [], dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a suppression entry has a thin reason (< 20 chars)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'suppressions'), { recursive: true })
      writeFileSync(
        join(dir, 'suppressions', 'pii-allowlist.json'),
        JSON.stringify([{ pattern: 'test', reason: 'too short' }]),
      )
      const result = run('scripts/check-suppression-rationale.mjs', [], dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when all suppression entries have adequate reasons (≥ 20 chars)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'suppressions'), { recursive: true })
      writeFileSync(
        join(dir, 'suppressions', 'pii-allowlist.json'),
        JSON.stringify([
          { pattern: 'test', reason: 'This is a sufficiently long reason for the suppression' },
        ]),
      )
      expect(run('scripts/check-suppression-rationale.mjs', [], dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── check-suppression-expiry.mjs ────────────────────────────────────────────

describe('check-suppression-expiry.mjs (INV-89)', () => {
  it('exits 0 (skip) when suppressions/ directory is absent', () => {
    const { dir, cleanup } = makeDir()
    try {
      expect(run('scripts/check-suppression-expiry.mjs', ['--max-days', '365'], dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a suppression expires beyond --max-days', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'suppressions'), { recursive: true })
      const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      writeFileSync(
        join(dir, 'suppressions', 'pii-allowlist.json'),
        JSON.stringify([
          { pattern: 'x', reason: 'long enough reason here yes', expiresAt: farFuture },
        ]),
      )
      const result = run('scripts/check-suppression-expiry.mjs', ['--max-days', '30'], dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/expir/i)
    } finally {
      cleanup()
    }
  })
})

// ─── check-workflow-test-integrity.mjs ───────────────────────────────────────

describe('check-workflow-test-integrity.mjs (INV-89)', () => {
  it('exits 0 (skip) when .github/workflows/ directory is absent', () => {
    const { dir, cleanup } = makeDir()
    try {
      expect(run('scripts/check-workflow-test-integrity.mjs', ['--dir', dir]).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a workflow file is missing on: trigger section', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      // script reads .yml/.yaml (not .ejs) via lib/workflow-scan.mjs
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'jobs:\n  test:\n    runs-on: ubuntu-latest\n',
      )
      const result = run('scripts/check-workflow-test-integrity.mjs', ['--dir', dir])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when workflow has both on: and jobs: sections', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'on:\n  push:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n',
      )
      expect(run('scripts/check-workflow-test-integrity.mjs', ['--dir', dir]).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── check-validator-helptext.mjs ─────────────────────────────────────────────

describe('check-validator-helptext.mjs (INV-89)', () => {
  it('exits 0 (skip) when scripts/ directory is absent', () => {
    const { dir, cleanup } = makeDir()
    try {
      expect(run('scripts/check-validator-helptext.mjs', ['--dir', dir]).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a W6 check-*.mjs script lacks --help support', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      // W6 marker present, but no --help handler
      writeFileSync(
        join(dir, 'scripts', 'check-fake-validator.mjs'),
        '#!/usr/bin/env node\n// anti-drift validator family (W6)\nconsole.log("no help")\n',
      )
      const result = run('scripts/check-validator-helptext.mjs', ['--dir', dir])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when all W6 check-*.mjs scripts have --help support', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'scripts', 'check-good-validator.mjs'),
        '#!/usr/bin/env node\n// anti-drift validator family (W6)\nif (process.argv.includes("--help")) { process.stdout.write("help\\n"); process.exit(0); }\n',
      )
      expect(run('scripts/check-validator-helptext.mjs', ['--dir', dir]).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── check-tier-coverage.mjs ─────────────────────────────────────────────────

describe('check-tier-coverage.mjs (INV-89)', () => {
  it('exits 0 (skip) when check-all.mjs gate file is absent', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run('scripts/check-tier-coverage.mjs', ['--gate', join(dir, 'missing.mjs')])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a required tier pattern is missing from gate file', () => {
    const { dir, cleanup } = makeDir()
    try {
      const gateFile = join(dir, 'check-all.mjs')
      // Write a gate file missing the 'unit tests' tier
      writeFileSync(
        gateFile,
        "runCheck('build-kit')\nrunCheck('typecheck')\nrunCheck('lint')\nrunCheck('spdx headers')\nrunCheck('orphan TODOs')\nrunCheck('ci tiers')\n",
      )
      const result = run('scripts/check-tier-coverage.mjs', ['--gate', gateFile])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('unit tests')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when all required tier patterns are present', () => {
    const { dir, cleanup } = makeDir()
    try {
      const gateFile = join(dir, 'check-all.mjs')
      writeFileSync(
        gateFile,
        "runCheck('build-kit')\nrunCheck('typecheck')\nrunCheck('lint')\nrunCheck('unit tests')\nrunCheck('spdx headers')\nrunCheck('orphan TODOs')\nrunCheck('ci tiers')\n",
      )
      expect(run('scripts/check-tier-coverage.mjs', ['--gate', gateFile]).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── check-pr-size-gate.mjs ──────────────────────────────────────────────────

describe('check-pr-size-gate.mjs (INV-89)', () => {
  it('exits 0 (skip) when neither config nor workflow reference is present', () => {
    const { dir, cleanup } = makeDir()
    try {
      expect(run('scripts/check-pr-size-gate.mjs', [], dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when config/pr-size-config.json has invalid JSON', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'config'), { recursive: true })
      writeFileSync(join(dir, 'config', 'pr-size-config.json'), '{ invalid json }')
      const result = run('scripts/check-pr-size-gate.mjs', [], dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when warnLines exceeds maximum (1000)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'config'), { recursive: true })
      writeFileSync(
        join(dir, 'config', 'pr-size-config.json'),
        JSON.stringify({ warnLines: 2000, errorLines: 3000 }),
      )
      const result = run('scripts/check-pr-size-gate.mjs', [], dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('warnLines')
    } finally {
      cleanup()
    }
  })
})
