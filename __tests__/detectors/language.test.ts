import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectLanguage, detectLanguageWithSource } from '../../src/detectors/language.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-test-'))
}

describe('detectLanguage', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('detects typescript from package.json', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    expect(detectLanguage(dir)).toBe('typescript')
  })

  it('detects rust from Cargo.toml', () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]')
    expect(detectLanguage(dir)).toBe('rust')
  })

  it('detects java from build.gradle', () => {
    writeFileSync(join(dir, 'build.gradle'), '')
    expect(detectLanguage(dir)).toBe('java')
  })

  it('detects java from pom.xml', () => {
    writeFileSync(join(dir, 'pom.xml'), '')
    expect(detectLanguage(dir)).toBe('java')
  })

  it('detects go from go.mod', () => {
    writeFileSync(join(dir, 'go.mod'), '')
    expect(detectLanguage(dir)).toBe('go')
  })

  it('detects python from pyproject.toml', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '')
    expect(detectLanguage(dir)).toBe('python')
  })

  it('returns unknown for empty dir', () => {
    expect(detectLanguage(dir)).toBe('unknown')
  })

  describe('kotlin detection', () => {
    it('detects kotlin when .kt file exists under src/main/kotlin', () => {
      writeFileSync(join(dir, 'build.gradle'), '')
      mkdirSync(join(dir, 'src/main/kotlin'), { recursive: true })
      writeFileSync(join(dir, 'src/main/kotlin/Main.kt'), '')
      expect(detectLanguage(dir)).toBe('kotlin')
    })
  })

  describe('multi-language (Java+TS monorepo)', () => {
    it('returns typescript when package.json exists alone', () => {
      writeFileSync(join(dir, 'package.json'), '{}')
      expect(detectLanguage(dir)).toBe('typescript')
    })

    it('returns multi when package.json and backend/build.gradle both exist', () => {
      writeFileSync(join(dir, 'package.json'), '{}')
      mkdirSync(join(dir, 'backend'))
      writeFileSync(join(dir, 'backend', 'build.gradle'), '')
      expect(detectLanguage(dir)).toBe('multi')
    })

    it('returns multi when package.json and root pom.xml both exist', () => {
      writeFileSync(join(dir, 'package.json'), '{}')
      writeFileSync(join(dir, 'pom.xml'), '')
      expect(detectLanguage(dir)).toBe('multi')
    })

    it('returns multi when package.json and backend/pom.xml both exist', () => {
      writeFileSync(join(dir, 'package.json'), '{}')
      mkdirSync(join(dir, 'backend'))
      writeFileSync(join(dir, 'backend', 'pom.xml'), '')
      expect(detectLanguage(dir)).toBe('multi')
    })

    it('returns multi when package.json and backend/build.gradle.kts both exist', () => {
      writeFileSync(join(dir, 'package.json'), '{}')
      mkdirSync(join(dir, 'backend'))
      writeFileSync(join(dir, 'backend', 'build.gradle.kts'), '')
      expect(detectLanguage(dir)).toBe('multi')
    })
  })
})

describe('detectLanguageWithSource', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns typescript + package.json source', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    expect(detectLanguageWithSource(dir)).toEqual({
      language: 'typescript',
      source: 'package.json',
    })
  })

  it('returns rust + Cargo.toml source', () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]')
    expect(detectLanguageWithSource(dir)).toEqual({ language: 'rust', source: 'Cargo.toml' })
  })

  it('returns go + go.mod source', () => {
    writeFileSync(join(dir, 'go.mod'), '')
    expect(detectLanguageWithSource(dir)).toEqual({ language: 'go', source: 'go.mod' })
  })

  it('returns java + pom.xml source', () => {
    writeFileSync(join(dir, 'pom.xml'), '')
    expect(detectLanguageWithSource(dir)).toEqual({ language: 'java', source: 'pom.xml' })
  })

  it('returns java + build.gradle source', () => {
    writeFileSync(join(dir, 'build.gradle'), '')
    expect(detectLanguageWithSource(dir)).toEqual({ language: 'java', source: 'build.gradle' })
  })

  it('returns java + build.gradle.kts source when no .kt files', () => {
    writeFileSync(join(dir, 'build.gradle.kts'), '')
    expect(detectLanguageWithSource(dir)).toEqual({ language: 'java', source: 'build.gradle.kts' })
  })

  it('returns kotlin + build.gradle source when .kt files present', () => {
    writeFileSync(join(dir, 'build.gradle'), '')
    mkdirSync(join(dir, 'src/main/kotlin'), { recursive: true })
    writeFileSync(join(dir, 'src/main/kotlin/Main.kt'), '')
    expect(detectLanguageWithSource(dir)).toEqual({ language: 'kotlin', source: 'build.gradle' })
  })

  it('returns python + pyproject.toml source', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '')
    expect(detectLanguageWithSource(dir)).toEqual({ language: 'python', source: 'pyproject.toml' })
  })

  it('returns python + setup.py source', () => {
    writeFileSync(join(dir, 'setup.py'), '')
    expect(detectLanguageWithSource(dir)).toEqual({ language: 'python', source: 'setup.py' })
  })

  it('returns python + requirements.txt source', () => {
    writeFileSync(join(dir, 'requirements.txt'), '')
    expect(detectLanguageWithSource(dir)).toEqual({
      language: 'python',
      source: 'requirements.txt',
    })
  })

  it('returns unknown + null source for empty dir', () => {
    expect(detectLanguageWithSource(dir)).toEqual({ language: 'unknown', source: null })
  })

  it('returns multi + compound source for package.json + root pom.xml', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    writeFileSync(join(dir, 'pom.xml'), '')
    expect(detectLanguageWithSource(dir)).toEqual({
      language: 'multi',
      source: 'package.json + pom.xml',
    })
  })

  it('returns multi + compound source for package.json + backend/build.gradle', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    mkdirSync(join(dir, 'backend'))
    writeFileSync(join(dir, 'backend', 'build.gradle'), '')
    expect(detectLanguageWithSource(dir)).toEqual({
      language: 'multi',
      source: 'package.json + build.gradle',
    })
  })

  it('returns multi + compound source for package.json + backend/build.gradle.kts', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    mkdirSync(join(dir, 'backend'))
    writeFileSync(join(dir, 'backend', 'build.gradle.kts'), '')
    expect(detectLanguageWithSource(dir)).toEqual({
      language: 'multi',
      source: 'package.json + build.gradle.kts',
    })
  })

  it('prefers pom.xml over build.gradle when both present for pom precedence', () => {
    writeFileSync(join(dir, 'pom.xml'), '')
    writeFileSync(join(dir, 'build.gradle'), '')
    const result = detectLanguageWithSource(dir)
    expect(result.language).toBe('java')
    expect(result.source).toBe('pom.xml')
  })
})
