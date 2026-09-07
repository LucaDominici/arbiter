// SPDX-License-Identifier: Apache-2.0
import { resolve } from 'node:path'
import {
  intro,
  outro,
  select,
  multiselect,
  confirm,
  text,
  isCancel,
  cancel,
  note,
} from '@clack/prompts'
import { loadConfig } from '../utils/config.js'
import { t } from '../i18n/index.js'
import { runConfigure } from './configure.js'
import type { ArbiterConfigV2 } from '../config/schema.js'
import { SUPPORTED_AI_TOOLS } from '../wizard/types.js'

// Returns ['path=value', ...] for fields that changed, or null if cancelled.
type GroupFn = (config: ArbiterConfigV2) => Promise<string[] | null>

function diffStr(path: string, oldVal: string | undefined, newVal: string): string[] {
  return oldVal === newVal ? [] : [`${path}=${newVal}`]
}

function diffBool(path: string, oldVal: boolean | undefined, newVal: boolean): string[] {
  return oldVal === newVal ? [] : [`${path}=${String(newVal)}`]
}

function diffArr(path: string, oldArr: string[], newArr: string[]): string[] {
  const a = [...oldArr].sort().join(',')
  const b = [...newArr].sort().join(',')
  return a === b ? [] : [`${path}=${newArr.join(',')}`]
}

function axisDefaults(config: ArbiterConfigV2) {
  return {
    archetype: config.archetype ?? 'backend-web-db',
    architectureStyle: config.architectureStyle ?? 'none',
    isMultiTenant: config.isMultiTenant ?? false,
    hasDatabase: config.hasDatabase ?? false,
    hasPublicApi: config.hasPublicApi ?? false,
    contractType: config.contractType ?? 'none',
  }
}

async function promptAxisGroup(config: ArbiterConfigV2): Promise<string[] | null> {
  note(t('cli.configure.interactive.axis_header'))
  const d = axisDefaults(config)

  const archetype = await select({
    message: 'Project archetype',
    options: [
      { value: 'backend-web-db', label: 'backend-web-db' },
      { value: 'cli', label: 'cli' },
      { value: 'library', label: 'library' },
      { value: 'data-pipeline', label: 'data-pipeline' },
      { value: 'frontend-spa', label: 'frontend-spa' },
      { value: 'embedded', label: 'embedded' },
    ],
    initialValue: d.archetype,
  })
  if (isCancel(archetype)) return null

  const architectureStyle = await select({
    message: 'Architecture style',
    options: [
      { value: 'hexagonal', label: 'hexagonal' },
      { value: 'layered', label: 'layered' },
      { value: 'modular-monolith', label: 'modular-monolith' },
      { value: 'none', label: 'none' },
    ],
    initialValue: d.architectureStyle,
  })
  if (isCancel(architectureStyle)) return null

  const isMultiTenant = await confirm({
    message: 'Multi-tenant deployment?',
    initialValue: d.isMultiTenant,
  })
  if (isCancel(isMultiTenant)) return null

  const hasDatabase = await confirm({
    message: 'Database connected?',
    initialValue: d.hasDatabase,
  })
  if (isCancel(hasDatabase)) return null

  const hasPublicApi = await confirm({
    message: 'Public API exposed?',
    initialValue: d.hasPublicApi,
  })
  if (isCancel(hasPublicApi)) return null

  const contractType = await select({
    message: 'Contract testing strategy',
    options: [
      { value: 'rest-owned', label: 'rest-owned' },
      { value: 'rest-public', label: 'rest-public' },
      { value: 'graphql', label: 'graphql' },
      { value: 'grpc', label: 'grpc' },
      { value: 'message-queue', label: 'message-queue' },
      { value: 'none', label: 'none' },
    ],
    initialValue: d.contractType,
  })
  if (isCancel(contractType)) return null

  const governanceLevel = await select({
    message: 'Governance level',
    options: [
      { value: 'L1', label: 'L1', hint: 'minimal' },
      { value: 'L2', label: 'L2', hint: 'standard' },
      { value: 'L3', label: 'L3', hint: 'strict' },
      { value: 'L4', label: 'L4', hint: 'maximum' },
    ],
    initialValue: config.governanceLevel,
  })
  if (isCancel(governanceLevel)) return null

  return [
    ...diffStr('archetype', config.archetype, archetype),
    ...diffStr('architectureStyle', config.architectureStyle, architectureStyle),
    ...diffBool('isMultiTenant', config.isMultiTenant, isMultiTenant),
    ...diffBool('hasDatabase', config.hasDatabase, hasDatabase),
    ...diffBool('hasPublicApi', config.hasPublicApi, hasPublicApi),
    ...diffStr('contractType', config.contractType, contractType),
    ...diffStr('governanceLevel', config.governanceLevel, governanceLevel),
  ]
}

