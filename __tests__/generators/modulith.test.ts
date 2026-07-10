// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateModulith } from '../../src/generators/modulith.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    language: 'java',
    buildTool: 'maven',
    targetDir: '',
    projectName: 'test-service',
    governanceLevel: 'L2',
    archetype: 'backend-web-db',
    architectureStyle: 'hexagonal',
    useGitHub: true,
    basePackage: 'com.example',
    kitEnabled: true,
    ...overrides,
  } as ProjectConfig
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-modulith-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('generateModulith — Spring Boot project (kitEnabled=true)', () => {
  it('emits ApplicationModulesTest.java for java language', () => {
    const config = makeConfig({ targetDir: tmpDir })
    const result = generateModulith(config)
    // #1886: ApplicationModulesTest.java + the Maven dependency-setup doc (default
    // buildTool here is 'maven') — the test alone would not compile otherwise.
    expect(result.files.length).toBe(2)
    const testFile = result.files.find((f) => f.path.endsWith('ApplicationModulesTest.java'))
    expect(testFile).toBeDefined()
    expect(testFile!.path).toContain('modulith')
  })

  it('uses basePackage in file path', () => {
    const config = makeConfig({ targetDir: tmpDir, basePackage: 'org.demo.service' })
    const result = generateModulith(config)
    expect(result.files[0]?.path).toContain('org/demo/service/modulith')
  })

  it('file content contains ApplicationModules.of()', () => {
    const config = makeConfig({ targetDir: tmpDir })
    const result = generateModulith(config)
    const content = readFileSync(result.files[0]!.path, 'utf8')
    expect(content).toContain('ApplicationModules.of(')
    expect(content).toContain('modules.verify()')
    expect(content).toContain('com.example')
  })
})

describe('generateModulith — Spring Boot detected via pom.xml', () => {
  it('emits for java project with spring-boot-starter in pom.xml', () => {
    writeFileSync(
      join(tmpDir, 'pom.xml'),
      '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>',
    )
    const config = makeConfig({ targetDir: tmpDir, kitEnabled: false })
    const result = generateModulith(config)
    expect(result.files.length).toBe(2) // ApplicationModulesTest.java + Maven setup doc (#1886)
  })

  it('skips for java project without spring-boot in pom.xml and kitEnabled=false', () => {
    writeFileSync(join(tmpDir, 'pom.xml'), '<project><groupId>org.example</groupId></project>')
    const config = makeConfig({ targetDir: tmpDir, kitEnabled: false })
    const result = generateModulith(config)
    expect(result.files.length).toBe(0)
  })
})

describe('generateModulith — non-java stacks', () => {
  it('skips for typescript projects', () => {
    const config = makeConfig({ targetDir: tmpDir, language: 'typescript', kitEnabled: true })
    const result = generateModulith(config)
    expect(result.files.length).toBe(0)
  })

  it('skips for go projects', () => {
    const config = makeConfig({ targetDir: tmpDir, language: 'go', kitEnabled: true })
    const result = generateModulith(config)
    expect(result.files.length).toBe(0)
  })
})

describe('generateModulith — multi-language project', () => {
  it('emits for multi with kitEnabled', () => {
    mkdirSync(join(tmpDir, 'backend'))
    const config = makeConfig({ targetDir: tmpDir, language: 'multi', kitEnabled: true })
    const result = generateModulith(config)
    expect(result.files.length).toBe(2) // ApplicationModulesTest.java + Maven setup doc (#1886)
  })
})

// #1886: the emitted ApplicationModulesTest.java imports
// org.springframework.modulith.core.ApplicationModules, which nothing put on the
// classpath — `mvn test` / `./gradlew test` failed to compile for EVERY detected
// Spring Boot Java/Kotlin project. Verify the dependency is actually wired (Gradle)
// or at minimum documented (Maven), mirroring archunit.ts's proven pattern.
describe('generateModulith — dependency wiring (#1886)', () => {
  it('Gradle: emits gradle/modulith-deps.gradle with the spring-modulith test dependency', () => {
    writeFileSync(join(tmpDir, 'build.gradle'), 'plugins { id "java" }')
    const config = makeConfig({ targetDir: tmpDir, buildTool: 'gradle' })
    const result = generateModulith(config)
    const depsFile = result.files.find((f) => f.path.endsWith('modulith-deps.gradle'))
    expect(depsFile).toBeDefined()
    const content = readFileSync(depsFile!.path, 'utf8')
    expect(content).toContain('org.springframework.modulith:spring-modulith-starter-test')
  })

  it('Gradle: wires modulith-deps.gradle into the root build via apply(from=...)', () => {
    writeFileSync(join(tmpDir, 'build.gradle'), 'plugins { id "java" }')
    const config = makeConfig({ targetDir: tmpDir, buildTool: 'gradle' })
    generateModulith(config)
    const buildContent = readFileSync(join(tmpDir, 'build.gradle'), 'utf8')
    expect(buildContent).toContain("apply from: 'gradle/modulith-deps.gradle'")
  })

  it('Gradle Kotlin DSL: wires via build.gradle.kts', () => {
    writeFileSync(join(tmpDir, 'build.gradle.kts'), 'plugins { java }')
    const config = makeConfig({ targetDir: tmpDir, buildTool: 'gradle' })
    generateModulith(config)
    const buildContent = readFileSync(join(tmpDir, 'build.gradle.kts'), 'utf8')
    expect(buildContent).toContain('apply(from = "gradle/modulith-deps.gradle")')
  })

  it('Maven: emits docs/modulith-maven-setup.md instead of a .gradle file', () => {
    const config = makeConfig({ targetDir: tmpDir, buildTool: 'maven' })
    const result = generateModulith(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('modulith-deps.gradle'))).toBe(false)
    expect(paths.some((p) => p.endsWith('modulith-maven-setup.md'))).toBe(true)
    const doc = result.files.find((f) => f.path.endsWith('modulith-maven-setup.md'))
    const content = readFileSync(doc!.path, 'utf8')
    expect(content).toContain('org.springframework.modulith')
    expect(content).toContain('spring-modulith-starter-test')
  })

  it('does not wire a Gradle build script when none exists yet (no crash)', () => {
    const config = makeConfig({ targetDir: tmpDir, buildTool: 'gradle' })
    expect(() => generateModulith(config)).not.toThrow()
  })
})
