import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectLanguage,
  detectLanguageWithSource,
  resolveLanguage,
  languageSignalPresent,
} from '../../src/detectors/language.js'

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

// #1343: stored arbiter.json `language` must win over filesystem detection while
// it is still corroborated on disk (a Go-primary repo with a frontend lane has
// both go.mod and package.json — package.json must not shadow the stored `go`).
describe('languageSignalPresent', () => {
  let dir: string
  beforeEach(() => {
    dir = tmpDir()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('go signal present when go.mod exists', () => {
    writeFileSync(join(dir, 'go.mod'), 'module x\n')
    expect(languageSignalPresent(dir, 'go')).toBe(true)
  })

  it('go signal absent when go.mod missing', () => {
    expect(languageSignalPresent(dir, 'go')).toBe(false)
  })

  it('typescript signal present when package.json exists', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    expect(languageSignalPresent(dir, 'typescript')).toBe(true)
  })

  it('rust signal present when Cargo.toml exists', () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]')
    expect(languageSignalPresent(dir, 'rust')).toBe(true)
  })

  it('python signal present for any of pyproject/setup.py/requirements', () => {
    writeFileSync(join(dir, 'requirements.txt'), 'flask\n')
    expect(languageSignalPresent(dir, 'python')).toBe(true)
  })

  it('java signal present when pom.xml exists', () => {
    writeFileSync(join(dir, 'pom.xml'), '')
    expect(languageSignalPresent(dir, 'java')).toBe(true)
  })

  it('multi signal present only when both package.json and a JVM build file exist', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    expect(languageSignalPresent(dir, 'multi')).toBe(false)
    writeFileSync(join(dir, 'pom.xml'), '')
    expect(languageSignalPresent(dir, 'multi')).toBe(true)
  })

  it('unknown is never corroborated', () => {
    writeFileSync(join(dir, 'go.mod'), 'module x\n')
    expect(languageSignalPresent(dir, 'unknown')).toBe(false)
  })
})

describe('resolveLanguage', () => {
  let dir: string
  beforeEach(() => {
    dir = tmpDir()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('R1: returns stored go when go.mod present even though package.json would detect typescript', () => {
    writeFileSync(join(dir, 'go.mod'), 'module x\n')
    writeFileSync(join(dir, 'package.json'), '{}')
    // sanity: filesystem detection alone is wrong here
    expect(detectLanguage(dir)).toBe('typescript')
    expect(resolveLanguage(dir, { language: 'go' })).toBe('go')
  })

  it('R2: falls back to detectLanguage when stored language is undefined', () => {
    writeFileSync(join(dir, 'go.mod'), 'module x\n')
    expect(resolveLanguage(dir, {})).toBe('go')
  })

  it('R3: falls back to detectLanguage when stored language is unknown', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    expect(resolveLanguage(dir, { language: 'unknown' })).toBe('typescript')
  })

  it('R3b: migration — stored typescript but package.json gone and go.mod present re-detects go', () => {
    writeFileSync(join(dir, 'go.mod'), 'module x\n')
    // no package.json on disk: the stored typescript is no longer corroborated
    expect(resolveLanguage(dir, { language: 'typescript' })).toBe('go')
  })

  it('crash-safe: undefined stored does not throw', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    expect(resolveLanguage(dir, undefined)).toBe('typescript')
  })
})
