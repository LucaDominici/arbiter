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
    expect(result.files.length).toBe(1)
    expect(result.files[0]?.path).toContain('ApplicationModulesTest.java')
    expect(result.files[0]?.path).toContain('modulith')
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
    expect(result.files.length).toBe(1)
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
    expect(result.files.length).toBe(1)
  })
})
