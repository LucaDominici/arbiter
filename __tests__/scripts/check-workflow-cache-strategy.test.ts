// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-workflow-cache-strategy.mjs')

function run(dir: string) {
  const r = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cache-strategy-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/**
 * Build the template directory and write a primary PR template.
 * The gate only checks 01-pr-fast.yml.ejs and 02-pr-extended.yml.ejs.
 * Returns the template directory path.
 */
function makePrimaryTemplate(
  parentDir: string,
  filename: '01-pr-fast.yml.ejs' | '02-pr-extended.yml.ejs',
  content: string,
): string {
  const tplDir = join(parentDir, 'src', 'templates', 'github', 'workflows')
  mkdirSync(tplDir, { recursive: true })
  writeFileSync(join(tplDir, filename), content)
  return tplDir
}

// ─── Java / Maven reactor handoff ─────────────────────────────────────────────
//
// The Java/Maven assertion fires when the template contains 'reactor-m2-' anywhere
// (meaning it uses the Maven reactor pattern). The gate then asserts that BOTH
// upload-artifact AND download-artifact references are present with the reactor-m2
// artifact name.

describe('check-workflow-cache-strategy.mjs — Java/Maven reactor', () => {
  it('exits 0 when template contains full reactor-m2 upload+download artifact handoff', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '<% if (language === "java" && buildTool === "maven") { %>',
          '  build-reactor:',
          '    steps:',
          '      - uses: actions/upload-artifact@sha',
          '        with:',
          '          name: reactor-m2-${{ github.run_id }}',
          '  gate:',
          '    steps:',
          '      - uses: actions/download-artifact@sha',
          '        with:',
          '          name: reactor-m2-${{ github.run_id }}',
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when template has reactor-m2 reference but missing download-artifact', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '<% if (language === "java" && buildTool === "maven") { %>',
          '  build-reactor:',
          '    steps:',
          '      - uses: actions/upload-artifact@sha',
          '        with:',
          '          name: reactor-m2-${{ github.run_id }}',
          // No download-artifact
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('java/maven')
      expect(result.stderr).toContain('reactor-m2')
    } finally {
      cleanup()
    }
  })

  it('exits 0 for non-reactor Java/Maven template that has no reactor-m2 reference (e.g. deploy)', () => {
    // Templates that use `cache: maven` on setup-java instead of the reactor pattern
    // do NOT contain 'reactor-m2-' and should not trigger the Java/Maven assertion.
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          // Has typescript section (to avoid missing-archetype scenario)
          '<% if (language === "typescript") { %>',
          '  gate:',
          '    steps:',
          '      - uses: ./.github/actions/setup-node-pnpm',
          '<% } %>',
          // Has java/maven conditional but uses setup-java with cache: maven (no reactor-m2)
          '<% if (language === "java" && buildTool === "maven") { %>',
          '  gate:',
          '    steps:',
          '      - uses: actions/setup-java@sha',
          '        with:',
          '          cache: maven',
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })
})

// ─── Node / TypeScript archetype ──────────────────────────────────────────────

