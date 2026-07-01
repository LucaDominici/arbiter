// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function makeData(overrides: Record<string, unknown> = {}) {
  return makeConfig(
    '/tmp/test',
    overrides as Parameters<typeof makeConfig>[1],
  ) as unknown as Record<string, unknown>
}

// ─── check-suppression-rationale.mjs.ejs ─────────────────────────────────────

describe('check-suppression-rationale.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-suppression-rationale.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders SKIP path for missing suppressions/ directory', () => {
    const content = renderTemplate('scripts/check-suppression-rationale.mjs.ejs', makeData())
    expect(content).toContain('SKIP')
    expect(content).toContain('suppressions/')
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-suppression-rationale.mjs.ejs', makeData())
    expect(content).toContain('--help')
    expect(content).toContain('--help, -h')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-suppression-rationale.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-suppression-expiry.mjs.ejs ────────────────────────────────────────

describe('check-suppression-expiry.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-suppression-expiry.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders --max-days option support', () => {
    const content = renderTemplate('scripts/check-suppression-expiry.mjs.ejs', makeData())
    expect(content).toContain('--max-days')
    expect(content).toContain('365')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-suppression-expiry.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-pii-scan.mjs.ejs ──────────────────────────────────────────────────

describe('check-pii-scan.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-pii-scan.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders pii-patterns.txt reference', () => {
    const content = renderTemplate('scripts/check-pii-scan.mjs.ejs', makeData())
    expect(content).toContain('pii-patterns.txt')
  })

  it('renders --patterns option', () => {
    const content = renderTemplate('scripts/check-pii-scan.mjs.ejs', makeData())
    expect(content).toContain('--patterns')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-pii-scan.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-secret-scan.mjs.ejs ───────────────────────────────────────────────

describe('check-secret-scan.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-secret-scan.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders AWS and GitHub token patterns', () => {
    const content = renderTemplate('scripts/check-secret-scan.mjs.ejs', makeData())
    expect(content).toContain('AKIA')
    expect(content).toContain('ghp_')
  })

  it('skips test files and fixtures', () => {
    const content = renderTemplate('scripts/check-secret-scan.mjs.ejs', makeData())
    expect(content).toContain('__tests__/')
    expect(content).toContain('/fixtures/')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-secret-scan.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-drift.mjs.ejs ─────────────────────────────────────────────────────

describe('check-drift.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-drift.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders SKIP path for missing drift manifest', () => {
    const content = renderTemplate('scripts/check-drift.mjs.ejs', makeData())
    expect(content).toContain('SKIP')
    expect(content).toContain('drift-manifest.json')
  })

  it('renders sha256 hash verification', () => {
    const content = renderTemplate('scripts/check-drift.mjs.ejs', makeData())
    expect(content).toContain('sha256')
    expect(content).toContain('createHash')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-drift.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-workflow-sha-pinning.mjs.ejs ──────────────────────────────────────

describe('check-workflow-sha-pinning.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-workflow-sha-pinning.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders SHA pattern for 40-char hex detection', () => {
    const content = renderTemplate('scripts/check-workflow-sha-pinning.mjs.ejs', makeData())
    expect(content).toContain('[0-9a-f]{40}')
  })

  it('skips local composite actions starting with dot', () => {
    const content = renderTemplate('scripts/check-workflow-sha-pinning.mjs.ejs', makeData())
    expect(content).toContain("startsWith('.')")
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-workflow-sha-pinning.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-workflow-job-naming.mjs.ejs ───────────────────────────────────────

describe('check-workflow-job-naming.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-workflow-job-naming.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders name: field check for jobs', () => {
    const content = renderTemplate('scripts/check-workflow-job-naming.mjs.ejs', makeData())
    expect(content).toContain('has no name: field')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-workflow-job-naming.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-workflow-test-integrity.mjs.ejs ───────────────────────────────────

describe('check-workflow-test-integrity.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders on: and jobs: section checks', () => {
    const content = renderTemplate('scripts/check-workflow-test-integrity.mjs.ejs', makeData())
    expect(content).toContain("on:'")
    expect(content).toContain("jobs:'")
  })

  it('renders continue-on-error guard (INV-80)', () => {
    const content = renderTemplate('scripts/check-workflow-test-integrity.mjs.ejs', makeData())
    expect(content).toContain('continue-on-error')
    expect(content).toContain('INV-80')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-workflow-test-integrity.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  // ─── #1319.3: drift-shadow step-scoped allowlist (INV-80) ──────────────────
  // The rendered checker must pass the rendered drift-shadow.yml (its `parity`
  // step's continue-on-error is intended) but FAIL an UNINTENDED continue-on-error
  // on a different drift-shadow step.
  function runIntegrity(driftShadowYaml: string): { status: number; stderr: string } {
    const dir = mkdtempSync(join(tmpdir(), 'integ-render-'))
    try {
      const scriptsDir = join(dir, 'scripts')
      const wfDir = join(dir, '.github', 'workflows')
      mkdirSync(scriptsDir, { recursive: true })
      mkdirSync(wfDir, { recursive: true })
      writeFileSync(
        join(scriptsDir, 'check-workflow-test-integrity.mjs'),
        renderTemplate('scripts/check-workflow-test-integrity.mjs.ejs', makeData()),
      )
      writeFileSync(join(wfDir, 'drift-shadow.yml'), driftShadowYaml)
      const r = spawnSync(
        'node',
        [join(scriptsDir, 'check-workflow-test-integrity.mjs'), '--dir', dir],
        { encoding: 'utf-8' },
      )
      return { status: r.status ?? 1, stderr: r.stderr ?? '' }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('rendered checker passes the rendered drift-shadow.yml parity step', () => {
    const driftShadow = renderTemplate('github/workflows/drift-shadow.yml.ejs', makeData())
    // Guard: the intended continue-on-error belongs to the `parity` step.
    expect(driftShadow).toContain('id: parity')
    expect(driftShadow).toContain('continue-on-error: true')
    const { status } = runIntegrity(driftShadow)
    expect(status).toBe(0)
  })

  it('rendered checker FAILS an unintended continue-on-error on a non-parity step', () => {
    const tampered = `name: Drift Shadow (INV-59)
on:
  schedule:
    - cron: '0 3 * * *'
jobs:
  drift-check:
    name: Gate Result Drift Check
    runs-on: ubuntu-latest
    steps:
      - name: Compare local vs CI parity hash
        id: parity
        run: node scripts/check-local-ci-parity.mjs
        continue-on-error: true
      - name: Emit local L1 gate result
        id: emit-gate
        run: node scripts/check-all.mjs L1
        continue-on-error: true
`
    const { status, stderr } = runIntegrity(tampered)
    expect(status).toBe(1)
    expect(stderr).toContain('step-level continue-on-error: true found (INV-80)')
  })
})

// ─── F4: check-validator-helptext.mjs.ejs ────────────────────────────────────

describe('check-validator-helptext.mjs.ejs rendering (CANON-04, INV-89, F4)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-validator-helptext.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-validator-helptext.mjs.ejs', makeData())
    expect(content).toContain('--help')
  })

  it('renders SKIP path for missing scripts/ directory', () => {
    const content = renderTemplate('scripts/check-validator-helptext.mjs.ejs', makeData())
    expect(content).toContain('SKIP')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-validator-helptext.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── F4: check-tier-coverage.mjs.ejs ─────────────────────────────────────────

describe('check-tier-coverage.mjs.ejs rendering (CANON-04, INV-89, F4)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-tier-coverage.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-tier-coverage.mjs.ejs', makeData())
    expect(content).toContain('--help')
  })

  it('renders SKIP path for missing gate script', () => {
    const content = renderTemplate('scripts/check-tier-coverage.mjs.ejs', makeData())
    expect(content).toContain('SKIP')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-tier-coverage.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── F4: check-inline-suppressions.mjs.ejs ───────────────────────────────────

describe('check-inline-suppressions.mjs.ejs rendering (CANON-04, INV-89, F4)', () => {
  it('renders shebang', () => {
    const content = renderTemplate('scripts/check-inline-suppressions.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-inline-suppressions.mjs.ejs', makeData())
    expect(content).toContain('--help')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-inline-suppressions.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── F4: check-suppressions.mjs.ejs ──────────────────────────────────────────

describe('check-suppressions.mjs.ejs rendering (CANON-04, INV-89, F4)', () => {
  it('renders shebang', () => {
    const content = renderTemplate('scripts/check-suppressions.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-suppressions.mjs.ejs', makeData())
    expect(content).toContain('--help')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-suppressions.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── F4: check-action-pins.mjs.ejs ───────────────────────────────────────────

describe('check-action-pins.mjs.ejs rendering (CANON-04, INV-89, F4)', () => {
  it('renders shebang', () => {
    const content = renderTemplate('scripts/check-action-pins.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-action-pins.mjs.ejs', makeData())
    expect(content).toContain('--help')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-action-pins.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  // ─── #1666 (dual-track): comment-truthfulness mirrored into the SHIPPED gate ──
  // #1614 added a rule to arbiter's SELF gate that fails when ONE sha advertises
  // contradictory MAJOR version comments (a sha maps to exactly one release, so one
  // label lies). The shipped template gate only checked SHA *format* — consumers got
  // no protection. This mirrors the rule so generated projects catch the lie too,
  // respecting the template's level model (warn at L1, hard-fail at L2/L3).
  function runRenderedPins(
    level: 'L1' | 'L2' | 'L3',
    workflows: Record<string, string>,
  ): { status: number; stdout: string } {
    const d = mkdtempSync(join(tmpdir(), 'pins-render-'))
    try {
      const scriptsDir = join(d, 'scripts')
      const wfDir = join(d, '.github', 'workflows')
      mkdirSync(scriptsDir, { recursive: true })
      mkdirSync(wfDir, { recursive: true })
      writeFileSync(
        join(scriptsDir, 'check-action-pins.mjs'),
        renderTemplate('scripts/check-action-pins.mjs.ejs', makeData({ governanceLevel: level })),
      )
      for (const [name, body] of Object.entries(workflows)) writeFileSync(join(wfDir, name), body)
      const r = spawnSync('node', [join(scriptsDir, 'check-action-pins.mjs')], {
        encoding: 'utf-8',
        cwd: d,
      })
      return { status: r.status ?? 1, stdout: r.stdout ?? '' }
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  }

  // Same 40-hex sha, two different MAJOR labels across two files — exactly one lies.
  const CONTRADICTORY: Record<string, string> = {
    'a.yml':
      'jobs:\n  a:\n    steps:\n      - uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b  # v9\n',
    'b.yml':
      'jobs:\n  b:\n    steps:\n      - uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b  # v7\n',
  }

  it('L2: rendered gate FAILS on one sha with contradictory major comments (# v9 vs # v7)', () => {
    const { status, stdout } = runRenderedPins('L2', CONTRADICTORY)
    expect(status).toBe(1)
    expect(stdout).toContain('contradictory version comments')
    expect(stdout).toContain('actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b')
  })

  it('L2: rendered gate TOLERATES same-major precision (# v6 vs # v6.0.3)', () => {
    const ok: Record<string, string> = {
      'a.yml':
        'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10  # v6\n',
      'b.yml':
        'jobs:\n  b:\n    steps:\n      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10  # v6.0.3\n',
    }
    const { status } = runRenderedPins('L2', ok)
    expect(status).toBe(0)
  })

  it('L1: a contradictory comment is a WARNING (exit 0), not a hard fail', () => {
    const { status, stdout } = runRenderedPins('L1', CONTRADICTORY)
    expect(status).toBe(0)
    expect(stdout).toContain('contradictory version comments')
  })
})

// ─── F4: check-workflow-perms.mjs.ejs ────────────────────────────────────────

describe('check-workflow-perms.mjs.ejs rendering (CANON-04, INV-89, F4)', () => {
  it('renders shebang', () => {
    const content = renderTemplate('scripts/check-workflow-perms.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-workflow-perms.mjs.ejs', makeData())
    expect(content).toContain('--help')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-workflow-perms.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── F4: check-exit-code-contract.mjs.ejs ────────────────────────────────────

describe('check-exit-code-contract.mjs.ejs rendering (CANON-04, INV-89, F4)', () => {
  it('renders shebang', () => {
    const content = renderTemplate('scripts/check-exit-code-contract.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-exit-code-contract.mjs.ejs', makeData())
    expect(content).toContain('--help')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-exit-code-contract.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── F4: check-ssot-core.mjs.ejs ─────────────────────────────────────────────

describe('check-ssot-core.mjs.ejs rendering (CANON-04, INV-89, F4)', () => {
  it('renders shebang', () => {
    const content = renderTemplate('scripts/check-ssot-core.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-ssot-core.mjs.ejs', makeData())
    expect(content).toContain('--help')
  })

  it('renders skip path for missing SSOT file', () => {
    const content = renderTemplate('scripts/check-ssot-core.mjs.ejs', makeData())
    expect(content).toContain('skipping')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-ssot-core.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── F4: check-ci-tiers.mjs.ejs ──────────────────────────────────────────────

describe('check-ci-tiers.mjs.ejs rendering (CANON-04, INV-89, F4)', () => {
  it('renders shebang', () => {
    const content = renderTemplate('scripts/check-ci-tiers.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-ci-tiers.mjs.ejs', makeData())
    expect(content).toContain('--help')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-ci-tiers.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  // ─── #1319.2: required-tier set is the inverse of github.ts predicates ──────
  function requiredTiers(overrides: Record<string, unknown>): string[] {
    const content = renderTemplate('scripts/check-ci-tiers.mjs.ejs', makeData(overrides))
    const block = /REQUIRED_TIERS = \[([\s\S]*?)\]/.exec(content)
    if (!block) return []
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  }

  // Render the checker for a config, drop it + the given workflow files into a
  // temp tree, and run it — exercising the real exit-code behaviour.
  function runRendered(
    overrides: Record<string, unknown>,
    presentWorkflows: string[],
  ): { status: number; stdout: string } {
    const dir = mkdtempSync(join(tmpdir(), 'ci-tiers-render-'))
    try {
      const scriptsDir = join(dir, 'scripts')
      const wfDir = join(dir, '.github', 'workflows')
      mkdirSync(scriptsDir, { recursive: true })
      mkdirSync(wfDir, { recursive: true })
      writeFileSync(
        join(scriptsDir, 'check-ci-tiers.mjs'),
        renderTemplate('scripts/check-ci-tiers.mjs.ejs', makeData(overrides)),
      )
      for (const f of presentWorkflows) writeFileSync(join(wfDir, f), `# ${f}\n`)
      const r = spawnSync('node', [join(scriptsDir, 'check-ci-tiers.mjs')], {
        encoding: 'utf-8',
        cwd: dir,
      })
      return { status: r.status ?? 1, stdout: r.stdout ?? '' }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('trunk-solo L3 requires 06-nightly-lite + 09-heartbeat', () => {
    const req = requiredTiers({ collaborationMode: 'trunk-solo', governanceLevel: 'L3' })
    expect(req).toContain('06-nightly-lite.yml')
    expect(req).toContain('09-heartbeat.yml')
    // trunk-solo gets the lite nightly INSTEAD of the full nightly/weekly/monthly suite.
    expect(req).not.toContain('06-nightly.yml')
    expect(req).not.toContain('07-weekly.yml')
    expect(req).not.toContain('08-monthly.yml')
  })

  it('trunk-solo L3 still FAILS when 09-heartbeat is missing', () => {
    const { status } = runRendered({ collaborationMode: 'trunk-solo', governanceLevel: 'L3' }, [
      '01-pr-fast.yml',
      '02-pr-extended.yml',
      '03-human-approval.yml',
      '06-nightly-lite.yml',
      // 09-heartbeat.yml deliberately absent
    ])
    expect(status).toBe(1)
  })

  it('trunk-solo L2 FAILS when 06-nightly-lite is missing', () => {
    const { status } = runRendered({ collaborationMode: 'trunk-solo', governanceLevel: 'L2' }, [
      '01-pr-fast.yml',
      '02-pr-extended.yml',
      '03-human-approval.yml',
      // 06-nightly-lite.yml deliberately absent
    ])
    expect(status).toBe(1)
  })

  it('standard L2 (peer-review) does NOT require 06/07/08 (no false-fail)', () => {
    const req = requiredTiers({ collaborationMode: 'peer-review', governanceLevel: 'L2' })
    expect(req).not.toContain('06-nightly.yml')
    expect(req).not.toContain('07-weekly.yml')
    expect(req).not.toContain('08-monthly.yml')
    expect(req).not.toContain('06-nightly-lite.yml')
    expect(req).not.toContain('09-heartbeat.yml')
    // style is 'standard' at peer-review L2, so 05-release IS required.
    expect(req).toEqual([
      '01-pr-fast.yml',
      '02-pr-extended.yml',
      '03-human-approval.yml',
      '05-release.yml',
    ])
    const { status } = runRendered({ collaborationMode: 'peer-review', governanceLevel: 'L2' }, [
      '01-pr-fast.yml',
      '02-pr-extended.yml',
      '03-human-approval.yml',
      '05-release.yml',
    ])
    expect(status).toBe(0)
  })

  it('gated-review L3 requires the full 06/07/08 nightly suite + 09', () => {
    const req = requiredTiers({ collaborationMode: 'gated-review', governanceLevel: 'L3' })
    expect(req).toContain('06-nightly.yml')
    expect(req).toContain('07-weekly.yml')
    expect(req).toContain('08-monthly.yml')
    expect(req).toContain('09-heartbeat.yml')
    expect(req).not.toContain('06-nightly-lite.yml')
  })

  it('peer-review L1 (starter) requires only 01/02/03', () => {
    const req = requiredTiers({ collaborationMode: 'peer-review', governanceLevel: 'L1' })
    expect(req).toEqual(['01-pr-fast.yml', '02-pr-extended.yml', '03-human-approval.yml'])
  })

  // #1720 — INV-72 content strictness: existence alone let gap 1 (05-release.yml.ejs
  // silently downgrading L4's SLSA provenance to L2 "signed") stay invisible to this
  // gate. At L3+, when 05-release.yml is required, also assert its CONTENT declares
  // L3 hermetic SLSA provenance — not merely that the file exists.
  describe('gap 1 content strictness (#1720, INV-72)', () => {
    function runRenderedWithContent(
      overrides: Record<string, unknown>,
      workflowContents: Record<string, string>,
    ): { status: number; stdout: string } {
      const dir = mkdtempSync(join(tmpdir(), 'ci-tiers-content-'))
      try {
        const scriptsDir = join(dir, 'scripts')
        const wfDir = join(dir, '.github', 'workflows')
        mkdirSync(scriptsDir, { recursive: true })
        mkdirSync(wfDir, { recursive: true })
        writeFileSync(
          join(scriptsDir, 'check-ci-tiers.mjs'),
          renderTemplate('scripts/check-ci-tiers.mjs.ejs', makeData(overrides)),
        )
        for (const [f, content] of Object.entries(workflowContents)) {
          writeFileSync(join(wfDir, f), content)
        }
        const r = spawnSync('node', [join(scriptsDir, 'check-ci-tiers.mjs')], {
          encoding: 'utf-8',
          cwd: dir,
        })
        return { status: r.status ?? 1, stdout: r.stdout ?? '' }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    it('L3+: FAILS when 05-release.yml exists but lacks the L3 hermetic marker', () => {
      const { status, stdout } = runRenderedWithContent(
        { collaborationMode: 'peer-review', governanceLevel: 'L3' },
        {
          '01-pr-fast.yml': '# stub\n',
          '02-pr-extended.yml': '# stub\n',
          '03-human-approval.yml': '# stub\n',
          '05-release.yml': 'name: SLSA provenance (L2 signed)\n',
        },
      )
      expect(status).toBe(1)
      expect(stdout).toContain('L3 hermetic')
    })

    it('L3+: PASSES when 05-release.yml declares the L3 hermetic marker', () => {
      const { status } = runRenderedWithContent(
        { collaborationMode: 'peer-review', governanceLevel: 'L3' },
        {
          '01-pr-fast.yml': '# stub\n',
          '02-pr-extended.yml': '# stub\n',
          '03-human-approval.yml': '# stub\n',
          '05-release.yml': 'name: SLSA provenance (L3 hermetic)\n',
        },
      )
      expect(status).toBe(0)
    })

    it('L2: existence-only, no content assertion (unaffected by L3+ content gate)', () => {
      const { status } = runRenderedWithContent(
        { collaborationMode: 'peer-review', governanceLevel: 'L2' },
        {
          '01-pr-fast.yml': '# stub\n',
          '02-pr-extended.yml': '# stub\n',
          '03-human-approval.yml': '# stub\n',
          '05-release.yml': 'name: SLSA provenance (L2 signed)\n',
        },
      )
      expect(status).toBe(0)
    })
  })
})
