import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateSecurity } from '../../src/generators/security.js'
import { renderTemplate } from '../../src/utils/render.js'

const BASE_FILES = [
  join('scripts', 'pii-scan.mjs'),
  '.gitleaks.toml',
  join('.claude', 'hooks', 'check-no-pii.mjs'),
]

describe('generateSecurity', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits only the PII baseline when enableSecurityScanning is false', () => {
    const config = makeConfig(dir, { enableSecurityScanning: false })
    expect(generateSecurity(config).files).toHaveLength(1)
    expect(existsSync(join(dir, 'scripts', 'pii-scan.mjs'))).toBe(true)
    expect(existsSync(join(dir, '.gitleaks.toml'))).toBe(false)
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-pii.mjs'))).toBe(false)
  })

  it('generates 3 files for non-Java stacks', () => {
    const config = makeConfig(dir, {
      enableSecurityScanning: true,
      language: 'typescript',
    })
    const result = generateSecurity(config)
    expect(result.files).toHaveLength(3)
  })

  it('generates 3 files for Java too (ADR-104 — no more OWASP DC gradle snippet)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        enableSecurityScanning: true,
        language: 'java',
        buildTool: 'gradle',
      })
      const result = generateSecurity(config)
      expect(result.files).toHaveLength(3)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  for (const file of BASE_FILES) {
    it(`generates ${file} for TypeScript`, () => {
      const config = makeConfig(dir, { enableSecurityScanning: true })
      generateSecurity(config)
      expect(existsSync(join(dir, file))).toBe(true)
    })
  }

  for (const lang of ['typescript', 'rust', 'go', 'python', 'java'] as const) {
    it(`does not generate config/owasp-dependency-check.gradle for ${lang} (ADR-104, deleted)`, () => {
      const langDir = createTestProject(lang)
      initGit(langDir)
      try {
        const config = makeConfig(langDir, {
          enableSecurityScanning: true,
          language: lang,
          ...(lang === 'java' ? { buildTool: 'gradle' as const } : {}),
        })
        generateSecurity(config)
        expect(existsSync(join(langDir, 'config', 'owasp-dependency-check.gradle'))).toBe(false)
      } finally {
        cleanupTestProject(langDir)
      }
    })
  }

  it('pii-scan.mjs reads pii-allowlist.json suppression file', () => {
    const config = makeConfig(dir, { enableSecurityScanning: true })
    generateSecurity(config)
    const content = readFileSync(join(dir, 'scripts', 'pii-scan.mjs'), 'utf-8')
    expect(content).toContain('pii-allowlist.json')
  })

  it('pii-scan.mjs contains email regex pattern', () => {
    const config = makeConfig(dir, { enableSecurityScanning: true })
    generateSecurity(config)
    const content = readFileSync(join(dir, 'scripts', 'pii-scan.mjs'), 'utf-8')
    expect(content).toContain('@')
  })

  it('.gitleaks.toml references .gitleaksignore', () => {
    const config = makeConfig(dir, { enableSecurityScanning: true })
    generateSecurity(config)
    const content = readFileSync(join(dir, '.gitleaks.toml'), 'utf-8')
    expect(content).toContain('.gitleaksignore')
  })

  it('.gitleaks.toml allowlists the arbiter-generated-manifest (committed, hash-only)', () => {
    // #1358: the render-hash baseline is committed by design (fleet provenance);
    // its path->sha256 entries must be path-allowlisted so gitleaks' generic-api-key
    // rule does not flag them and block the client's push.
    const config = makeConfig(dir, { enableSecurityScanning: true })
    generateSecurity(config)
    const content = readFileSync(join(dir, '.gitleaks.toml'), 'utf-8')
    expect(content).toContain('arbiter-generated-manifest')
  })

  it('pii-scan.mjs validates allowlist is array (not bare catch)', () => {
    const config = makeConfig(dir, { enableSecurityScanning: true })
    generateSecurity(config)
    const content = readFileSync(join(dir, 'scripts', 'pii-scan.mjs'), 'utf-8')
    expect(content).toContain('Array.isArray')
    expect(content).toContain('process.exit(1)')
    expect(content).not.toContain('/* ignore malformed allowlist */')
  })

  it('pii-scan.mjs isAllowed enforces an anchored specificity floor (#1669)', () => {
    const config = makeConfig(dir, { enableSecurityScanning: true })
    generateSecurity(config)
    const content = readFileSync(join(dir, 'scripts', 'pii-scan.mjs'), 'utf-8')
    // A suppression must be narrow: exact pattern, or an exact file+line pair.
    expect(content).toContain('hasPattern || (hasFile && hasLine)')
    // File is path-anchored (startsWith), pattern is exact — never substring containment.
    expect(content).toContain('rel.startsWith(prefix)')
    expect(content).toContain('matchStr !== entry.pattern')
    expect(content).not.toContain('!rel.includes(entry.file)')
    expect(content).not.toContain('!matchStr.includes(entry.pattern)')
  })

  for (const lang of ['typescript', 'rust', 'go', 'python', 'java'] as const) {
    it(`generates base files for ${lang}`, () => {
      const langDir = createTestProject(lang)
      initGit(langDir)
      try {
        const config = makeConfig(langDir, {
          enableSecurityScanning: true,
          language: lang,
        })
        generateSecurity(config)
        for (const file of BASE_FILES) {
          expect(existsSync(join(langDir, file))).toBe(true)
        }
      } finally {
        cleanupTestProject(langDir)
      }
    })
  }
})

describe('check-no-pii.mjs.ejs render (CANON-04)', () => {
  it('renders non-empty output', () => {
    const out = renderTemplate('claude/hooks/check-no-pii.mjs.ejs', {})
    expect(out.length).toBeGreaterThan(0)
  })

  it('rendered output references INV-12', () => {
    const out = renderTemplate('claude/hooks/check-no-pii.mjs.ejs', {})
    expect(out).toContain('INV-12')
  })

  it('rendered output contains email address PII pattern', () => {
    const out = renderTemplate('claude/hooks/check-no-pii.mjs.ejs', {})
    expect(out).toContain('email address')
  })

  it('rendered output resolves the tool input path (stdin JSON + env fallback)', () => {
    const out = renderTemplate('claude/hooks/check-no-pii.mjs.ejs', {})
    // The hook resolves the edited file via resolveToolInputPath() (stdin tool_input.file_path
    // with CLAUDE_TOOL_INPUT_PATH as the Codex fallback) rather than reading the env var raw.
    expect(out).toContain('resolveToolInputPath')
  })
})
