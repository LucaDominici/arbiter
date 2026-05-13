import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectBasePackage } from '../../src/detectors/package.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-package-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('detectBasePackage', () => {
  it('detects groupId from pom.xml', () => {
    writeFileSync(
      join(dir, 'pom.xml'),
      `<?xml version="1.0"?>
<project>
  <groupId>com.example.myapp</groupId>
  <artifactId>backend</artifactId>
</project>`,
    )
    expect(detectBasePackage(dir)).toBe('com.example.myapp')
  })

  it('detects group from build.gradle', () => {
    writeFileSync(join(dir, 'build.gradle'), `group = 'com.acme.service'\nversion = '1.0.0'\n`)
    expect(detectBasePackage(dir)).toBe('com.acme.service')
  })

  it('detects group from build.gradle with double quotes', () => {
    writeFileSync(join(dir, 'build.gradle'), `group = "io.myorg.platform"\nversion = '2.0'\n`)
    expect(detectBasePackage(dir)).toBe('io.myorg.platform')
  })

  it('detects package from src/main/java directory structure when no build files', () => {
    const javaDir = join(dir, 'src', 'main', 'java', 'com', 'example', 'app')
    mkdirSync(javaDir, { recursive: true })
    expect(detectBasePackage(dir)).toBe('com.example.app')
  })

  it('returns undefined when no Java project markers found', () => {
    expect(detectBasePackage(dir)).toBeUndefined()
  })

  it('prefers pom.xml over build.gradle when both exist', () => {
    writeFileSync(join(dir, 'pom.xml'), `<project><groupId>com.from.pom</groupId></project>`)
    writeFileSync(join(dir, 'build.gradle'), `group = 'com.from.gradle'`)
    expect(detectBasePackage(dir)).toBe('com.from.pom')
  })
})