async function promptFeaturesGroup(config: ArbiterConfigV2): Promise<string[] | null> {
  note(t('cli.configure.interactive.features_header'))

  const f = config.features
  const fields: Array<[string, boolean]> = [
    ['features.contractTesting', f.contractTesting],
    ['features.mutationTesting', f.mutationTesting],
    ['features.securityScanning', f.securityScanning],
    ['features.evidenceHarness', f.evidenceHarness],
    ['features.acceptanceAnchor', f.acceptanceAnchor ?? false],
    ['features.debtGates', f.debtGates],
    ['features.suppressions', f.suppressions],
    ['features.soloDevMode', f.soloDevMode ?? false],
  ]

  const assignments: string[] = []
  for (const [path, oldVal] of fields) {
    const label = path.replace('features.', '')
    const val = await confirm({ message: `Enable ${label}?`, initialValue: oldVal })
    if (isCancel(val)) return null
    assignments.push(...diffBool(path, oldVal, val))
  }
  return assignments
}

async function promptThresholdsGroup(config: ArbiterConfigV2): Promise<string[] | null> {
  note(t('cli.configure.interactive.thresholds_header'))

  const th = config.thresholds
  const numericFields: Array<[string, number, string]> = [
    ['thresholds.lineCoverage', th.lineCoverage, 'Line coverage threshold (%)'],
    ['thresholds.branchCoverage', th.branchCoverage, 'Branch coverage threshold (%)'],
    ['thresholds.mutationScore', th.mutationScore, 'Mutation score threshold (%)'],
    ['thresholds.cyclomaticComplexity', th.cyclomaticComplexity, 'Max cyclomatic complexity'],
    ['thresholds.methodLength', th.methodLength, 'Max method length (lines)'],
    ['thresholds.maxParams', th.maxParams, 'Max parameters per function'],
  ]

  const assignments: string[] = []
  for (const [path, oldVal, message] of numericFields) {
    const val = await text({
      message,
      initialValue: String(oldVal),
      validate: (v) =>
        v === undefined || !/^\d+$/.test(v.trim())
          ? t('cli.configure.interactive.invalid_number')
          : undefined,
    })
    if (isCancel(val)) return null
    const trimmed = val.trim()
    if (trimmed !== String(oldVal)) assignments.push(`${path}=${trimmed}`)
  }
  return assignments
}

async function promptCollaborationGroup(config: ArbiterConfigV2): Promise<string[] | null> {
  note(t('cli.configure.interactive.collaboration_header'))

  const collaborationMode = await select({
    message: 'Collaboration mode',
    options: [
      { value: 'trunk-solo', label: 'trunk-solo', hint: 'one author, direct push' },
      { value: 'peer-review', label: 'peer-review', hint: 'shared trust, mandatory PR' },
      { value: 'gated-review', label: 'gated-review', hint: 'CODEOWNERS, merge queue' },
    ],
    initialValue: config.collaborationMode ?? 'peer-review',
  })
  if (isCancel(collaborationMode)) return null

  const branchingStrategy = await select({
    message: 'Branching strategy',
    options: [
      { value: 'trunk-direct', label: 'trunk-direct' },
      { value: 'github-flow', label: 'github-flow' },
      { value: 'github-flow-with-develop', label: 'github-flow-with-develop' },
    ],
    initialValue: config.branchingStrategy ?? 'trunk-direct',
  })
  if (isCancel(branchingStrategy)) return null

  const soloMergeMode = await select({
    message: 'Solo merge method',
    options: [
      { value: 'direct', label: 'direct', hint: 'push directly to main' },
      { value: 'pr-ff', label: 'pr-ff', hint: 'PR with fast-forward merge' },
    ],
    initialValue: config.solo?.mergeMode ?? 'direct',
  })
  if (isCancel(soloMergeMode)) return null

  return [
    ...diffStr('collaborationMode', config.collaborationMode, collaborationMode),
    ...diffStr('branchingStrategy', config.branchingStrategy, branchingStrategy),
    ...diffStr('solo.mergeMode', config.solo?.mergeMode, soloMergeMode),
  ]
}

