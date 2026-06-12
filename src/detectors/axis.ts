// SPDX-License-Identifier: Apache-2.0
import type { Archetype, ArchitectureStyle, ContractType, Lane } from '../wizard/types.js'
import type { ArbiterConfig } from '../utils/config.js'
import { detectArchetypeHint } from './framework.js'
import { detectLanguage } from './language.js'
import { defaultContractType } from '../wizard/archetype-defaults.js'
import { detectLanes } from './lanes.js'

export const ARCHETYPE_DB_SET: ReadonlySet<Archetype> = new Set<Archetype>([
  'backend-web-db',
  'data-pipeline',
])

/** #1317: database engine union (shared by ProjectConfig + recipe schema). */
export type DatabaseEngine = 'postgresql' | 'mysql' | 'mongodb' | 'sqlite' | 'other' | 'none'

export interface AxisFields {
  archetype: Archetype
  architectureStyle: ArchitectureStyle
  isMultiTenant: boolean
  hasDatabase: boolean
  databaseEngine: DatabaseEngine
  hasPublicApi: boolean
  contractType: ContractType
  lanes: Lane[]
}

/**
 * Subset of {@link AxisFields} derivable from `archetype` alone (no filesystem
 * detection). Used by both {@link resolveAxisFields} and `runConfigure` (#504)
 * to cascade derived fields on archetype changes.
 *
 * Precedence: any field already explicit on `stored` wins; otherwise we derive
 * from the archetype. This preserves user overrides while ensuring archetype
 * changes refresh the previously-implicit derived fields.
 *
 * (`AxisDefaults` is intentionally non-exported — internal helper type only;
 * the only public surface is the function itself.)
 */
type AxisDefaults = Omit<AxisFields, 'archetype' | 'lanes'>

type AxisStoredLike = Partial<AxisDefaults>

function pickHasPublicApi(
  stored: AxisStoredLike | null | undefined,
  archetype: Archetype,
): boolean {
  return stored?.hasPublicApi ?? archetype === 'backend-web-db'
}

/**
 * #1317: derive the (databaseEngine, hasDatabase) pair so the two never diverge.
 * Precedence:
 *  1. explicit `databaseEngine` wins (engine is the source of truth).
 *  2. else legacy `hasDatabase:true` ⇒ 'postgresql'; `hasDatabase:false` ⇒ 'none'.
 *  3. else fall back to the archetype DB-set ('postgresql' / 'none').
 * `hasDatabase` is then derived as `engine !== 'none'`, guaranteeing coherence.
 */
function deriveDatabase(
  stored: AxisStoredLike | null | undefined,
  archetype: Archetype,
): { databaseEngine: DatabaseEngine; hasDatabase: boolean } {
  let engine: DatabaseEngine
  if (stored?.databaseEngine != null) {
    engine = stored.databaseEngine
  } else if (stored?.hasDatabase != null) {
    engine = stored.hasDatabase ? 'postgresql' : 'none'
  } else {
    engine = ARCHETYPE_DB_SET.has(archetype) ? 'postgresql' : 'none'
  }
  return { databaseEngine: engine, hasDatabase: engine !== 'none' }
}

export function deriveAxisDefaults(
  stored: AxisStoredLike | null | undefined,
  archetype: Archetype,
): AxisDefaults {
  const hasPublicApi = pickHasPublicApi(stored, archetype)
  const { databaseEngine, hasDatabase } = deriveDatabase(stored, archetype)
  return {
    architectureStyle: stored?.architectureStyle ?? 'none',
    isMultiTenant: stored?.isMultiTenant ?? false,
    hasDatabase,
    databaseEngine,
    hasPublicApi,
    contractType: stored?.contractType ?? defaultContractType(archetype, hasPublicApi),
  }
}

function resolveLanes(stored: ArbiterConfig | null, targetDir: string): Lane[] {
  return stored?.lanes ?? detectLanes(targetDir).lanes
}

export function resolveAxisFields(
  stored: ArbiterConfig | null,
  targetDir: string,
  language: ReturnType<typeof detectLanguage>,
  framework: string | null,
): AxisFields {
  const archetype: Archetype =
    stored?.archetype ?? detectArchetypeHint(targetDir, language, framework) ?? 'library'
  const defaults = deriveAxisDefaults(stored, archetype)
  const lanes = resolveLanes(stored, targetDir)
  return {
    archetype,
    architectureStyle: defaults.architectureStyle,
    isMultiTenant: defaults.isMultiTenant,
    hasDatabase: defaults.hasDatabase,
    databaseEngine: defaults.databaseEngine,
    hasPublicApi: defaults.hasPublicApi,
    contractType: defaults.contractType,
    lanes,
  }
}
