import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateEslintBoundaries } from '../../src/generators/boundaries.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generateEslintBoundaries', () => {
  it('emits .eslintrc-boundaries.cjs, eslint.config.boundaries.mjs and scripts/check-boundaries.mjs for typescript + hexagonal (#2272)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      architectureStyle: 'hexagonal',
    })
    const result = generateEslintBoundaries(config)
    // #2272 (#1491-class fix): the gate runs the flat config (ESLint v9 removed
    // the legacy --no-eslintrc/-c loader) — the .cjs file is retained alongside
    // it for tooling that still reads eslintrc-format config, mirroring the
    // frontend-spa fix (#1127/#1491).
    expect(result.files.length).toBe(3)
    const byPath = (needle: string) => result.files.find((f) => f.path.includes(needle))
    expect(byPath('.eslintrc-boundaries.cjs')?.action).toBe('created')
    expect(byPath('eslint.config.boundaries.mjs')?.action).toBe('created')
    expect(byPath('check-boundaries.mjs')?.action).toBe('created')
    expect(existsSync(join(dir, '.eslintrc-boundaries.cjs'))).toBe(true)
    expect(existsSync(join(dir, 'eslint.config.boundaries.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'check-boundaries.mjs'))).toBe(true)
  })

  it('emitted check-boundaries.mjs runs the flat config in isolation, no legacy --no-eslintrc (#2272, #1491-class)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      architectureStyle: 'hexagonal',
    })
    generateEslintBoundaries(config)
    const content = readFileSync(join(dir, 'scripts', 'check-boundaries.mjs'), 'utf-8')
    expect(content).toContain("'--config'")
    expect(content).toContain('eslint.config.boundaries.mjs')
    expect(content).toContain("'--no-config-lookup'")
    // The legacy flag/file may still be mentioned in a comment (retained for other
    // tooling) — the invariant is that they are never passed to the eslint CLI
    // invocation (matches the B4 #1491 precedent in check-all.test.ts).
    expect(content).not.toContain("'--no-eslintrc'")
    expect(content).not.toContain("'-c', '.eslintrc-boundaries.cjs'")
  })

  it('eslint.config.boundaries.mjs contains the same element-types/external rules as the legacy .cjs (#2272)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      architectureStyle: 'hexagonal',
    })
    generateEslintBoundaries(config)
    const flat = readFileSync(join(dir, 'eslint.config.boundaries.mjs'), 'utf-8')
    expect(flat).toContain('boundaries/element-types')
    expect(flat).toContain('boundaries/external')
    expect(flat).toContain('domain')
    expect(flat).toContain('application')
    expect(flat).toContain('adapters')
    expect(flat).toContain('infrastructure')
    expect(flat).toContain('no-restricted-imports')
    expect(flat).toContain('no-restricted-globals')
    expect(flat).toContain('node:fs')
    expect(flat).toContain('window')
  })

  it('places .eslintrc-boundaries.cjs at project root', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      architectureStyle: 'hexagonal',
    })
    generateEslintBoundaries(config)
    expect(existsSync(join(dir, '.eslintrc-boundaries.cjs'))).toBe(true)
  })

  it('emitted config contains boundaries/element-types rule', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      architectureStyle: 'hexagonal',
    })
    generateEslintBoundaries(config)
    const content = readFileSync(join(dir, '.eslintrc-boundaries.cjs'), 'utf-8')
    expect(content).toContain('boundaries/element-types')
    expect(content).toContain('domain')
    expect(content).toContain('adapters')
    expect(content).toContain('infrastructure')
  })

  it('emitted config blocks browser globals in domain', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      architectureStyle: 'hexagonal',
    })
    generateEslintBoundaries(config)
    const content = readFileSync(join(dir, '.eslintrc-boundaries.cjs'), 'utf-8')
    expect(content).toContain('no-restricted-globals')
    expect(content).toContain('window')
    expect(content).toContain('document')
  })

  it('emitted config blocks Node built-ins in domain via no-restricted-imports', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      architectureStyle: 'hexagonal',
    })
    generateEslintBoundaries(config)
    const content = readFileSync(join(dir, '.eslintrc-boundaries.cjs'), 'utf-8')
    expect(content).toContain('no-restricted-imports')
    expect(content).toContain('node:fs')
  })

  it('returns no files for typescript + layered', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      architectureStyle: 'layered',
    })
    const result = generateEslintBoundaries(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns no files for typescript + none (default)', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    const result = generateEslintBoundaries(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns no files for java + hexagonal (language guard)', () => {
    const javaDir = createTestProject('java')
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        architectureStyle: 'hexagonal',
      })
      const result = generateEslintBoundaries(config)
      expect(result.files).toHaveLength(0)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('returns no files for rust + hexagonal (language guard)', () => {
    const rustDir = createTestProject('rust')
    try {
      const config = makeConfig(rustDir, {
        language: 'rust',
        architectureStyle: 'hexagonal',
      })
      const result = generateEslintBoundaries(config)
      expect(result.files).toHaveLength(0)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('honors skipIfExists when .eslintrc-boundaries.cjs already exists', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      architectureStyle: 'hexagonal',
    })
    const targetPath = join(dir, '.eslintrc-boundaries.cjs')
    writeFileSync(targetPath, '// existing content')
    const result = generateEslintBoundaries(config)
    expect(result.files[0].action).toBe('skipped')
    expect(readFileSync(targetPath, 'utf-8')).toBe('// existing content')
  })

  // ── frontend-spa (#158) ─────────────────────────────────────────────────────

  it('emits .eslintrc-frontend-spa.cjs + eslint.config.frontend-spa.mjs for typescript + frontend-spa (#158)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      archetype: 'frontend-spa',
    })
    const result = generateEslintBoundaries(config)
    // #1491-class fix: the gate runs the flat config (ESLint v9 removed the
    // legacy --no-eslintrc/-c loader) — the .cjs file is retained alongside it
    // for tooling that still reads eslintrc-format config.
    expect(result.files).toHaveLength(2)
    expect(result.files[0].path).toContain('.eslintrc-frontend-spa.cjs')
    expect(existsSync(join(dir, '.eslintrc-frontend-spa.cjs'))).toBe(true)
    expect(result.files[1].path).toContain('eslint.config.frontend-spa.mjs')
    expect(existsSync(join(dir, 'eslint.config.frontend-spa.mjs'))).toBe(true)
  })

  it('.eslintrc-frontend-spa.cjs contains FSD layers (#158)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      archetype: 'frontend-spa',
    })
    generateEslintBoundaries(config)
    const content = readFileSync(join(dir, '.eslintrc-frontend-spa.cjs'), 'utf-8')
    expect(content).toContain('features')
    expect(content).toContain('pages')
    expect(content).toContain('widgets')
    expect(content).toContain('entities')
    expect(content).toContain('shared')
  })

  it('does NOT emit hexagonal config for frontend-spa (#158)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      archetype: 'frontend-spa',
    })
    generateEslintBoundaries(config)
    expect(existsSync(join(dir, '.eslintrc-boundaries.cjs'))).toBe(false)
  })

  it('frontend-spa with non-typescript emits no files (#158)', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      archetype: 'frontend-spa',
    })
    const result = generateEslintBoundaries(config)
    expect(result.files).toHaveLength(0)
  })

  // ── framework-aware globs (#1127) ───────────────────────────────────────────

  it('react framework: boundaries/include contains .tsx and .jsx globs (#1127)', () => {
    generateEslintBoundaries(
      makeConfig(dir, {
        language: 'typescript',
        archetype: 'frontend-spa',
        frontend: { framework: 'react' },
      }),
    )
    const content = readFileSync(join(dir, '.eslintrc-frontend-spa.cjs'), 'utf-8')
    expect(content).toContain('.tsx')
    expect(content).toContain('.jsx')
  })

  it('react framework: boundaries/include does NOT contain .vue globs (#1127)', () => {
    generateEslintBoundaries(
      makeConfig(dir, {
        language: 'typescript',
        archetype: 'frontend-spa',
        frontend: { framework: 'react' },
      }),
    )
    const content = readFileSync(join(dir, '.eslintrc-frontend-spa.cjs'), 'utf-8')
    expect(content).not.toContain('.vue')
  })

  it('vue framework: boundaries/include contains .vue glob (#1127)', () => {
    generateEslintBoundaries(
      makeConfig(dir, {
        language: 'typescript',
        archetype: 'frontend-spa',
        frontend: { framework: 'vue' },
      }),
    )
    const content = readFileSync(join(dir, '.eslintrc-frontend-spa.cjs'), 'utf-8')
    expect(content).toContain('.vue')
  })

  it('vue framework: boundaries/include does NOT contain .tsx glob (#1127)', () => {
    generateEslintBoundaries(
      makeConfig(dir, {
        language: 'typescript',
        archetype: 'frontend-spa',
        frontend: { framework: 'vue' },
      }),
    )
    const content = readFileSync(join(dir, '.eslintrc-frontend-spa.cjs'), 'utf-8')
    expect(content).not.toContain('.tsx')
  })

  it('svelte framework: boundaries/include contains .svelte glob (#1127)', () => {
    generateEslintBoundaries(
      makeConfig(dir, {
        language: 'typescript',
        archetype: 'frontend-spa',
        frontend: { framework: 'svelte' },
      }),
    )
    const content = readFileSync(join(dir, '.eslintrc-frontend-spa.cjs'), 'utf-8')
    expect(content).toContain('.svelte')
  })

  it('svelte framework: boundaries/include does NOT contain .tsx glob (#1127)', () => {
    generateEslintBoundaries(
      makeConfig(dir, {
        language: 'typescript',
        archetype: 'frontend-spa',
        frontend: { framework: 'svelte' },
      }),
    )
    const content = readFileSync(join(dir, '.eslintrc-frontend-spa.cjs'), 'utf-8')
    expect(content).not.toContain('.tsx')
  })

  it('no frontend config: defaults to react-like (.tsx included, .vue absent) (#1127)', () => {
    generateEslintBoundaries(
      makeConfig(dir, {
        language: 'typescript',
        archetype: 'frontend-spa',
        // no frontend config
      }),
    )
    const content = readFileSync(join(dir, '.eslintrc-frontend-spa.cjs'), 'utf-8')
    expect(content).toContain('.tsx')
    expect(content).not.toContain('.vue')
  })
})
