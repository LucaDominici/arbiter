// SPDX-License-Identifier: Apache-2.0
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Catalog, CatalogRaw } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const cache = new Map<string, Catalog>()
let activeCatalog: Catalog | null = null

function flatten(obj: CatalogRaw, prefix = ''): Map<string, string> {
  const result = new Map<string, string>()
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      result.set(key, v)
    } else {
      for (const [sk, sv] of flatten(v, key)) {
        result.set(sk, sv)
      }
    }
  }
  return result
}

function readLocaleFile(loc: string): CatalogRaw | null {
  const path = join(__dirname, `${loc}.json`)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CatalogRaw
  } catch {
    process.stderr.write(`[arbiter i18n] malformed locale file: ${path}\n`)
    return null
  }
}

function buildLocaleChain(locale: string): string[] {
  if (!locale || locale === 'C' || locale === 'POSIX') return ['en']
  const chain: string[] = [locale]
  const noEncoding = locale.replace(/\..+$/, '')
  if (noEncoding !== locale) chain.push(noEncoding)
  const base = noEncoding.replace(/[_-].+$/, '')
  if (base !== noEncoding) chain.push(base)
  if (!chain.includes('en')) chain.push('en')
  return chain
}

export function loadCatalog(locale: string): Catalog {
  const cached = cache.get(locale)
  if (cached) return cached

  const chain = buildLocaleChain(locale)
  for (const loc of chain) {
    const raw = readLocaleFile(loc)
    if (raw) {
      const catalog: Catalog = flatten(raw)
      cache.set(locale, catalog)
      return catalog
    }
  }
  process.stderr.write(`[arbiter i18n] no locale file found for '${locale}' (chain exhausted)\n`)
  const fallback = flatten({})
  cache.set(locale, fallback)
  return fallback
}

export function resolveLocale(env: NodeJS.ProcessEnv): string {
  const raw = env['ARBITER_LOCALE'] || env['LC_ALL'] || env['LC_MESSAGES'] || env['LANG'] || 'en'
  if (!raw || raw === 'C' || raw === 'POSIX') return 'en'
  return raw
}

function getActiveCatalog(): Catalog {
  if (!activeCatalog) {
    activeCatalog = loadCatalog(resolveLocale(process.env))
  }
  return activeCatalog
}

export function t(key: string, params?: Record<string, string | number>): string {
  const catalog = getActiveCatalog()
  let value = catalog.get(key) ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replaceAll(`{${k}}`, String(v))
    }
  }
  return value
}

export function resetForTest(): void {
  activeCatalog = null
  cache.clear()
}
