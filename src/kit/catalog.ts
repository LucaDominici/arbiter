// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KitCatalogSchema, type KitCatalog } from './schema.js'

/**
 * Resolve a kit runtime-data file (catalog.json / derived.json) relative to the
 * compiled module's own directory. In the dev tree this is `src/kit/<file>`; in a
 * published install it is `dist/kit/<file>` — the JSON is co-located with the
 * emitted `.js` by the build step. Resolving module-adjacent (rather than pinning
 * `../../../src/kit`) is what makes `arbiter kit` work in an npm/npx install where
 * `src/` never ships (#1575). Callers in other modules import this so they all
 * agree on the single kit-data directory regardless of where they live.
 */
export function kitDataPath(file: string): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), file)
}

function loadCatalogFromDisk(): KitCatalog {
  return KitCatalogSchema.parse(JSON.parse(readFileSync(kitDataPath('catalog.json'), 'utf-8')))
}

let _catalog: KitCatalog | null = null

export function loadCatalog(): KitCatalog {
  if (!_catalog) _catalog = loadCatalogFromDisk()
  return _catalog
}
