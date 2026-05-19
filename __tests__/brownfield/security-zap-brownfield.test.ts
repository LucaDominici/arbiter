import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateSecurity } from '../../src/generators/security.js'

// CANON-11: brownfield tests for security generator ZAP DAST extension (#898)

describe('brownfield: security generator — ZAP DAST templates (CANON-11, #898)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  describe('service archetype (backend-web-db) with security scanning', () => {
    it('emits rules.tsv for service archetype', () => {
      const config = makeConfig(dir, {
        archetype: 'backend-web-db',
        enableSecurityScanning: true,
      })
      generateSecurity(config)
      expect(existsSync(join(dir, '.zap', 'rules.tsv'))).toBe(true)
    })

    it('emits baseline-auth.context for service archetype', () => {
      const config = makeConfig(dir, {
        archetype: 'backend-web-db',
        enableSecurityScanning: true,
      })
      generateSecurity(config)
      expect(existsSync(join(dir, '.zap', 'baseline-auth.context'))).toBe(true)
    })

    it('emits ingest-zap-report.mjs for service archetype', () => {
      const config = makeConfig(dir, {
        archetype: 'backend-web-db',
        enableSecurityScanning: true,
      })
      generateSecurity(config)
      expect(existsSync(join(dir, 'scripts', 'ingest-zap-report.mjs'))).toBe(true)
    })

    it('does not overwrite existing baseline-auth.context on re-run', () => {
      const config = makeConfig(dir, {
        archetype: 'backend-web-db',
        enableSecurityScanning: true,
      })
      generateSecurity(config)

      const contextPath = join(dir, '.zap', 'baseline-auth.context')
      expect(existsSync(contextPath)).toBe(true)
      writeFileSync(contextPath, '<!-- user-edited context -->')

      generateSecurity(config)
      expect(readFileSync(contextPath, 'utf-8')).toBe('<!-- user-edited context -->')
    })

    it('does not overwrite existing rules.tsv on re-run (user-tunable suppressions)', () => {
      const config = makeConfig(dir, {
        archetype: 'backend-web-db',
        enableSecurityScanning: true,
      })
      generateSecurity(config)

      const rulesPath = join(dir, '.zap', 'rules.tsv')
      expect(existsSync(rulesPath)).toBe(true)
      writeFileSync(rulesPath, '# user-edited rules')

      generateSecurity(config)
      expect(readFileSync(rulesPath, 'utf-8')).toBe('# user-edited rules')
    })

    it('overwrites ingest-zap-report.mjs on re-run (skipIfExists: false)', () => {
      const config = makeConfig(dir, {
        archetype: 'backend-web-db',
        enableSecurityScanning: true,
      })
      generateSecurity(config)

      const scriptPath = join(dir, 'scripts', 'ingest-zap-report.mjs')
      const originalContent = readFileSync(scriptPath, 'utf-8')
      writeFileSync(scriptPath, '// user-edited')

      generateSecurity(config)
      // Should be overwritten back to generated content
      expect(readFileSync(scriptPath, 'utf-8')).toBe(originalContent)
    })
  })

  describe('non-service archetypes — ZAP files not emitted', () => {
    it('library archetype: no ZAP files', () => {
      const config = makeConfig(dir, {
        archetype: 'library',
        enableSecurityScanning: true,
      })
      generateSecurity(config)
      expect(existsSync(join(dir, '.zap', 'rules.tsv'))).toBe(false)
      expect(existsSync(join(dir, '.zap', 'baseline-auth.context'))).toBe(false)
      expect(existsSync(join(dir, 'scripts', 'ingest-zap-report.mjs'))).toBe(false)
    })

    it('cli archetype: no ZAP files', () => {
      const config = makeConfig(dir, {
        archetype: 'cli',
        enableSecurityScanning: true,
      })
      generateSecurity(config)
      expect(existsSync(join(dir, '.zap', 'rules.tsv'))).toBe(false)
    })

    it('data-pipeline archetype: no ZAP files', () => {
      const config = makeConfig(dir, {
        archetype: 'data-pipeline',
        enableSecurityScanning: true,
      })
      generateSecurity(config)
      expect(existsSync(join(dir, '.zap', 'rules.tsv'))).toBe(false)
    })
  })

  describe('security scanning disabled', () => {
    it('service archetype with security disabled: no ZAP files', () => {
      const config = makeConfig(dir, {
        archetype: 'backend-web-db',
        enableSecurityScanning: false,
      })
      generateSecurity(config)
      expect(existsSync(join(dir, '.zap', 'rules.tsv'))).toBe(false)
      expect(existsSync(join(dir, '.zap', 'baseline-auth.context'))).toBe(false)
    })
  })
})
