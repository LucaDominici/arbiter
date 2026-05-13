import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
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
