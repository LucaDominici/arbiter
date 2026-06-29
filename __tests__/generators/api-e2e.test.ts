// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit test for src/generators/api-e2e.ts (#1365, INV-126).
// CANON-04: render test for src/templates/api-e2e/*.ejs suite templates.
// CANON-07: emits an executable runner (tests/api/run.sh) — chmod 0o755 verified.
// CANON-11: brownfield / skipIfExists test for the file-emitting generator.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateApiE2e } from '../../src/generators/api-e2e.js'
import type { Language } from '../../src/wizard/types.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

interface Manifest {
  archetype: string
  required: boolean
  suiteDir: string
  framework: string
  glob: string
  suiteCount?: number
}

function readManifest(d: string): Manifest {
  return JSON.parse(readFileSync(join(d, 'api-e2e.json'), 'utf-8'))
}

describe('generateApiE2e manifest (R1, CANON-05)', () => {
  it('emits api-e2e.json to project root for a service archetype', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    const result = generateApiE2e(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('api-e2e.json'))
    expect(manifestFile).toBeDefined()
    expect(existsSync(manifestFile!.path)).toBe(true)
  })

  it('emits api-e2e.json even for a non-service archetype (library)', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    generateApiE2e(config)
    expect(existsSync(join(dir, 'api-e2e.json'))).toBe(true)
  })

  it('respects dryRun — no file written to disk', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    generateApiE2e(config, { dryRun: true })
    expect(existsSync(join(dir, 'api-e2e.json'))).toBe(false)
  })
})

describe('generateApiE2e required flag (R2)', () => {
  it('required:true for backend-web-db (the service archetype)', () => {
    const config = makeConfig(dir, { language: 'go', archetype: 'backend-web-db' })
    generateApiE2e(config)
    expect(readManifest(dir).required).toBe(true)
  })

  it.each(['library', 'cli', 'data-pipeline', 'frontend-spa', 'embedded'] as const)(
    'required:false for non-service archetype %s',
    (archetype) => {
      const config = makeConfig(dir, { language: 'typescript', archetype })
      generateApiE2e(config)
      expect(readManifest(dir).required).toBe(false)
    },
  )
})

describe('generateApiE2e manifest suiteCount (#1706, probe≠writer)', () => {
  it('emits suiteCount=1 for a required service archetype (starter suite registered)', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    generateApiE2e(config)
    const m = readManifest(dir)
    expect(m.suiteCount).toBe(1)
  })

  it('emits suiteCount=1 for a required service archetype across stacks', () => {
    for (const language of ['typescript', 'go', 'java', 'kotlin', 'python'] as const) {
      const d = createTestProject(language)
      try {
        const config = makeConfig(d, { language, archetype: 'backend-web-db' })
        generateApiE2e(config)
        expect(readManifest(d).suiteCount).toBe(1)
      } finally {
        cleanupTestProject(d)
      }
    }
  })

  it('emits suiteCount=0 for a non-service archetype (no suite registered)', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    generateApiE2e(config)
    expect(readManifest(dir).suiteCount).toBe(0)
  })

  it('suiteCount is a number, not a stringified literal (#1706 shape)', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    generateApiE2e(config)
    const raw = readFileSync(join(dir, 'api-e2e.json'), 'utf-8')
    // EJS <%- suiteCount %> emits the bare numeric token (no quotes) — a string
    // would render as quotes and break the probe's typeof === 'number' check.
    expect(raw).toMatch(/"suiteCount":\s*\d+/)
    expect(raw).not.toMatch(/"suiteCount":\s*"/)
  })
})

describe('generateApiE2e service-archetype scaffolding (R3)', () => {
  it('emits a non-empty starter suite file under tests/api/ for backend-web-db', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    const result = generateApiE2e(config)
    const suite = result.files.find(
      (f) =>
        f.path.includes(join('tests', 'api')) &&
        !f.path.endsWith('run.sh') &&
        !f.path.endsWith('README.md'),
    )
    expect(suite).toBeDefined()
    expect(readFileSync(suite!.path, 'utf-8').length).toBeGreaterThan(50)
  })

  it('emits tests/api/run.sh runner with a bash shebang', () => {
    const config = makeConfig(dir, { language: 'go', archetype: 'backend-web-db' })
    generateApiE2e(config)
    const runner = join(dir, 'tests', 'api', 'run.sh')
    expect(existsSync(runner)).toBe(true)
    expect(readFileSync(runner, 'utf-8')).toMatch(/#!\/usr\/bin\/env bash|#!\/bin\/bash/)
  })

  it('emits tests/api/README.md documenting the live-binary contract', () => {
    const config = makeConfig(dir, { language: 'python', archetype: 'backend-web-db' })
    generateApiE2e(config)
    expect(existsSync(join(dir, 'tests', 'api', 'README.md'))).toBe(true)
  })

  it('manifest.glob targets tests/api', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    generateApiE2e(config)
    expect(readManifest(dir).glob.startsWith('tests/api')).toBe(true)
  })
})

describe('generateApiE2e non-service archetype (R4)', () => {
  it('does NOT emit a suite or runner for a library', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    generateApiE2e(config)
    expect(existsSync(join(dir, 'tests', 'api', 'run.sh'))).toBe(false)
  })
})

describe('generateApiE2e per-stack suite (R5, CANON-04)', () => {
  it.each([
    ['typescript', /supertest|request\(/i],
    ['go', /httptest|net\/http|http\.Get/i],
    ['java', /RestAssured|given\(\)/i],
    ['kotlin', /RestAssured|given\(\)/i],
    ['python', /httpx|requests\.|TestClient/i],
  ] as Array<[Language, RegExp]>)(
    'emits a %s suite that asserts on a live HTTP response',
    (language, marker) => {
      const d = createTestProject(language)
      try {
        const config = makeConfig(d, { language, archetype: 'backend-web-db' })
        const result = generateApiE2e(config)
        const suite = result.files.find(
          (f) =>
            f.path.includes(join('tests', 'api')) &&
            !f.path.endsWith('run.sh') &&
            !f.path.endsWith('README.md'),
        )!
        expect(readFileSync(suite.path, 'utf-8')).toMatch(marker)
      } finally {
        cleanupTestProject(d)
      }
    },
  )
})

describe('generateApiE2e runner permissions (R6, CANON-07)', () => {
  it('tests/api/run.sh is chmod 0o755', () => {
    const config = makeConfig(dir, { language: 'go', archetype: 'backend-web-db' })
    generateApiE2e(config)
    const mode = statSync(join(dir, 'tests', 'api', 'run.sh')).mode & 0o777
    expect(mode).toBe(0o755)
  })
})

describe('generateApiE2e brownfield re-init (R7, CANON-11)', () => {
  it('does not overwrite an existing api-e2e.json', () => {
    const custom = JSON.stringify(
      { archetype: 'backend-web-db', required: true, custom: 1 },
      null,
      2,
    )
    writeFileSync(join(dir, 'api-e2e.json'), custom)
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    generateApiE2e(config)
    expect(readFileSync(join(dir, 'api-e2e.json'), 'utf-8')).toBe(custom)
  })

  it('result manifest action is "skipped" when api-e2e.json already exists', () => {
    writeFileSync(join(dir, 'api-e2e.json'), '{}')
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    const result = generateApiE2e(config)
    const manifestFile = result.files.find((f) => f.path.endsWith('api-e2e.json'))
    expect(manifestFile?.action).toBe('skipped')
  })
})
