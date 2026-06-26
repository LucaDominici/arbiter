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

  it('detects group from build.gradle.kts (Kotlin DSL) (#278 #1)', () => {
    writeFileSync(join(dir, 'build.gradle.kts'), `group = "com.kts.example"\nversion = "1.0"\n`)
    expect(detectBasePackage(dir)).toBe('com.kts.example')
  })

  it('prefers build.gradle over build.gradle.kts when both exist (#278 #1)', () => {
    writeFileSync(join(dir, 'build.gradle'), `group = 'com.from.groovy'`)
    writeFileSync(join(dir, 'build.gradle.kts'), `group = "com.from.kts"`)
    expect(detectBasePackage(dir)).toBe('com.from.groovy')
  })

  it('ignores the spring-boot-starter-parent groupId and returns the project groupId (#1582)', () => {
    writeFileSync(
      join(dir, 'pom.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.0</version>
  </parent>
  <groupId>com.example</groupId>
  <artifactId>backend</artifactId>
  <version>0.0.1-SNAPSHOT</version>
</project>`,
    )
    expect(detectBasePackage(dir)).toBe('com.example')
  })

  it('falls back to the parent groupId when the project omits its own (#1582)', () => {
    // Maven inheritance: a child without an explicit <groupId> inherits the parent's.
    writeFileSync(
      join(dir, 'pom.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <parent>
    <groupId>com.example.platform</groupId>
    <artifactId>platform-parent</artifactId>
    <version>1.0.0</version>
  </parent>
  <artifactId>service</artifactId>
</project>`,
    )
    expect(detectBasePackage(dir)).toBe('com.example.platform')
  })
})
