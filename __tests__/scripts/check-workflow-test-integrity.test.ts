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
})
