// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

// ── Recipe loader tests (#546) ────────────────────────────────────────────────

const FIXTURE_PATH = new URL('../fixtures/recipes/library-typescript.json', import.meta.url)
  .pathname

describe('loadRecipe — local file (#546)', () => {
  it('returns parsed fields from a valid local recipe file', async () => {
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    const result = await loadRecipe(FIXTURE_PATH)
    expect(result.tools).toEqual(['claude', 'codex'])
    expect(result.governanceLevel).toBe('L2')
    expect(result.language).toBe('typescript')
    expect(result.archetype).toBe('library')
  })

  it('accepts file:// URL prefix', async () => {
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    const result = await loadRecipe(`file://${FIXTURE_PATH}`)
    expect(result.tools).toContain('claude')
  })

  it('partial recipe: fields not in recipe are absent from result', async () => {
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    const result = await loadRecipe(FIXTURE_PATH)
    // enableSecurityScanning is present in fixture → should be present
    expect(result).toHaveProperty('enableSecurityScanning', false)
    // framework is not present in fixture → should be absent (undefined)
    expect(result).not.toHaveProperty('framework')
  })

  it('returns all fields of a valid local recipe', async () => {
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    const result = await loadRecipe(FIXTURE_PATH)
    expect(result.governanceLevel).toBe('L2')
    expect(typeof result.enableDebtGates).toBe('boolean')
  })
})

describe('loadRecipe — validation (#546)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-recipe-test-'))
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('throws a validation error with path for malformed JSON', async () => {
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ not valid json }')
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(bad)).rejects.toThrow()
  })

  it('throws a ZodError for invalid field value (bad governance level)', async () => {
    const bad = join(dir, 'bad-level.json')
    writeFileSync(bad, JSON.stringify({ tools: ['claude'], governanceLevel: 'L9' }))
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(bad)).rejects.toThrow()
  })

  it('throws a ZodError for unknown tool name', async () => {
    const bad = join(dir, 'bad-tool.json')
    writeFileSync(bad, JSON.stringify({ tools: ['unknown-tool'] }))
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(bad)).rejects.toThrow()
  })

  it('rejects oversized recipe (> 256 KB)', async () => {
    const big = join(dir, 'big.json')
    // Write >256 KB of JSON (pad with a large string key)
    const oversized = JSON.stringify({ tools: ['claude'], _pad: 'x'.repeat(270_000) })
    writeFileSync(big, oversized)
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(big)).rejects.toThrow(/size/i)
  })
})

describe('loadRecipe — sha256 verification (#546)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-recipe-sha-'))
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('passes when sha256 matches file content', async () => {
    const content = readFileSync(FIXTURE_PATH)
    const hash = createHash('sha256').update(content).digest('hex')
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(FIXTURE_PATH, { sha256: hash })).resolves.toBeTruthy()
  })

  it('throws when sha256 does not match', async () => {
    const wrongHash = 'a'.repeat(64)
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(FIXTURE_PATH, { sha256: wrongHash })).rejects.toThrow(
      /sha256|checksum/i,
    )
  })
})

describe('loadRecipe — HTTPS guard (#546)', () => {
  it('rejects http:// URLs (non-HTTPS)', async () => {
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe('http://example.com/recipe.json')).rejects.toThrow(/https/i)
  })
})

describe('loadRecipe — HTTPS fetch (#546)', () => {
  const VALID_URL = 'https://example.com/recipe.json'

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches and parses a valid HTTPS recipe', async () => {
    const fixture = readFileSync(FIXTURE_PATH, 'utf-8')
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(fixture, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    const result = await loadRecipe(VALID_URL)
    expect(result.language).toBe('typescript')
    expect(result.governanceLevel).toBe('L2')
  })

  it('throws when server returns 404', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }))
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(VALID_URL)).rejects.toThrow(/404/)
  })

  it('throws when server returns 500', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('Error', { status: 500 }))
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(VALID_URL)).rejects.toThrow(/500/)
  })

  it('throws on redirect (3xx)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 301, headers: { location: 'https://other.example.com/' } }),
    )
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(VALID_URL)).rejects.toThrow(/redirect/i)
  })

  it('throws when response body is not valid JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('this is not json', { status: 200 }))
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(VALID_URL)).rejects.toThrow()
  })

  it('throws when Content-Length exceeds 256 KB', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(300 * 1024) },
      }),
    )
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(VALID_URL)).rejects.toThrow(/size|limit/i)
  })

  it('wraps fetch network errors', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const { loadRecipe } = await import('../../src/recipes/loader.js')
    await expect(loadRecipe(VALID_URL)).rejects.toThrow()
  })
})
