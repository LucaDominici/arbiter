import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { renderTemplate } from '../../src/utils/render.js'
import { generateRoot } from '../../src/generators/root.js'
import { makeConfig } from '../helpers.js'
import type { Language } from '../../src/wizard/types.js'

function cfg(language: Language = 'typescript', overrides = {}) {
  return makeConfig('/tmp/test', { language, ...overrides })
}

describe('tsconfig.json.ejs (#170)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate(
      'root/tsconfig.json.ejs',
      cfg() as unknown as Record<string, unknown>,
    )
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('renders valid JSON', () => {
    const out = renderTemplate(
      'root/tsconfig.json.ejs',
      cfg() as unknown as Record<string, unknown>,
    )
    expect(() => JSON.parse(out)).not.toThrow()
  })

  it('contains strict: true', () => {
    const out = renderTemplate(
      'root/tsconfig.json.ejs',
      cfg() as unknown as Record<string, unknown>,
    )
    const parsed = JSON.parse(out)
    expect(parsed.compilerOptions?.strict).toBe(true)
  })

  it('contains types: [node] for TS6 compatibility', () => {
    const out = renderTemplate(
      'root/tsconfig.json.ejs',
      cfg() as unknown as Record<string, unknown>,
    )
    const parsed = JSON.parse(out)
    expect(parsed.compilerOptions?.types).toContain('node')
  })

  it('contains skipLibCheck: true', () => {
    const out = renderTemplate(
      'root/tsconfig.json.ejs',
      cfg() as unknown as Record<string, unknown>,
    )
    const parsed = JSON.parse(out)
    expect(parsed.compilerOptions?.skipLibCheck).toBe(true)
  })
})

describe('generateRoot tsconfig emission (#170)', () => {
  it('emits tsconfig.json for TypeScript projects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-root-ts-'))
    try {
      const config = cfg('typescript', { targetDir: dir })
      const result = generateRoot(config)
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('tsconfig.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not emit tsconfig.json for non-TypeScript projects', () => {
    for (const lang of ['java', 'rust', 'go', 'python'] as Language[]) {
      const dir = mkdtempSync(join(tmpdir(), `arbiter-root-${lang}-`))
      try {
        const config = cfg(lang, { targetDir: dir })
        const result = generateRoot(config)
        const paths = result.files.map((f) => f.path)
        expect(paths.some((p) => p.endsWith('tsconfig.json'))).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('uses skipIfExists so existing tsconfig is preserved (brownfield)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-root-brownfield-'))
    try {
      const existing = JSON.stringify({ compilerOptions: { target: 'ES5' } })
      writeFileSync(join(dir, 'tsconfig.json'), existing)
      const config = cfg('typescript', { targetDir: dir })
      const result = generateRoot(config)
      const tsEntry = result.files.find((f) => f.path.endsWith('tsconfig.json'))
      expect(tsEntry?.action).toBe('skipped')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// RED tests: strictnessTier gating for tsconfig + plain Rust (#1148 Slice D)

describe('strictnessTier tsconfig gating (#1148)', () => {
  it('practical: tsconfig does NOT contain noUncheckedIndexedAccess [RED #1148]', () => {
    const out = renderTemplate('root/tsconfig.json.ejs', {
      ...cfg(),
      strictnessTier: 'practical',
    } as unknown as Record<string, unknown>)
    const parsed = JSON.parse(out)
    expect(parsed.compilerOptions?.noUncheckedIndexedAccess).toBeUndefined()
  })

  it('pedantic: tsconfig DOES contain noUncheckedIndexedAccess: true [#1148]', () => {
    const out = renderTemplate('root/tsconfig.json.ejs', {
      ...cfg(),
      strictnessTier: 'pedantic',
    } as unknown as Record<string, unknown>)
    const parsed = JSON.parse(out)
    expect(parsed.compilerOptions?.noUncheckedIndexedAccess).toBe(true)
  })

  it('practical tsconfig renders valid JSON [#1148]', () => {
    const out = renderTemplate('root/tsconfig.json.ejs', {
      ...cfg(),
      strictnessTier: 'practical',
    } as unknown as Record<string, unknown>)
    expect(() => JSON.parse(out)).not.toThrow()
  })
})

describe('strictnessTier plain Rust clippy.toml (#1148)', () => {
  it('pedantic non-hexagonal Rust: generateRoot emits clippy.toml [RED #1148]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-root-rust-'))
    try {
      const config = cfg('rust', { targetDir: dir, strictnessTier: 'pedantic' })
      const result = generateRoot(config)
      expect(result.files.some((f) => f.path.endsWith('clippy.toml'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('practical non-hexagonal Rust: generateRoot does NOT emit clippy.toml [#1148]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-root-rust-'))
    try {
      const config = cfg('rust', { targetDir: dir, strictnessTier: 'practical' })
      const result = generateRoot(config)
      expect(result.files.some((f) => f.path.endsWith('clippy.toml'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('pedantic non-hexagonal Rust: emitted clippy.toml contains expected lints [#1148]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-root-rust-content-'))
    try {
      const config = cfg('rust', { targetDir: dir, strictnessTier: 'pedantic' })
      generateRoot(config)
      const content = readFileSync(join(dir, 'clippy.toml'), 'utf-8')
      expect(content).not.toContain('<%')
      expect(content).not.toContain('%>')
      expect(content).toContain('pedantic = "warn"')
      expect(content).toContain('unwrap_used = "warn"')
      expect(content).toContain('panic = "warn"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('pedantic hexagonal Rust: generateRoot does NOT emit clippy.toml (owned by rust-boundaries) [#1148]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-root-rust-hex-'))
    try {
      const config = cfg('rust', {
        targetDir: dir,
        strictnessTier: 'pedantic',
        architectureStyle: 'hexagonal',
      })
      const result = generateRoot(config)
      expect(result.files.some((f) => f.path.endsWith('clippy.toml'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
