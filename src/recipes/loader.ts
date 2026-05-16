// SPDX-License-Identifier: Apache-2.0
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { RecipeSchema, type Recipe } from './schema.js'

const MAX_BYTES = 256 * 1024 // 256 KB

export interface LoadRecipeOptions {
  sha256?: string
}

/**
 * Load and validate a recipe from a local path or https:// URL.
 * http:// URLs are rejected (supply-chain risk).
 * Files larger than 256 KB are rejected.
 * If sha256 is provided, the raw bytes are checked before parsing.
 */
export async function loadRecipe(source: string, opts: LoadRecipeOptions = {}): Promise<Recipe> {
  if (source.startsWith('http://')) {
    throw new Error(
      `Recipe URL must use https:// — plain http:// is not allowed (supply-chain risk). Got: ${source}`,
    )
  }

  const raw = source.startsWith('https://') ? await fetchRecipe(source) : readLocalRecipe(source)

  if (opts.sha256) {
    const actual = createHash('sha256').update(raw).digest('hex')
    if (actual !== opts.sha256) {
      throw new Error(
        `Recipe sha256 checksum mismatch.\n  expected: ${opts.sha256}\n  actual:   ${actual}`,
      )
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf-8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Recipe JSON parse error: ${msg}`, { cause: err })
  }

  const result = RecipeSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Recipe validation failed:\n${issues}`)
  }

  return result.data
}

function readLocalRecipe(source: string): Buffer {
  const filePath = source.startsWith('file://') ? new URL(source).pathname : source
  const stat = statSync(filePath)
  if (stat.size > MAX_BYTES) {
    throw new Error(
      `Recipe file size ${stat.size} bytes exceeds limit of ${MAX_BYTES} bytes (256 KB). Reduce the recipe file size.`,
    )
  }
  return readFileSync(filePath)
}

async function fetchRecipe(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, 10_000)

  let response: Response
  let buf: Buffer
  try {
    response = await fetch(url, { signal: controller.signal, redirect: 'manual' })

    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        `Recipe URL was redirected — supply the final HTTPS URL directly. Got redirect from: ${url}`,
      )
    }

    if (!response.ok) {
      throw new Error(`Recipe fetch returned HTTP ${response.status}: ${url}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength !== null && parseInt(contentLength, 10) > MAX_BYTES) {
      throw new Error(
        `Recipe response Content-Length ${contentLength} bytes exceeds limit of ${MAX_BYTES} bytes (256 KB).`,
      )
    }

    buf = Buffer.from(await response.arrayBuffer())
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Recipe')) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Recipe fetch failed: ${msg}`, { cause: err })
  } finally {
    clearTimeout(timeout)
  }

  if (buf.length > MAX_BYTES) {
    throw new Error(
      `Recipe response body size ${buf.length} bytes exceeds limit of ${MAX_BYTES} bytes (256 KB).`,
    )
  }
  return buf
}
