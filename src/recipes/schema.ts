// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

// #2367 (ADR-119): mirrors the narrowed `AiTool` union — a recipe can only ask
// for tools arbiter actually emits for.
const AiToolSchema = z.enum(['claude', 'codex'])

const GovernanceLevelSchema = z.enum(['L1', 'L2', 'L3', 'L4'])

const LanguageSchema = z.enum(['typescript', 'java', 'kotlin', 'rust', 'python', 'go', 'multi'])

const ArchetypeSchema = z.enum([
  'backend-web-db',
  'cli',
  'library',
  'data-pipeline',
  'frontend-spa',
  'embedded',
])

const ArchitectureStyleSchema = z.enum(['hexagonal', 'layered', 'modular-monolith', 'none'])

// #1317: database engine axis. Mirrors ProjectConfig.databaseEngine (wizard/types.ts)
// EXTENDED with 'none' (no database). Canonical spelling 'postgresql' (NOT 'postgres').
const DatabaseEngineSchema = z.enum(['postgresql', 'mysql', 'mongodb', 'sqlite', 'other', 'none'])

const ContractTypeSchema = z.enum([
  'rest-owned',
  'rest-public',
  'graphql',
  'grpc',
  'message-queue',
  'none',
])

const LaneSchema = z.enum(['frontend', 'backend', 'docs'])

const DecompositionBackendSchema = z.enum(['github', 'markdown'])

/**
 * Partial subset of ProjectConfig fields that a recipe may pre-configure.
 * Missing fields cause the wizard to prompt.
 */
export const RecipeSchema = z.object({
  tools: z.array(AiToolSchema).min(1).optional(),
  governanceLevel: GovernanceLevelSchema.optional(),
  language: LanguageSchema.optional(),
  framework: z.string().nullable().optional(),
  archetype: ArchetypeSchema.optional(),
  architectureStyle: ArchitectureStyleSchema.optional(),
  useGitHub: z.boolean().optional(),
  isMultiTenant: z.boolean().optional(),
  hasDatabase: z.boolean().optional(),
  hasPublicApi: z.boolean().optional(),
  // #1317: database engine — extended with 'none'. hasDatabase stays derivable
  // (hasDatabase = databaseEngine != null && databaseEngine !== 'none').
  databaseEngine: DatabaseEngineSchema.optional(),
  // #1318.4: axis fields a recipe may pre-configure (otherwise the wizard prompts).
  contractType: ContractTypeSchema.optional(),
  lanes: z.array(LaneSchema).optional(),
  evidenceHarness: z.boolean().optional(),
  decomposition: z.object({ backend: DecompositionBackendSchema }).optional(),
  enableDebtGates: z.boolean().optional(),
  enableSuppressions: z.boolean().optional(),
  enableSecurityScanning: z.boolean().optional(),
  enableMutationTesting: z.boolean().optional(),
  enableContractTesting: z.boolean().optional(),
  enableSoloDevMode: z.boolean().optional(),
  enableMcpFallback: z.boolean().optional(),
  enableNoSkippedTests: z.boolean().optional(),
  // #1835: opt-in toolchain/workflow-inventory audit (scripts/audit-toolchain.mjs).
  enableAuditToolchain: z.boolean().optional(),
  // #1835 (Task B, #1825): collapsed 5-lane CI doctrine — previously had no public
  // activation path (no CLI flag, wizard prompt, recipe field, or preset).
  enableFiveLaneCi: z.boolean().optional(),
  // #1887-A: same class of bug — generators built, gated on the ProjectConfig
  // field, but no public activation path at all until this recipe field.
  enableCodeownersNotify: z.boolean().optional(),
  enableTaxonomy25d: z.boolean().optional(),
  enablePerfTesting: z.boolean().optional(),
  // #1887 (Finding-A residual): the 5 compliance doc-pack flags previously had
  // persistence + read-back but the ONLY activation path was `--preset
  // industrial-grade` — no individual recipe field. Same class of bug.
  enableRiskRegister: z.boolean().optional(),
  enableOperationsHandbook: z.boolean().optional(),
  enableIso27001Mapping: z.boolean().optional(),
  enableNis2Mapping: z.boolean().optional(),
  enableGdprMapping: z.boolean().optional(),
  // #1261: ship-autonomy axis (ADR-093 §4) — the non-interactive override for
  // `automation.autonomy` (init --yes/--json never prompts; default is L0).
  // #1306 (ADR-094 §Decision.4): the orchestration prefs are recipe-settable too
  // (optional — absent ⇒ derived per collaboration mode / governance level).
  // #2329 — .strict(): a removed or misspelled automation key must be REJECTED, not
  // silently stripped by zod and then ignored (accept-then-ignore is the worse bug).
  automation: z
    .object({
      autonomy: z.enum(['L0', 'L1', 'L2', 'L3']),
      maxParallelWorktrees: z.number().int().positive().optional(),
      defaultGateLevel: z.enum(['L1', 'L2']).optional(),
    })
    .strict()
    .optional(),
})

export type Recipe = z.infer<typeof RecipeSchema>
