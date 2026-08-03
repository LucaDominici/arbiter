// SPDX-License-Identifier: Apache-2.0
// Regression tests for #933: injectTestScripts must fire via registry even when
// enableDebtGates is false for typescript/multi projects.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRegistry, runGeneratorsFromRegistry } from '../../src/generators/registry.js'
import { makeConfig } from '../helpers.js'

const TEST_SCRIPTS = ['test:unit', 'test:contract', 'test:integration', 'test:behavioral'] as const
const TS_GATE_SCRIPTS = ['typecheck', 'lint', 'build'] as const

function makeTsProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-933-debt-scripts-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'test-project',
        version: '1.0.0',
        scripts: { build: 'tsc', test: 'vitest run', lint: 'eslint .' },
        devDependencies: { typescript: '^5.0.0' },
      },
      null,
      2,
    ) + '\n',
  )
  return dir
}

describe('#933 — registry injectTestScripts via runGeneratorsFromRegistry', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTsProjectDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('injects test:* scripts via registry when enableDebtGates=false and language=typescript', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: false,
      governanceLevel: 'L1',
    })
    const specs = buildRegistry(config)
    runGeneratorsFromRegistry(specs)

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>
    }
    for (const script of TEST_SCRIPTS) {
      expect(pkg.scripts[script], `missing ${script}`).toBeDefined()
      expect(pkg.scripts[script]).toContain('vitest')
    }
    for (const script of TS_GATE_SCRIPTS) {
      expect(pkg.scripts[script], `missing ${script}`).toBeDefined()
    }
  })

  it('injects test:* scripts via registry when enableDebtGates=false and language=multi', () => {
    const config = makeConfig(dir, {
      language: 'multi',
      enableDebtGates: false,
      governanceLevel: 'L1',
    })
    const specs = buildRegistry(config)
    runGeneratorsFromRegistry(specs)

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>
    }
    for (const script of TEST_SCRIPTS) {
      expect(pkg.scripts[script], `missing ${script}`).toBeDefined()
    }
  })

  it('debt-gates spec is enabled in registry for typescript regardless of enableDebtGates', () => {
    const configFalse = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: false,
      governanceLevel: 'L1',
    })
    const specs = buildRegistry(configFalse)
    const debtSpec = specs.find((s) => s.key === 'debt-gates')
    expect(debtSpec).toBeDefined()
    expect(debtSpec?.enabled).toBe(true)
  })

  it('debt-gates spec is enabled for non-TS language at L1 to emit the universal config-lint pair (#1546)', () => {
    // Since #1546 the spec is always-on: generateDebtGates emits the language-agnostic
    // .yamllint.yml + .shellcheckrc for EVERY archetype/level, then guards the
    // language-specific debt scaffold internally. So rust/go/java/kotlin at L1 now run
    // the generator (for the universal pair) even though their debt extras stay gated.
    const config = makeConfig(dir, {
      language: 'rust',
      enableDebtGates: false,
      governanceLevel: 'L1',
    })
    const specs = buildRegistry(config)
    const debtSpec = specs.find((s) => s.key === 'debt-gates')
    expect(debtSpec).toBeDefined()
    expect(debtSpec?.enabled).toBe(true)
  })
})
