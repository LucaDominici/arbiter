import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateDebtGates } from '../../src/generators/debt-gates.js'

describe('brownfield: debt-gates generator (CANON-11)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  // ── TypeScript ──────────────────────────────────────────────────────────────

  it('does not overwrite existing .eslintrc-static.json on re-run', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)

    const path = join(dir, '.eslintrc-static.json')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '{"user":"edited"}')

    generateDebtGates(config)
    expect(readFileSync(path, 'utf-8')).toBe('{"user":"edited"}')
  })

  it('does not overwrite existing .prettierrc.json on re-run', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)

    const path = join(dir, '.prettierrc.json')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '{"printWidth":80}')

    generateDebtGates(config)
    expect(readFileSync(path, 'utf-8')).toBe('{"printWidth":80}')
  })

  // ── Python ─────────────────────────────────────────────────────────────────

  it('does not overwrite existing ruff.toml on re-run', () => {
    const pythonDir = createTestProject('python')
    initGit(pythonDir)
    try {
      const config = makeConfig(pythonDir, {
        language: 'python',
        buildTool: 'pip',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const path = join(pythonDir, 'ruff.toml')
      expect(existsSync(path)).toBe(true)
      writeFileSync(path, '# user-edited ruff config')

      generateDebtGates(config)
      expect(readFileSync(path, 'utf-8')).toBe('# user-edited ruff config')
    } finally {
      cleanupTestProject(pythonDir)
    }
  })

  // ── Java ───────────────────────────────────────────────────────────────────

  it('does not overwrite existing config/checkstyle.xml on re-run', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const path = join(javaDir, 'config', 'checkstyle.xml')
      expect(existsSync(path)).toBe(true)
      writeFileSync(path, '<!-- user-edited checkstyle -->')

      generateDebtGates(config)
      expect(readFileSync(path, 'utf-8')).toBe('<!-- user-edited checkstyle -->')
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('does not overwrite existing config/spotbugs-exclude.xml on re-run', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const path = join(javaDir, 'config', 'spotbugs-exclude.xml')
      expect(existsSync(path)).toBe(true)
      writeFileSync(path, '<!-- user-edited spotbugs -->')

      generateDebtGates(config)
      expect(readFileSync(path, 'utf-8')).toBe('<!-- user-edited spotbugs -->')
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('does not overwrite existing spotless.gradle on re-run', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const path = join(javaDir, 'spotless.gradle')
      expect(existsSync(path)).toBe(true)
      writeFileSync(path, '// user-edited spotless')

      generateDebtGates(config)
      expect(readFileSync(path, 'utf-8')).toBe('// user-edited spotless')
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('does not overwrite existing spotbugs.gradle on re-run (CANON-11)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const path = join(javaDir, 'spotbugs.gradle')
      expect(existsSync(path)).toBe(true)
      writeFileSync(path, '// user-edited spotbugs')

      generateDebtGates(config)
      expect(readFileSync(path, 'utf-8')).toBe('// user-edited spotbugs')
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  // #1898: confirmed on a real brownfield repo (onboarded before #1890) — the
  // root build already configures checkstyle/pmd/spotless/spotbugs INLINE
  // (its own authoring). Re-running `arbiter update` must not inject
  // apply(from = "spotless.gradle") / apply(from = "spotbugs.gradle"): doing
  // so duplicated the config and, when a pre-#1890 relic script was still on
  // disk, broke the build outright (script-plugin classloader isolation could
  // not resolve `com.github.spotbugs.snom.Effort`, imported by the relic).
  it('does not apply(from=...) spotless/spotbugs when already configured inline (#1898)', () => {
    const javaDir = createTestProject('unknown')
    initGit(javaDir)
    try {
      const buildFile = join(javaDir, 'build.gradle.kts')
      const original = [
        'plugins {',
        '    id("java")',
        '    id("checkstyle")',
        '    id("pmd")',
        '    id("com.diffplug.spotless") version "7.0.3"',
        '    id("com.github.spotbugs") version "6.0.18"',
        '}',
        '',
        'checkstyle {',
        '    toolVersion = "10.12.4"',
        '    config = resources.text.fromFile(file("config/checkstyle.xml"))',
        '}',
        'pmd {',
        '    toolVersion = "7.0.0"',
        '    ruleSetFiles = files("config/pmd-ruleset.xml")',
        '}',
        'spotless {',
        '    ratchetFrom("refs/remotes/origin/main")',
        '    java { googleJavaFormat("1.22.0").aosp() }',
        '}',
        'spotbugs {',
        '    effort = com.github.spotbugs.snom.Effort.MAX',
        '    ignoreFailures = true',
        '    excludeFilter = file("config/spotbugs-exclude.xml")',
        '}',
        '',
      ].join('\n')
      writeFileSync(buildFile, original)

      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const out = readFileSync(buildFile, 'utf-8')
      expect(out).not.toContain('apply(from = "spotless.gradle")')
      expect(out).not.toContain('apply(from = "spotbugs.gradle")')
      // Fully idempotent: every plugin/config signature already matched, so
      // the injector made no change at all — the brownfield-authored
      // `ignoreFailures = true` ratchet is untouched.
      expect(out).toBe(original)
    } finally {
      cleanupTestProject(javaDir)
    }
  })
})
