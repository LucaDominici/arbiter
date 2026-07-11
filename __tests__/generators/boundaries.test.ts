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
  it('emits .eslintrc-boundaries.cjs and scripts/check-boundaries.mjs for typescript + hexagonal', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      architectureStyle: 'hexagonal',
    })
    const result = generateEslintBoundaries(config)
    expect(result.files.length).toBe(2)
    expect(result.files[0].path).toContain('.eslintrc-boundaries.cjs')
    expect(result.files[0].action).toBe('created')
    expect(result.files[1].path).toContain('check-boundaries.mjs')
    expect(result.files[1].action).toBe('created')
    expect(existsSync(result.files[0].path)).toBe(true)
    expect(existsSync(result.files[1].path)).toBe(true)
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