describe('check-workflow-cache-strategy.mjs — Node/TypeScript', () => {
  it('exits 0 when template uses setup-node-pnpm composite (caches npm internally)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '<% if (language === "typescript") { %>',
          '  gate:',
          '    steps:',
          '      - uses: ./.github/actions/setup-node-pnpm',
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it("exits 0 when template uses actions/setup-node with cache: 'npm'", () => {
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '<% if (language === "typescript") { %>',
          '  gate:',
          '    steps:',
          '      - uses: actions/setup-node@sha',
          '        with:',
          "          cache: 'npm'",
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when Node template lacks both setup-node-pnpm and cache: npm/pnpm', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '<% if (language === "typescript") { %>',
          '  gate:',
          '    steps:',
          '      - uses: actions/setup-node@sha',
          '        with:',
          '          node-version: 20',
          // No cache
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('node/typescript')
      expect(result.stderr).toContain('cache')
    } finally {
      cleanup()
    }
  })
})

// ─── Python archetype ─────────────────────────────────────────────────────────

describe('check-workflow-cache-strategy.mjs — Python', () => {
  it("exits 0 when Python template uses actions/setup-python with cache: 'pip'", () => {
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '<% if (language === "python") { %>',
          '  gate:',
          '    steps:',
          '      - uses: actions/setup-python@sha',
          '        with:',
          "          cache: 'pip'",
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when Python template uses actions/setup-python with unquoted cache: pip', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '<% if (language === "python") { %>',
          '  gate:',
          '    steps:',
          '      - uses: actions/setup-python@sha',
          '        with:',
          '          cache: pip',
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when Python template uses setup-python without any cache key', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '<% if (language === "python") { %>',
          '  gate:',
          '    steps:',
          '      - uses: actions/setup-python@sha',
          '        with:',
          "          python-version: '3.12'",
          // No cache
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('python')
      expect(result.stderr).toContain('cache')
    } finally {
      cleanup()
    }
  })
})

// ─── Rust archetype ───────────────────────────────────────────────────────────

describe('check-workflow-cache-strategy.mjs — Rust', () => {
  it('exits 0 when Rust template uses Swatinem/rust-cache', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '<% if (language === "rust") { %>',
          '  gate:',
          '    steps:',
          '      - uses: Swatinem/rust-cache@sha',
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when Rust template lacks Swatinem/rust-cache or actions/cache for cargo', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '<% if (language === "rust") { %>',
          '  gate:',
          '    steps:',
          '      - uses: dtolnay/rust-toolchain@sha',
          '      - run: cargo test',
          // No cache
          '<% } %>',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('rust')
      expect(result.stderr).toContain('cache')
    } finally {
      cleanup()
    }
  })
})

// ─── Skip / fail-closed cases ─────────────────────────────────────────────────

describe('check-workflow-cache-strategy.mjs — fail-closed and skip', () => {
  it('exits 0 when primary template has no archetype triggers (acts as skip)', () => {
    // A primary template with no archetype conditional blocks has no assertions
    // to check → gate skips all checks for that template → passes.
    const { dir, cleanup } = makeTemp()
    try {
      makePrimaryTemplate(
        dir,
        '01-pr-fast.yml.ejs',
        [
          '# Minimal template with no archetype conditionals',
          'name: PR Fast',
          'on:',
          '  push:',
          '    branches: [main]',
          'jobs:',
          '  ping:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - run: echo "alive"',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 2 (fail-closed) when templates directory does not exist', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // No src/templates/github/workflows directory at all
      const result = run(dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('ERROR')
    } finally {
      cleanup()
    }
  })

  it('exits 2 (fail-closed) when templates dir exists but has no primary PR templates', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // Create the directory but only with non-primary templates
      const tplDir = join(dir, 'src', 'templates', 'github', 'workflows')
      mkdirSync(tplDir, { recursive: true })
      writeFileSync(
        join(tplDir, '09-heartbeat.yml.ejs'),
        'name: Heartbeat\non:\n  schedule:\n    - cron: "0 * * * *"\n',
      )
      const result = run(dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('ERROR')
    } finally {
      cleanup()
    }
  })
})

// ─── Integration: real templates pass ─────────────────────────────────────────

describe('check-workflow-cache-strategy.mjs — integration on real templates', () => {
  it('exits 0 when run against the actual arbiter repo templates', () => {
    // Run against the real repo (cwd = repo root from resolve())
    const repoRoot = resolve('.')
    const r = spawnSync('node', [SCRIPT, '--dir', repoRoot], { encoding: 'utf-8' })
    const status = r.status ?? 1
    if (status !== 0) {
      // Surface diagnostics on failure for easier debugging
      process.stderr.write(r.stdout)
      process.stderr.write(r.stderr)
    }
    expect(status).toBe(0)
  })
})
