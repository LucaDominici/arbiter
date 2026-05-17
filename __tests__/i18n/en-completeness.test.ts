import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = new URL('../../', import.meta.url).pathname
const EN_JSON_PATH = join(ROOT, 'src/i18n/en.json')

function loadEnJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(EN_JSON_PATH, 'utf-8')) as Record<string, unknown>
}

function hasKey(obj: Record<string, unknown>, key: string): boolean {
  const parts = key.split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return false
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur !== undefined
}

function walkTs(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walkTs(full, files)
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full)
    }
  }
  return files
}

function extractTKeys(src: string): string[] {
  const keys: string[] = []
  const pattern = /\b(?:t|tryT)\(\s*(['"])([^'"\n\r]+)\1/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(src)) !== null) {
    keys.push(m[2])
  }
  return keys
}

describe('en.json completeness', () => {
  const en = loadEnJson()
  const srcDir = join(ROOT, 'src')
  const tsFiles = walkTs(srcDir)

  const missing: Array<{ file: string; key: string }> = []

  for (const file of tsFiles) {
    const src = readFileSync(file, 'utf-8')
    const keys = extractTKeys(src)
    for (const key of keys) {
      if (!hasKey(en, key)) {
        missing.push({ file: relative(ROOT, file), key })
      }
    }
  }

  it('every t() key in src/ must exist in en.json', () => {
    if (missing.length > 0) {
      const report = missing.map(({ file, key }) => `  ${file}: "${key}"`).join('\n')
      expect.fail(`Missing keys in en.json:\n${report}`)
    }
  })
})
