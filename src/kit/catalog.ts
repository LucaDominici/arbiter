// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KitCatalogSchema, type KitCatalog, type KitDimension } from './schema.js'
import type { TML, Gate } from './taxonomy.js'

function loadCatalogFromDisk(): KitCatalog {
  const catalogPath = resolve(fileURLToPath(import.meta.url), '../../..', 'src/kit/catalog.json')
  return KitCatalogSchema.parse(JSON.parse(readFileSync(catalogPath, 'utf-8')))
}

let _catalog: KitCatalog | null = null

export function loadCatalog(): KitCatalog {
  if (!_catalog) _catalog = loadCatalogFromDisk()
  return _catalog
}

export function findById(id: string): KitDimension | undefined {
  return loadCatalog().find((d) => d.id === id)
}

export function byTml(tml: TML): KitDimension[] {
  return loadCatalog().filter((d) => d.tml === tml)
}

export function byGate(gate: Gate): KitDimension[] {
  return loadCatalog().filter((d) => d.gate === gate)
}
