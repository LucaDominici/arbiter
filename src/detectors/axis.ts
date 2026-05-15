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

export interface AxisFields {
  archetype: Archetype
  architectureStyle: ArchitectureStyle
  isMultiTenant: boolean
  hasDatabase: boolean
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

export function deriveAxisDefaults(
  stored: AxisStoredLike | null | undefined,
  archetype: Archetype,
): AxisDefaults {
  const hasPublicApi = pickHasPublicApi(stored, archetype)
  return {
    architectureStyle: stored?.architectureStyle ?? 'none',
    isMultiTenant: stored?.isMultiTenant ?? false,
    hasDatabase: stored?.hasDatabase ?? ARCHETYPE_DB_SET.has(archetype),
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
    hasPublicApi: defaults.hasPublicApi,
    contractType: defaults.contractType,
    lanes,
  }
}
