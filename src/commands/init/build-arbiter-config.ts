// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from init.ts — building the persisted
// arbiter.json (ArbiterConfig) from the resolved ProjectConfig. Pure extraction,
// no behavior change.
import type { ArbiterConfig } from '../../utils/config.js'
import { DEFAULT_THRESHOLDS } from '../../config/schema.js'
import type { AutomationConfig } from '../../config/schema.js'
import { resolveCollaborationMode } from '../../config/collaboration-mode-defaults.js'
import type { ProjectConfig, CollaborationMode } from '../../wizard/types.js'

/**
 * #1316 — persist the detected/recipe language so `arbiter update`/diff can detect
 * a language migration (diff.ts AXIS_FIELDS) and the evidence collector has a stable
 * source. Omitted for 'unknown' (no useful signal). Extracted to keep
 * buildArbiterConfig within the complexity-15 ceiling.
 */
function buildLanguageField(config: ProjectConfig): Pick<ArbiterConfig, 'language'> {
  return config.language !== 'unknown' ? { language: config.language } : {}
}

/**
 * #1317 — persist the database axis. `hasDatabase` is always written (legacy
 * back-compat); `databaseEngine` is written only when defined (exactOptional-safe)
 * so `arbiter update` can detect engine migrations and re-run integration-testing.
 * Extracted to keep buildArbiterConfig within the complexity-15 ceiling.
 */
function buildDatabaseFields(
  config: ProjectConfig,
): Pick<ArbiterConfig, 'hasDatabase' | 'databaseEngine'> {
  return {
    hasDatabase: config.hasDatabase,
    ...(config.databaseEngine !== undefined ? { databaseEngine: config.databaseEngine } : {}),
  }
}

/**
 * Extracted from buildArbiterConfig to keep its complexity within the 15-statement limit.
 * Builds the optional provider config fields (observability, auth, frontend).
 */
function buildProviderFields(
  config: ProjectConfig,
): Pick<ArbiterConfig, 'observability' | 'auth' | 'frontend'> {
  return {
    ...(config.observability !== undefined ? { observability: config.observability } : {}),
    ...(config.auth !== undefined ? { auth: config.auth } : {}),
    ...(config.frontend !== undefined ? { frontend: config.frontend } : {}),
  }
}

/**
 * Build the default-collapsing governance-axis fields. Extracted from
 * buildOptionalAxisFields when #1693's runnerProfile condition pushed that
 * function past the 10-branch complexity ceiling. These axes persist only on
 * an explicit opt-in away from their semantic default ('fleet'/'none'), so a
 * clean round-trip emits byte-identical output to a config that never
 * mentions them (ADR-101, #1254, #1616).
 */
function buildCollapsedAxisFields(
  config: ProjectConfig,
): Pick<ArbiterConfig, 'runnerProfile' | 'industryOverlay' | 'deployTarget'> {
  return {
    // #1693: persist runnerProfile only when it opts INTO 'solo' — the 'fleet'
    // default collapses to absence (ADR-101).
    ...(config.runnerProfile !== undefined && config.runnerProfile !== 'fleet'
      ? { runnerProfile: config.runnerProfile }
      : {}),
    // #1254: persist the compliance overlay so doctor can flag the cell and
    // `arbiter update` re-emits the overlay. Omitted when none/absent.
    ...(config.industryOverlay !== undefined && config.industryOverlay !== 'none'
      ? { industryOverlay: config.industryOverlay }
      : {}),
    // #1616: persist deployTarget so `arbiter update`/`diff` re-emit the deploy
    // workflows/infra. Without this the round-trip rebuilt ProjectConfig with
    // deployTarget=undefined→'none', silently disabling it on every update.
    ...(config.deployTarget !== undefined && config.deployTarget !== 'none'
      ? { deployTarget: config.deployTarget }
      : {}),
  }
}

/**
 * Build the optional governance-axis portion of the stored config. Extracted from
 * buildArbiterConfig to keep its cyclomatic complexity within the 15-branch ceiling
 * (#1616 added deployTarget + taxonomy, pushing the inline spread block over it).
 * Each field is persisted only when present; the default-collapsing axes
 * (runnerProfile/industryOverlay/deployTarget) live in buildCollapsedAxisFields.
 */
function buildOptionalAxisFields(
  config: ProjectConfig,
): Pick<
  ArbiterConfig,
  | 'evidenceRetention'
  | 'thresholdProfile'
  | 'strictnessTier'
  | 'industryOverlay'
  | 'basePackage'
  | 'deployTarget'
  | 'taxonomy'
  | 'runnerProfile'
