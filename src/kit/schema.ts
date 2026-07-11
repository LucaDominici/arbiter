// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import { VALID_TML, VALID_GATES, VALID_STACKS } from './taxonomy.js'
export { VALID_STACKS } from './taxonomy.js'

// ─── Overlay cell variants ────────────────────────────────────────────────────

const reasonSchema = z.string().min(40, 'reason must be at least 40 characters')

const KitOverlayCellSchema = z.discriminatedUnion('kind', [
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

// ─── Derived per-stack cell (includes tool kind from matrix) ─────────────────

const DerivedCellSchema = z.union([KitOverlayCellSchema, z.object({ kind: z.literal('gap') })])

export type DerivedCell = z.infer<typeof DerivedCellSchema>

// ─── Catalog dimension ────────────────────────────────────────────────────────

const KitDimensionSchema = z.object({
  id: z.string().regex(/^N(0[1-9]|[1-6]\d|7[0-8])$/, 'id must be N01..N78'),
  name: z.string().min(1),
  tml: z.enum(VALID_TML),
  gate: z.enum(VALID_GATES),
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

// ─── Derived kit ─────────────────────────────────────────────────────────────

const DerivedKitDimSchema = KitDimensionSchema.extend({
  perStack: z.record(z.enum(VALID_STACKS), DerivedCellSchema),
})
export type DerivedKitDim = z.infer<typeof DerivedKitDimSchema>

export const DerivedKitSchema = z.array(DerivedKitDimSchema)
export type DerivedKit = z.infer<typeof DerivedKitSchema>
