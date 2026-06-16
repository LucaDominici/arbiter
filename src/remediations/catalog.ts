// SPDX-License-Identifier: Apache-2.0
// Remediation playbook catalog loader + validator (#1422).
//
// The catalog (playbook-catalog.json) maps a gold-audit check `type` (+ optional `dimension`) to a
// remediation recipe template. It is validated AT LOAD against a zod schema PLUS the STRUCTURAL
// anti-fake-green invariants (red-team amendments, BLOCKING):
//   1. a `manual`-typed entry MUST be `process` kind with `expectedVerdict: 'NV'` (no code recipe);
//   2. a `doc-set` entry MUST NOT claim `expectedVerdict: 'Y'` (presence ≠ closure — scaffold is P);
//   3. only a `process` entry may use `expectedVerdict: 'NV'` (NV means "code can't verify").
// A future edit that violates any of these throws at load → fails tests/gate, never ships silently.

import { z } from 'zod'
import catalogJson from './playbook-catalog.json' with { type: 'json' }
import type { PlaybookCatalog, CatalogEntry } from './types.js'

const KindSchema = z.enum(['doc-set', 'test', 'config', 'process'])
const TypeSchema = z.enum(['file_exists', 'file_contains', 'count_matches', 'value', 'manual'])
const VerdictSchema = z.enum(['Y', 'P', 'NV'])

const EntrySchema = z.object({
  type: TypeSchema,
  dimension: z.string().min(1).optional(),
  kind: KindSchema,
  expectedVerdict: VerdictSchema,
  ssot: z.array(z.string().min(1)).min(1),
  rationale: z.string().min(1),
})

const CatalogSchema = z.object({
  version: z.string().min(1),
  byType: z.object({
    file_exists: EntrySchema,
    file_contains: EntrySchema,
    count_matches: EntrySchema,
    value: EntrySchema,
    manual: EntrySchema,
  }),
  overrides: z.record(z.string(), EntrySchema),
})

/** Enforce the structural anti-fake-green invariants on a single entry. Throws on violation. */
function assertHonest(key: string, e: CatalogEntry): void {
  if (e.type === 'manual') {
    if (e.kind !== 'process' || e.expectedVerdict !== 'NV') {
      throw new Error(
        `playbook-catalog: ${key} is type 'manual' but not a process/NV playbook ` +
          `(kind=${e.kind}, expectedVerdict=${e.expectedVerdict}) — a manual check cannot have a code recipe.`,
      )
    }
  }
  if (e.kind === 'doc-set' && e.expectedVerdict === 'Y') {
    throw new Error(
      `playbook-catalog: ${key} is a doc-set recipe claiming verdict 'Y' — a scaffold proves presence, ` +
        `not closure; doc-set recipes are 'P'.`,
    )
  }
  if (e.expectedVerdict === 'NV' && e.kind !== 'process') {
    throw new Error(
      `playbook-catalog: ${key} claims verdict 'NV' but kind is '${e.kind}' — NV (code cannot verify) ` +
        `is reserved for human-only process playbooks.`,
    )
  }
}

/** Validate a raw catalog object against the schema + structural invariants. Returns the typed catalog. */
export function validateCatalog(raw: unknown): PlaybookCatalog {
  const parsed = CatalogSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`playbook-catalog: schema validation failed — ${issues}`)
  }
  const cat = parsed.data
  for (const [t, entry] of Object.entries(cat.byType)) assertHonest(`byType.${t}`, entry)
  for (const [k, entry] of Object.entries(cat.overrides)) {
    assertHonest(`overrides.${k}`, entry)
    const want = entry.dimension ? `${entry.type}:${entry.dimension}` : entry.type
    if (k !== want) {
      throw new Error(
        `playbook-catalog: override key "${k}" disagrees with its entry (type=${entry.type}, ` +
          `dimension=${entry.dimension ?? '∅'}); expected key "${want}".`,
      )
    }
  }
  return cat
}

/** Load + validate the shipped catalog. Throws if the bundled JSON is malformed. */
export function loadCatalog(): PlaybookCatalog {
  return validateCatalog(catalogJson)
}

/**
 * Resolve the catalog entry for a gap: a (type,dimension) override wins over the type default.
 * Deterministic: the same gap always resolves to the same entry.
 */
export function entryForGap(
  catalog: PlaybookCatalog,
  type: CatalogEntry['type'],
  dimension: string,
): CatalogEntry {
  const override = catalog.overrides[`${type}:${dimension}`]
  return override ?? catalog.byType[type]
}