> {
  return {
    ...(config.evidenceRetention !== undefined
      ? { evidenceRetention: config.evidenceRetention }
      : {}),
    ...(config.thresholdProfile !== undefined ? { thresholdProfile: config.thresholdProfile } : {}),
    ...(config.strictnessTier !== undefined ? { strictnessTier: config.strictnessTier } : {}),
    ...buildCollapsedAxisFields(config),
    ...(config.basePackage !== undefined ? { basePackage: config.basePackage } : {}),
    // #1616: persist taxonomy so `arbiter update`/`diff` re-emit the custom
    // test-taxonomy dimensions (taxonomy=undefined→[] otherwise).
    ...(config.taxonomy !== undefined ? { taxonomy: config.taxonomy } : {}),
  }
}

/**
 * ADR-051 (#1119): build the collaboration-mode + automation portion of the stored config.
 * Extracted from buildArbiterConfig to keep its complexity within the 15-statement limit.
 * Only collaborationMode + explicit user overrides (solo.mergeMode, branchingStrategy) are
 * persisted; derived values are re-computed at render time by resolveCollaborationAxes.
 * #1261: the automation block is always persisted explicitly — the Project Profile is a
 * discovery surface (`arbiter settings`); absent stays valid for legacy repos
 * (absent ⇒ L0 at every read site), but fresh inits spell it out.
 */
function buildCollaborationOverrides(config: ProjectConfig): {
  collaborationMode: CollaborationMode
  solo?: { mergeMode: import('../../wizard/types.js').SoloMergeMode }
  branchingStrategy?: import('../../wizard/types.js').BranchingStrategy
  // #1306 — pass the full AutomationConfig through so the three Project-Profile
  // orchestration prefs inherit into the generated config (ADR-094 §Decision.6,
  // within the ADR-093 §5 self-only boundary).
  automation: AutomationConfig
} {
  return {
    collaborationMode: resolveCollaborationMode(config),
    ...(config.solo !== undefined ? { solo: config.solo } : {}),
    ...(config.branchingStrategy !== undefined
      ? { branchingStrategy: config.branchingStrategy }
      : {}),
    automation: config.automation ?? { autonomy: 'L0' },
  }
}

export function buildArbiterConfig(config: ProjectConfig): ArbiterConfig {
  const level = config.governanceLevel
  const backend = config.decompositionBackend ?? (config.useGitHub ? 'github' : 'markdown')
  return {
    version: '0.2',
    tools: config.tools,
    governanceLevel: level,
    permitGitHub: config.useGitHub,
    decomposition: { backend },
    ...buildLanguageField(config),
    features: {
      debtGates: config.enableDebtGates,
      suppressions: config.enableSuppressions,
      securityScanning: config.enableSecurityScanning,
      mutationTesting: config.enableMutationTesting !== false,
      contractTesting: config.enableContractTesting !== false,
      evidenceHarness: config.enableEvidenceHarness === true,
      selfValidationHarness: config.enableSelfValidationHarness !== false,
      auditToolchain: config.enableAuditToolchain === true,
      fiveLaneCi: config.enableFiveLaneCi === true,
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      soloDevMode: config.enableSoloDevMode === true,
      // #1887-A: pure round-trip-drop bugs — the recipe schema + generators already
      // honour these ProjectConfig fields on fresh init; persisting them here is what
      // lets `arbiter update`/`diff` keep honouring the same choice instead of
      // silently reverting to the default on the next re-resolution.
      mcpFallback: config.enableMcpFallback === true,
      noSkippedTests: config.enableNoSkippedTests !== false,
      // #1887-A: compliance doc-pack — set only by applyPreset('industrial-grade');
      // persisting them here is what lets `arbiter update`/`diff` keep the
      // risk-register/compliance/operations generators enabled post-preset.
      riskRegister: config.enableRiskRegister === true,
      operationsHandbook: config.enableOperationsHandbook === true,
      iso27001Mapping: config.enableIso27001Mapping === true,
      nis2Mapping: config.enableNis2Mapping === true,
      gdprMapping: config.enableGdprMapping === true,
      // #1887-A: same round-trip-drop class — generators built, gated on the
      // ProjectConfig field, but no public activation path until now.
      codeownersNotify: config.enableCodeownersNotify === true,
      taxonomy25d: config.enableTaxonomy25d === true,
      perfTesting: config.enablePerfTesting === true,
    },
    ...buildCollaborationOverrides(config),
    thresholds: config.thresholds ?? DEFAULT_THRESHOLDS[level],
    invariantTiers: config.invariantTiers,
    archetype: config.archetype,
    architectureStyle: config.architectureStyle,
    isMultiTenant: config.isMultiTenant,
    ...buildDatabaseFields(config),
    hasPublicApi: config.hasPublicApi,
    ...(config.acceptBetaTools === true ? { acceptBetaTools: true } : {}),
    contractType: config.contractType,
    ...buildOptionalAxisFields(config),
    ...(config.lanes.length > 0 ? { lanes: config.lanes } : {}),
    ...(config.taskTiers !== undefined ? { taskTiers: config.taskTiers } : {}),
    ...buildProviderFields(config),
    ...(config.preset !== undefined && config.preset !== 'none' ? { preset: config.preset } : {}),
  }
}