async function promptAccessGroup(config: ArbiterConfigV2): Promise<string[] | null> {
  note(t('cli.configure.interactive.access_header'))

  // #2367 (ADR-119): offer exactly the customer-facing SSOT — the hand-rolled
  // seven-entry copy advertised five tools `configure --set tools=` rejected.
  const allTools: readonly string[] = SUPPORTED_AI_TOOLS
  const tools = await multiselect({
    message: 'Active AI tools',
    options: allTools.map((v) => ({ value: v, label: v })),
    initialValues: [...config.tools],
    required: true,
  })
  if (isCancel(tools)) return null

  const permitGitHub = await confirm({
    message: 'Permit GitHub integration?',
    initialValue: config.permitGitHub ?? false,
  })
  if (isCancel(permitGitHub)) return null

  return [
    ...diffArr('tools', config.tools, tools),
    ...diffBool('permitGitHub', config.permitGitHub, permitGitHub),
  ]
}

// #1261: ship-autonomy axis (ADR-093 §4) — single select, safe default L0.
async function promptAutomationGroup(config: ArbiterConfigV2): Promise<string[] | null> {
  note(t('cli.configure.interactive.automation_header'))

  const autonomy = await select({
    message: 'Ship autonomy level',
    options: [
      { value: 'L0', label: 'L0', hint: 'ask at each ship step (default)' },
      { value: 'L1', label: 'L1', hint: 'auto-advance + auto-merge on green' },
      { value: 'L2', label: 'L2', hint: '+ autonomous fix-on-red attempt' },
      { value: 'L3', label: 'L3', hint: 'full auto: wave/batch + fix push + sub-agents' },
    ],
    initialValue: config.automation?.autonomy ?? 'L0',
  })
  if (isCancel(autonomy)) return null

  return diffStr('automation.autonomy', config.automation?.autonomy, autonomy)
}

export async function runInteractiveConfigure(dir?: string): Promise<void> {
  const targetDir = resolve(dir ?? process.cwd())
  const stored = loadConfig(targetDir)
  if (!stored) {
    process.stderr.write(`${t('cli.configure.interactive.no_config')}\n`)
    process.exit(1)
    return
  }

  intro(t('cli.configure.interactive.intro'))

  const groups: GroupFn[] = [
    (c) => promptAxisGroup(c),
    (c) => promptFeaturesGroup(c),
    (c) => promptThresholdsGroup(c),
    (c) => promptCollaborationGroup(c),
    (c) => promptAccessGroup(c),
    (c) => promptAutomationGroup(c),
  ]

  const allAssignments: string[] = []
  for (const group of groups) {
    const result = await group(stored)
    if (result === null) {
      cancel(t('cli.configure.no_changes'))
      return
    }
    allAssignments.push(...result)
  }

  const saveit = await confirm({
    message: t('cli.configure.interactive.save_confirm'),
    initialValue: true,
  })
  if (isCancel(saveit) || !saveit) {
    cancel(t('cli.configure.no_changes'))
    return
  }

  if (allAssignments.length === 0) {
    outro(t('cli.configure.no_changes'))
    return
  }

  await runConfigure({ dir: targetDir, sets: allAssignments })
}
