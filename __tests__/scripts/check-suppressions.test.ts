import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateSuppressions } from '../../src/generators/suppressions.js'

function setup(): string {
  const dir = createTestProject('typescript')
  initGit(dir)
  const config = makeConfig(dir, { enableSuppressions: true })
  generateSuppressions(config)
  return dir
}

function runScript(cwd: string): { status: number; stderr: string } {
  const r = spawnSync('node', ['scripts/check-suppressions.mjs'], {
    cwd,
    encoding: 'utf-8',
  })
  return { status: r.status ?? 1, stderr: r.stderr ?? '' }
}

function writeJson(dir: string, relPath: string, data: unknown): void {
  const full = join(dir, relPath)
  writeFileSync(full, JSON.stringify(data, null, 2))
}

function writeXml(dir: string, content: string): void {
  writeFileSync(join(dir, 'suppressions', 'dependency-check-suppressions.xml'), content)
}

function writeGitleaks(dir: string, content: string): void {
  writeFileSync(join(dir, 'suppressions', '.gitleaksignore'), content)
}

describe('check-suppressions.mjs', () => {
  let dir: string

  beforeEach(() => {
    dir = setup()
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  // ─── JSON files ───────────────────────────────────────────────────────────

  it('exits 0 with empty pii-allowlist.json', () => {
    writeJson(dir, join('suppressions', 'pii-allowlist.json'), [])
    const { status } = runScript(dir)
    expect(status).toBe(0)
  })

  it('exits 1 when pii-allowlist.json has an expired entry', () => {
    writeJson(dir, join('suppressions', 'pii-allowlist.json'), [
      {
        reason: 'Test fixture secret for unit tests only',
        owner: '@luca',
        expiresAt: '2020-01-01',
        scope: 'test',
      },
    ])
    const { status, stderr } = runScript(dir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/expired/i)
  })

  it('exits 0 when pii-allowlist.json has a future entry', () => {
    writeJson(dir, join('suppressions', 'pii-allowlist.json'), [
      {
        reason: 'Test fixture secret for unit tests only',
        owner: '@luca',
        expiresAt: '2099-01-01',
        scope: 'test',
      },
    ])
    const { status } = runScript(dir)
    expect(status).toBe(0)
  })

  it('exits 1 when pii-allowlist.json entry is missing reason', () => {
    writeJson(dir, join('suppressions', 'pii-allowlist.json'), [
      {
        owner: '@luca',
        expiresAt: '2099-01-01',
        scope: 'test',
      },
    ])
    const { status, stderr } = runScript(dir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/missing required field/i)
  })

  it('warns to stderr but exits 0 when entry expires within 30 days', () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 10)
    const expiresAt = soon.toISOString().slice(0, 10)
    writeJson(dir, join('suppressions', 'pii-allowlist.json'), [
      {
        reason: 'Test fixture secret for unit tests only',
        owner: '@luca',
        expiresAt,
        scope: 'test',
      },
    ])
    const { status, stderr } = runScript(dir)
    expect(status).toBe(0)
    expect(stderr).toMatch(/expires in/i)
  })

  it('exits 1 when archunit-baseline.json has an expired entry (Java project)', () => {
    // archunit-baseline.json is only checked for Java/Kotlin/multi — use Java config
    const javaDir = createTestProject('java')
    initGit(javaDir)
    const javaConfig = makeConfig(javaDir, {
      language: 'java',
      buildTool: 'gradle',
      enableSuppressions: true,
    })
    generateSuppressions(javaConfig)
    writeJson(javaDir, join('suppressions', 'archunit-baseline.json'), [
      {
        reason: 'Legacy package pending architectural cleanup in Q1',
        owner: '@luca',
        expiresAt: '2020-06-01',
        scope: 'com.example.legacy',
      },
    ])
    const { status, stderr } = runScript(javaDir)
    cleanupTestProject(javaDir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/expired/i)
  })

  // ─── XML file ─────────────────────────────────────────────────────────────

  it('exits 1 when XML has a suppress element with expired metadata comment', () => {
    writeXml(
      dir,
      `<?xml version="1.0" encoding="UTF-8"?>
<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd">
<!-- reason: CVE has no fix available upstream yet see issue 456 | owner: @luca | expiresAt: 2020-01-01 | scope: log4j -->
<suppress>
  <cve>CVE-2020-9999</cve>
</suppress>
</suppressions>`,
    )
    const { status, stderr } = runScript(dir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/expired/i)
  })

  it('exits 0 when XML has a suppress element with future metadata comment', () => {
    writeXml(
      dir,
      `<?xml version="1.0" encoding="UTF-8"?>
<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd">
<!-- reason: CVE has no fix available upstream yet see issue 456 | owner: @luca | expiresAt: 2099-01-01 | scope: log4j -->
<suppress>
  <cve>CVE-2020-9999</cve>
</suppress>
</suppressions>`,
    )
    const { status } = runScript(dir)
    expect(status).toBe(0)
  })

  it('exits 1 when XML suppress element has no metadata comment', () => {
    writeXml(
      dir,
      `<?xml version="1.0" encoding="UTF-8"?>
<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd">
<suppress>
  <cve>CVE-2020-9999</cve>
</suppress>
</suppressions>`,
    )
    const { status, stderr } = runScript(dir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/missing required field/i)
  })

  // ─── Gitleaks file ────────────────────────────────────────────────────────

  it('exits 1 when .gitleaksignore has an entry with expired metadata comment', () => {
    writeGitleaks(
      dir,
      `# reason: test fixture dummy secret for integration tests | owner: @luca | expiresAt: 2020-01-01 | scope: abc123
abc123def456789`,
    )
    const { status, stderr } = runScript(dir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/expired/i)
  })

  it('exits 0 when .gitleaksignore has an entry with future metadata comment', () => {
    writeGitleaks(
      dir,
      `# reason: test fixture dummy secret for integration tests | owner: @luca | expiresAt: 2099-01-01 | scope: abc123
abc123def456789`,
    )
    const { status } = runScript(dir)
    expect(status).toBe(0)
  })

  it('exits 1 when .gitleaksignore entry has no metadata comment', () => {
    writeGitleaks(dir, `abc123def456789`)
    const { status, stderr } = runScript(dir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/missing required field/i)
  })

  // ─── expiresAt validation ─────────────────────────────────────────────────

  it("exits 1 when pii-allowlist.json entry has non-date expiresAt (e.g. 'never')", () => {
    writeJson(dir, join('suppressions', 'pii-allowlist.json'), [
      {
        reason: 'Test fixture secret for unit tests only',
        owner: '@luca',
        expiresAt: 'never',
        scope: 'test',
      },
    ])
    const { status, stderr } = runScript(dir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/invalid expiresAt/i)
  })

  it('exits 1 when pii-allowlist.json entry has reason shorter than 10 chars', () => {
    writeJson(dir, join('suppressions', 'pii-allowlist.json'), [
      {
        reason: 'Short',
        owner: '@luca',
        expiresAt: '2099-01-01',
        scope: 'test',
      },
    ])
    const { status, stderr } = runScript(dir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/reason must be at least/i)
  })

  it('exits 1 when pii-allowlist.json contains a JSON object (not array)', () => {
    writeFileSync(
      join(dir, 'suppressions', 'pii-allowlist.json'),
      JSON.stringify({ reason: 'bad format' }),
    )
    const { status, stderr } = runScript(dir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/expected a JSON array/i)
  })

  it('exits 1 when XML suppress element follows only a multi-line header comment (no metadata)', () => {
    writeXml(
      dir,
      `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Project header comment spanning multiple lines
  reason: example | owner: @example | expiresAt: 2099-01-01 | scope: all
-->
<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd">
<suppress>
  <cve>CVE-2020-9999</cve>
</suppress>
</suppressions>`,
    )
    const { status, stderr } = runScript(dir)
    expect(status).toBe(1)
    expect(stderr).toMatch(/missing required field/i)
  })

  // ─── mkdirSync guard ──────────────────────────────────────────────────────

  it('exits 0 when suppressions/ directory does not exist (no entries)', () => {
    // Remove suppressions dir and re-run — no entries means nothing to validate
    rmSync(join(dir, 'suppressions'), { recursive: true, force: true })
    const { status } = runScript(dir)
    expect(status).toBe(0)
  })
})
