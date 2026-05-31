// SPDX-License-Identifier: Apache-2.0
//
// Existing Code Survey (CANON-16):
//   - grep `resolveProjectConfig` src/ → no prior definition (new module name).
//   - `v2ToProjectConfig` + the detector block in `detectProjectInfo` (update.ts)
//     and `buildDiffConfig` (diff.ts) were two INDEPENDENT code paths that each
//     turned stored arbiter.json + on-disk detection into a `ProjectConfig`.
//     diff's variant built a strict SUBSET (missing collaborationMode, archetype
//     /axis defaults, acceptBetaTools, evidenceRetention, contractType, lanes…),
//     which is a second drift source beyond the hardcoded file list (#1077).
//   - Decision: EXTRACT the canonical (update) builder here and have BOTH `diff`
//     and `update` consume it, so they construct field-identical configs by
//     construction. This is a move/refactor, not green-field.
import { detectLanguage } from '../detectors/language.js'
import { detectBuildCommands } from '../detectors/build.js'
import { detectFramework } from '../detectors/framework.js'
import { detectGitInfo } from '../detectors/git.js'
import { detectExisting } from '../detectors/existing.js'
import { getLanguageHooks } from '../detectors/language-hooks.js'
import { resolveAxisFields } from '../detectors/axis.js'
import { presetToTiers, defaultPresetForLevel } from '../invariants/filter.js'
import { resolveCollaborationMode } from './collaboration-mode-defaults.js'
import type { ProjectConfig, Lane } from '../wizard/types.js'
import type { ArbiterConfigV2 } from '../utils/config.js'

/** Detector-derived fields that combine with stored config to form a ProjectConfig. */
export interface DetectorFields {
  targetDir: string
  projectName: string
  language: ReturnType<typeof detectLanguage>
  framework: string | null
  buildTool: string
  buildCommand: string
  testCommand: string
  lintCommand: string
  formatCommand: string
  useGitHub: boolean
  permitGitHub: boolean
  githubOwner: string | null
  githubRepo: string | null
  existing: ProjectConfig['existing']
  languageHooks: ProjectConfig['languageHooks']
  archetype: ProjectConfig['archetype']
  architectureStyle: ProjectConfig['architectureStyle']
  isMultiTenant: boolean
  hasDatabase: boolean
  hasPublicApi: boolean
  contractType: ProjectConfig['contractType']
  lanes: Lane[]
}

function resolveExtendedInvariants(stored: ArbiterConfigV2): boolean {
  return stored.governance?.invariants_catalog === 'extended'
}

/**
 * Combine stored arbiter.json (v2) with detector-derived fields into the
 * canonical ProjectConfig. This is the SINGLE builder used by both `init`/
 * `update` (real generation) and `diff` (registry-dryRun), so the registry sees
 * an identical config from either entry point.
 *
 * Internal: consumed only by {@link resolveProjectConfig} (the public entry that
 * runs the detectors first). Tests pin its field-mapping through that entry — see
 * __tests__/commands/update.test.ts.
 */
function v2ToProjectConfig(stored: ArbiterConfigV2, detectorFields: DetectorFields): ProjectConfig {
  const level = stored.governanceLevel
  return {
    ...detectorFields,
    projectName: detectorFields.projectName,
    description: `${detectorFields.projectName} project`,
    tools: stored.tools,
    governanceLevel: level,
    enableDebtGates: stored.features.debtGates,
    enableSuppressions: stored.features.suppressions,
    enableSecurityScanning: stored.features.securityScanning,
    enableMutationTesting: stored.features.mutationTesting,
    enableContractTesting: stored.features.contractTesting,
    enableEvidenceHarness: stored.features.evidenceHarness,
    enableSelfValidationHarness: stored.features.selfValidationHarness ?? true,
    enableSoloDevMode: stored.features.soloDevMode ?? false,
    // ADR-051 (#1119): use canonical resolver — honours stored.collaborationMode first,
    // then soloDevMode alias, then defaults to 'peer-review'. Replaces inline derivation.
    collaborationMode: resolveCollaborationMode({
      ...(stored.collaborationMode !== undefined
        ? { collaborationMode: stored.collaborationMode }
        : {}),
      ...(stored.features.soloDevMode !== undefined
        ? { enableSoloDevMode: stored.features.soloDevMode }
        : {}),
    }),
    // Map persisted overrides from arbiter.json into ProjectConfig so resolveCollaborationAxes
    // can honour them when building the template render context.
    ...(stored.solo !== undefined ? { solo: stored.solo } : {}),
    ...(stored.branchingStrategy !== undefined
      ? { branchingStrategy: stored.branchingStrategy }
      : {}),
    invariantTiers: stored.invariantTiers ?? presetToTiers(defaultPresetForLevel(level)),
    acceptBetaTools: stored.acceptBetaTools ?? false,
    ...(stored.evidenceRetention !== undefined && {
      evidenceRetention: stored.evidenceRetention,
    }),
    ...(stored.thresholdProfile !== undefined && {
      thresholdProfile: stored.thresholdProfile,
    }),
    ...(stored.strictnessTier !== undefined && {
      strictnessTier: stored.strictnessTier,
    }),
    contractType: detectorFields.contractType,
    ...(stored.basePackage !== undefined ? { basePackage: stored.basePackage } : {}),
    thresholds: stored.thresholds,
    lanes: detectorFields.lanes,
    ...(stored.taskTiers !== undefined && { taskTiers: stored.taskTiers }),
    ...(stored.frontend !== undefined ? { frontend: stored.frontend } : {}),
    includeExtendedInvariants: resolveExtendedInvariants(stored),
  }
}

/** Whether GitHub remote side effects (labels/board/branch-protection) are permitted. */
export function gitHubPermitted(stored: ArbiterConfigV2): boolean {
  return stored.permitGitHub ?? stored.useGitHub ?? false
}

/**
 * Run filesystem/git detection and build the canonical ProjectConfig from
 * stored config. `useGitHubBackend` controls whether GitHub *backend* API calls
 * would run (init/update with --github) — it does NOT affect which files the
 * registry emits, only the runGithubSetup side path. `diff` always passes false
 * (read-only: never touch gh).
 */
export function resolveProjectConfig(
  targetDir: string,
  projectName: string,
  stored: ArbiterConfigV2,
  useGitHubBackend = false,
): { config: ProjectConfig; detectorFields: DetectorFields } {
  const language = detectLanguage(targetDir)
  const framework = detectFramework(targetDir, language)
  const buildCmds = detectBuildCommands(targetDir, language)
  const gitInfo = detectGitInfo(targetDir)
  const existing = detectExisting(targetDir)
  const axisFields = resolveAxisFields(stored, targetDir, language, framework)
  const {
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    hasPublicApi,
    contractType,
    lanes,
  } = axisFields

  const detectorFields: DetectorFields = {
    targetDir,
    projectName,
    language,
    framework,
    buildTool: buildCmds.buildTool,
    buildCommand: buildCmds.buildCommand,
    testCommand: buildCmds.testCommand,
    lintCommand: buildCmds.lintCommand,
    formatCommand: buildCmds.formatCommand,
    useGitHub: useGitHubBackend,
    permitGitHub: gitHubPermitted(stored),
    githubOwner: gitInfo.githubOwner,
    githubRepo: gitInfo.githubRepo,
    existing,
    languageHooks: getLanguageHooks(language),
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    hasPublicApi,
    contractType,
    lanes,
  }

  return { config: v2ToProjectConfig(stored, detectorFields), detectorFields }
}
