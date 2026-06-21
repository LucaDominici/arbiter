// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-workflow-test-integrity.mjs')

function run(dir: string) {
  const r = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-workflow-test-integrity.mjs (INV-89)', () => {
  it('exits 0 when workflow has required sections (on: and jobs:)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'test.yml'),
        `on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
`,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when workflow is missing on: section', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'missing-trigger.yml'),
        `jobs:
  test:
    runs-on: ubuntu-latest
`,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("missing 'on:' trigger section")
    } finally {
      cleanup()
    }
  })

  it('exits 1 when workflow is missing jobs: section', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'missing-jobs.yml'),
        `on:
  push:
    branches: [main]
`,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("missing 'jobs:' section")
    } finally {
      cleanup()
    }
  })

  it('exits 1 when non-informational workflow has step-level continue-on-error: true (INV-80)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'test-with-continue.yml'),
        `on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: npm test
        continue-on-error: true
`,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('step-level continue-on-error: true found (INV-80)')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when informational workflow (nightly) has step-level continue-on-error: true', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'nightly-build.yml'),
        `on:
  schedule:
    - cron: '0 2 * * *'
jobs:
  nightly:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run nightly tests
        run: npm test
        continue-on-error: true
`,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 with empty workflows directory', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  // ─── #1319.3: drift-shadow step-scoped allowlist (INV-80) ──────────────────
  // drift-shadow.yml is NOT a file-wide informational workflow. Its single
  // intended continue-on-error belongs to the `parity` step (id: parity). Any
  // OTHER continue-on-error step in drift-shadow.yml must still FAIL.

  it('exits 0 when drift-shadow parity step has continue-on-error (intended)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'drift-shadow.yml'),
        `on:
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
`,
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when drift-shadow has continue-on-error on a NON-parity step', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'drift-shadow.yml'),
        `on:
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
`,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('step-level continue-on-error: true found (INV-80)')
    } finally {
      cleanup()
    }
  })

  it('reports all violations, not just the first', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'multi-fail.yml'),
        `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: test
        continue-on-error: true
`,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("missing 'on:' trigger section")
      expect(result.stderr).toContain('step-level continue-on-error: true found')
    } finally {
      cleanup()
    }
  })

  // ─── #1491: `|| true` swallowing a GATE command's exit code (fake-green) ──────

  function writeWf(dir: string, name: string, runLine: string): void {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(
      join(dir, '.github', 'workflows', name),
      `on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: gate
        run: ${runLine}
`,
    )
  }

  it.each([
    'node scripts/check-all.mjs L2 || true',
    'npm test || true',
    'npm run test:unit || exit 0',
    'npx vitest run || true',
    'npx eslint src || true',
    'npx tsc --noEmit || :',
    'pytest || true',
    'cargo test || true',
    'node scripts/check-foo.mjs || true',
  ])('exits 1 when a gate command swallows its exit code: %s', (runLine) => {
    const { dir, cleanup } = makeTemp()
    try {
      writeWf(dir, 'fake-green.yml', runLine)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/gate command exit code swallowed/)
    } finally {
      cleanup()
    }
  })

  it.each([
    `find "$GITHUB_WORKSPACE/.git/refs" -name '*.lock' -delete 2>/dev/null || true`,
    `cp -r build/coverage/. coverage/ 2>/dev/null || true`,
    `BYPASS=$(echo "$LOG" | grep -F '[skip-docs]' || true)`,
    `LOG=$(git log --format=%B "$MB..$HEAD" || true)`,
  ])('exits 0 for a legitimate non-gate `|| true` idiom: %s', (runLine) => {
    const { dir, cleanup } = makeTemp()
    try {
      writeWf(dir, 'legit.yml', runLine)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a gate command runs WITHOUT an exit-swallow', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeWf(dir, 'clean-gate.yml', 'node scripts/check-all.mjs L2')
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
