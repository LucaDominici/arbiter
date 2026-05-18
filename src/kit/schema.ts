// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'

// ─── Overlay cell variants ────────────────────────────────────────────────────

const reasonSchema = z.string().min(40, 'reason must be at least 40 characters')

export const KitOverlayCellSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tool'),
    tool: z.string().min(1),
    matrixCategory: z.string().min(1),
  }),
  z.object({
    kind: z.literal('equivalent'),
    arbiterSlot: z.string().min(1),
    reason: reasonSchema,
  }),
  z.object({
    kind: z.literal('na-by-archetype'),
    archetypes: z.array(z.string()).min(1),
    reason: reasonSchema,
  }),
  z.object({
    kind: z.literal('na-by-paradigm'),
    reason: reasonSchema,
  }),
  z
    .object({
      kind: z.literal('gap'),
      suggestedTool: z.string().optional(),
      suggestedGenerator: z.string().optional(),
      followupIssue: z.number().int().positive().optional(),
      reason: reasonSchema,
    })
    .refine(
      (v) =>
        v.suggestedTool !== undefined ||
        v.suggestedGenerator !== undefined ||
        v.followupIssue !== undefined,
      {
        message:
          'gap cell must have at least one of: suggestedTool, suggestedGenerator, followupIssue',
      },
    ),
])

export type KitOverlayCell = z.infer<typeof KitOverlayCellSchema>

// ─── Derived per-stack cell (includes tool kind from matrix) ─────────────────

const DerivedCellSchema = z.union([KitOverlayCellSchema, z.object({ kind: z.literal('gap') })])

export type DerivedCell = z.infer<typeof DerivedCellSchema>

// ─── Catalog dimension ────────────────────────────────────────────────────────

const VALID_STACKS = ['java', 'typescript', 'python', 'go', 'rust'] as const
export type Stack = (typeof VALID_STACKS)[number]

const KitDimensionSchema = z.object({
  id: z.string().regex(/^N(0[1-9]|[1-6]\d|7[0-6])$/, 'id must be N01..N76'),
  name: z.string().min(1),
  tml: z.enum(['L1', 'L2', 'L3']),
  gate: z.enum(['BLOCKING', 'ADVISORY', 'REFERENCE']),
  categoryRef: z.string().min(1),
  archetypeGating: z.object({
    applies: z.array(z.string()),
    excludes: z.array(z.string()),
  }),
  conditionalFlag: z.string().optional(),
  invLink: z.string().optional(),
  generatorLink: z.string().optional(),
  kitThreshold: z.number().optional(),
  arbiterThreshold: z.number().optional(),
  requiresDbEngine: z.array(z.string()).optional(),
  status: z.enum(['covered', 'partial', 'missing-tracked', 'missing']),
  followupIssue: z.number().int().positive().optional(),
  note: z.string().optional(),
})

export type KitDimension = z.infer<typeof KitDimensionSchema>

export const KitCatalogSchema = z.array(KitDimensionSchema)
export type KitCatalog = z.infer<typeof KitCatalogSchema>

// ─── Overlay ──────────────────────────────────────────────────────────────────

export const KitOverlaySchema = z.record(z.string(), z.record(z.string(), KitOverlayCellSchema))
export type KitOverlay = z.infer<typeof KitOverlaySchema>

// ─── Category map ─────────────────────────────────────────────────────────────

export const KitCategoryMapSchema = z.record(z.string(), z.array(z.string()))
export type KitCategoryMap = z.infer<typeof KitCategoryMapSchema>

// ─── Derived kit ─────────────────────────────────────────────────────────────

const DerivedKitDimSchema = KitDimensionSchema.extend({
  perStack: z.record(z.enum(VALID_STACKS), DerivedCellSchema),
})
export type DerivedKitDim = z.infer<typeof DerivedKitDimSchema>

export const DerivedKitSchema = z.array(DerivedKitDimSchema)
export type DerivedKit = z.infer<typeof DerivedKitSchema>

// ─── normalizeMatrixCell ──────────────────────────────────────────────────────

// Compound tool names that must NOT be split
const KNOWN_COMPOUND_NAMES = new Set([
  '@cucumber/cucumber',
  'go test -cover',
  'pytest-playwright',
  'actions/attest-build-provenance + slsa-github-generator',
  'cosign sign / cosign sign-blob',
])

// Exported for cross-SSOT validation in __tests__/kit/normalize.test.ts.
// Not called at runtime — matrix cells are used verbatim by deriveKit().
export function normalizeMatrixCell(cell: string): string[] {
  if (cell === 'N/A' || cell.trim() === '') return []

  // Check exact compound match first
  if (KNOWN_COMPOUND_NAMES.has(cell.trim())) return [cell.trim()]

  // Split on separators: +, /, " + ", " / "
  const parts = cell.split(/\s*[+/]\s*/)
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      // Preserve known compound substrings
      for (const known of KNOWN_COMPOUND_NAMES) {
        if (p === known) return p
      }
      return p
    })
}

// ─── deriveKit (pure function used in tests) ──────────────────────────────────

function findMatrixCell(
  matrixCategories: string[],
  stack: string,
  matrix: Record<string, Record<string, string>>,
): DerivedCell | null {
  for (const cat of matrixCategories) {
    const raw = matrix[cat]?.[stack]
    if (raw === undefined) continue
    const tool = typeof raw === 'object' ? (raw as Record<string, string>).tool : raw
    if (tool !== undefined && tool !== 'N/A') {
      return { kind: 'tool', tool, matrixCategory: cat }
    }
  }
  return null
}

export function deriveKit(
  catalog: KitCatalog,
  overlay: KitOverlay,
  matrix: Record<string, Record<string, string>>,
  categoryMap: KitCategoryMap,
): DerivedKit {
  const stacks = VALID_STACKS

  return catalog.map((dim) => {
    const matrixCategories = categoryMap[dim.categoryRef] ?? []
    const perStack: Record<string, DerivedCell> = {}

    for (const stack of stacks) {
      const overlayCell = overlay[dim.id]?.[stack]
      if (overlayCell !== undefined) {
        perStack[stack] = overlayCell
        continue
      }
      perStack[stack] = findMatrixCell(matrixCategories, stack, matrix) ?? { kind: 'gap' }
    }

    return { ...dim, perStack }
  })
}
