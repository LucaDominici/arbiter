// SPDX-License-Identifier: Apache-2.0
import { getLogger } from '../utils/logger.js'
import { generateAgentsMd } from './agents-md.js'
import type { InstalledSkill } from '../integrations/types.js'
import { computeSkipReport } from './skills.js'
import { generateClaude } from './claude.js'
import { generateCodex } from './codex.js'
import { generateGithub } from './github.js'
import { generateRoot } from './root.js'
import { generateCheckAll } from './check-all.js'
import { generateCursor } from './cursor.js'
import { generateCopilot } from './copilot.js'
import { generateCoverage } from './coverage.js'
import { generateDebtGates } from './debt-gates.js'
import { generateDebtRatchet } from './debt-ratchet.js'
import { generateSuppressions } from './suppressions.js'
import { generateSecurity } from './security.js'
import { generateStrideEnforcement } from './stride-enforcement.js'
import { generateEvidenceRetention } from './evidence-retention.js'
import { generateTestTaxonomy } from './test-taxonomy.js'
import { generateArchUnit } from './archunit.js'
import { generateQuality } from './quality.js'
import { generateEslintBoundaries } from './boundaries.js'
import { generateRustBoundaries } from './rust-boundaries.js'
import { generateGoBoundaries } from './go-boundaries.js'
import { generatePythonBoundaries } from './python-boundaries.js'
import { generateMutation } from './mutation.js'
import { generateIntegrationTesting } from './integration-testing.js'
import { generateContractTesting } from './contract-testing.js'
import { generateGlobalInvariants } from './global-invariants.js'
import { generateSkills } from './skills.js'
import { generateGemini } from './gemini.js'
import { generateWindsurf } from './windsurf.js'
import { generateAider } from './aider.js'
import { generateAgentsClaude } from './agents-claude.js'
import { generateSsot } from './ssot.js'
import { generateBehavioralTests } from './behavioral-tests.js'
import { generatePlaywrightPython } from './playwright-python.js'
import { generatePlaywrightTs } from './playwright-ts.js'
import { generateGithooks } from './githooks.js'
import { generateGithubSetup } from './github-setup.js'
import { generateDocs } from './docs.js'
import { generateApiMiddleware } from './api-middleware.js'
import { generateSeed } from './seed.js'
import { generateEvidenceBacklog } from './evidence-backlog.js'
import { generateSelfValidation } from './self-validation.js'
import { generateOperations } from './operations.js'
import { generateFrontendGovernance } from './frontend-governance.js'
import { generateFrontendQuality } from './frontend-quality.js'
import { generateRiskRegister } from './risk-register.js'
import { generateCompliance } from './compliance.js'
import { generateObservability } from './observability.js'
import { generateAuth } from './auth.js'
import { generateCiTier } from './ci-tier.js'
import { generateLocalWrapper } from './local-wrapper.js'
import { generateEnvTemplate } from './env-template.js'
import { generateInfra } from './infra.js'
import { generateAuditToolchain } from './audit-toolchain.js'
import { generatePerfK6 } from './perf-k6.js'
import { generateModulith } from './modulith.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult, GeneratorRunOpts } from '../utils/fs.js'
import type { GeneratorKey } from '../config/diff.js'

const BACKEND_WEB_DB = 'backend-web-db' as const

export interface GeneratorSpec {
  key: GeneratorKey
  enabled: boolean
  run: (opts: GeneratorRunOpts) => WriteResult[]
}

export type { GeneratorRunOpts }

/**
 * Failure record collected by {@link runGeneratorsFromRegistry} /
 * {@link runGeneratorsSelective} when a generator throws (#483). Callers
 * must surface non-empty arrays via a non-zero exit (INV-53 status=error
 * → exit 2) so silent misconfiguration is never possible.
 */
export interface GeneratorFailure {
  key: GeneratorKey
  message: string
}

function buildAiToolSpecs(
  config: ProjectConfig,
  installedSkills: InstalledSkill[],
): GeneratorSpec[] {
  const noAiRulez = !config.existing.aiRulez
  const skipReport = computeSkipReport(installedSkills)
  return [
    {
      key: 'agents-md',
      enabled: true,
      run: (opts) => [generateAgentsMd(config, installedSkills, skipReport, opts)],
    },
    {
      key: 'global-invariants',
      enabled: true,
      run: (opts) => [generateGlobalInvariants(config, opts)],
    },
    {
      key: 'claude',
      enabled: noAiRulez && config.tools.includes('claude'),
      run: (opts) => generateClaude(config, opts).files,
    },
    {
      key: 'codex',
      enabled: noAiRulez && config.tools.includes('codex'),
      run: (opts) => generateCodex(config, opts).files,
    },
    {
      key: 'cursor',
      enabled: noAiRulez && config.tools.includes('cursor'),
      run: (opts) => generateCursor(config, opts).files,
    },
    {
      key: 'copilot',
      enabled: noAiRulez && config.tools.includes('copilot'),
      run: (opts) => generateCopilot(config, opts).files,
    },
    {
      key: 'gemini',
      enabled: noAiRulez && config.tools.includes('gemini'),
      run: (opts) => generateGemini(config, opts).files,
    },
    {
      key: 'windsurf',
      enabled: noAiRulez && config.tools.includes('windsurf'),
      run: (opts) => generateWindsurf(config, opts).files,
    },
    {
      key: 'aider',
      enabled: noAiRulez && config.tools.includes('aider'),
      run: (opts) => generateAider(config, opts).files,
    },
    {
      key: 'skills',
      enabled: noAiRulez,
      run: (opts) => generateSkills(config, installedSkills, opts).files,
    },
    {
      key: 'agents-claude',
      enabled: noAiRulez,
      run: (opts) => generateAgentsClaude(config, opts).files,
    },
  ]
}

function buildInfraSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    {
      key: 'github',
      enabled: config.permitGitHub ?? config.useGitHub,
      run: (opts) => generateGithub(config, opts).files,
    },
    {
      key: 'root',
      enabled: config.permitGitHub ?? config.useGitHub,
      run: (opts) => generateRoot(config, opts).files,
    },
    {
      key: 'check-all',
      enabled: true,
      run: (opts) => generateCheckAll(config, opts).files,
    },
    {
      key: 'debt-gates',
      // Always run for typescript/multi so injectTestScripts fires regardless of
      // enableDebtGates — check-all.mjs calls test:unit/contract/integration/behavioral
      // unconditionally for TS at L1+ (#933 F13).
      enabled:
        config.enableDebtGates || config.language === 'typescript' || config.language === 'multi',
      run: (opts) => generateDebtGates(config, opts).files,
    },
    {
      key: 'debt-ratchet',
      enabled: config.enableDebtGates,
      run: (opts) => generateDebtRatchet(config, opts).files,
    },
    {
      key: 'coverage',
      enabled: config.enableDebtGates,
      run: (opts) => generateCoverage(config, opts).files,
    },
    {
      key: 'suppressions',
      enabled: true,
      run: (opts) => generateSuppressions(config, opts).files,
    },
    {
      key: 'security',
      enabled: config.enableSecurityScanning,
      run: (opts) => generateSecurity(config, opts).files,
    },
    {
      key: 'stride-enforcement',
      enabled: config.enableDebtGates,
      run: (opts) => generateStrideEnforcement(config, opts).files,
    },
    {
      key: 'githooks',
      enabled: true,
      run: (opts) => generateGithooks(config, opts).files,
    },
    {
      key: 'github-setup',
      enabled: (config.permitGitHub ?? config.useGitHub) && config.governanceLevel !== 'L1',
      run: (opts) => generateGithubSetup(config, opts).files,
    },
    {
      key: 'docs',
      enabled: config.governanceLevel !== 'L1',
      run: (opts) => generateDocs(config, opts).files,
    },
    {
      key: 'quality',
      enabled: config.governanceLevel !== 'L1',
      run: (opts) => generateQuality(config, opts).files,
    },
    {
      key: 'api-middleware',
      enabled: config.hasPublicApi,
      run: (opts) => generateApiMiddleware(config, opts).files,
    },
    {
      key: 'seed',
      enabled: config.archetype === BACKEND_WEB_DB && config.governanceLevel !== 'L1',
      run: (opts) => generateSeed(config, opts).files,
    },
    {
      key: 'self-validation',
      enabled: config.enableSelfValidationHarness !== false,
      run: (opts) => generateSelfValidation(config, opts).files,
    },
    {
      key: 'infra',
      enabled: config.enableAzureContainerApp === true,
      run: (opts) => generateInfra(config, opts).files,
    },
    {
      key: 'audit-toolchain',
      enabled: true,
      run: (opts) => generateAuditToolchain(config, opts).files,
    },
  ]
}

function buildBoundarySpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    { key: 'archunit', enabled: true, run: (opts) => generateArchUnit(config, opts).files },
    {
      key: 'eslint-boundaries',
      enabled: true,
      run: (opts) => generateEslintBoundaries(config, opts).files,
    },
    {
      key: 'rust-boundaries',
      enabled: true,
      run: (opts) => generateRustBoundaries(config, opts).files,
    },
    {
      key: 'go-boundaries',
      enabled: true,
      run: (opts) => generateGoBoundaries(config, opts).files,
    },
    {
      key: 'python-boundaries',
      enabled: true,
      run: (opts) => generatePythonBoundaries(config, opts).files,
    },
    {
      key: 'modulith',
      enabled: config.language === 'java' || config.language === 'multi',
      run: (opts) => generateModulith(config, opts).files,
    },
  ]
}

function buildAnalysisSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    ...buildBoundarySpecs(config),
    {
      key: 'mutation',
      enabled: config.enableMutationTesting !== false,
      run: (opts) => generateMutation(config, opts).files,
    },
    {
      key: 'ci-tier',
      enabled: config.permitGitHub ?? config.useGitHub,
      run: (opts) => generateCiTier(config, opts).files,
    },
    {
      key: 'local-wrapper',
      enabled: true,
      run: (opts) => generateLocalWrapper(config, opts).files,
    },
    { key: 'env-template', enabled: true, run: (opts) => generateEnvTemplate(config, opts).files },
    {
      // #487: this is DATABASE integration-testing (Testcontainers + PostgreSQL).
      // API-only projects (no DB but with public API) are served by `contract-testing`
      // below — gated on config.contractType (Pact). Do NOT broaden this gate to
      // `hasDatabase || hasPublicApi`; every template here hardcodes PostgreSQL and
      // would emit broken DB scaffolding for an API-only project.
      key: 'integration-testing',
      enabled: config.hasDatabase,
      run: (opts) => generateIntegrationTesting(config, opts).files,
    },
    {
      // Companion to integration-testing above: covers API-only / contract paths.
      key: 'contract-testing',
      enabled: config.enableContractTesting !== false,
      run: (opts) => generateContractTesting(config, opts).files,
    },
    {
      key: 'evidence-retention',
      enabled: config.enableEvidenceHarness !== false,
      run: (opts) => generateEvidenceRetention(config, opts).files,
    },
    {
      key: 'evidence-backlog',
      enabled: config.governanceLevel !== 'L1',
      run: (opts) => generateEvidenceBacklog(config, opts).files,
    },
    {
      key: 'test-taxonomy',
      enabled: true,
      run: (opts) => generateTestTaxonomy(config, opts).files,
    },
    {
      key: 'operations',
      enabled: config.enableOperationsHandbook === true,
      run: (opts) => generateOperations(config, opts).files,
    },
    {
      key: 'risk-register',
      enabled: config.enableRiskRegister === true,
      run: (opts) => generateRiskRegister(config, opts).files,
    },
    {
      key: 'compliance',
      enabled:
        config.enableIso27001Mapping === true ||
        config.enableNis2Mapping === true ||
        config.enableGdprMapping === true,
      run: (opts) => generateCompliance(config, opts).files,
    },
    {
      key: 'behavioral-tests',
      enabled: true,
      run: (opts) => generateBehavioralTests(config, opts).files,
    },
    {
      key: 'playwright-python',
      enabled:
        config.language === 'python' &&
        (config.archetype === 'frontend-spa' || config.archetype === BACKEND_WEB_DB),
      run: (opts) => generatePlaywrightPython(config, opts).files,
    },
    {
      key: 'playwright-ts',
      enabled:
        config.language === 'typescript' &&
        (config.archetype === 'frontend-spa' || config.archetype === BACKEND_WEB_DB),
      run: (opts) => generatePlaywrightTs(config, opts).files,
    },
    { key: 'ssot', enabled: true, run: (opts) => generateSsot(config, opts).files },
    {
      key: 'frontend-governance',
      enabled: config.archetype === 'frontend-spa' || config.lanes.includes('frontend'),
      run: (opts) => generateFrontendGovernance(config, opts).files,
    },
    {
      // #1127: frontend quality enforcement — token gate, i18n, coverage, VRT, perf.
      // Gated on FE signal; separate from frontend-governance (docs) to keep
      // each generator single-responsibility (CANON-05 test constraint).
      key: 'frontend-quality',
      enabled: config.archetype === 'frontend-spa' || config.lanes.includes('frontend'),
      run: (opts) => generateFrontendQuality(config, opts).files,
    },
  ]
}

function buildPerfSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    {
      key: 'perf-k6',
      enabled: config.enablePerfTesting === true,
      run: (opts) => generatePerfK6(config, opts).files,
    },
  ]
}

function buildProviderSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    {
      key: 'observability',
      enabled: config.observability != null && config.observability.provider !== 'none',
      run: (opts) => generateObservability(config, opts).files,
    },
    {
      key: 'auth',
      enabled: config.auth != null && config.auth.provider !== 'none',
      run: (opts) => generateAuth(config, opts).files,
    },
  ]
}

export function buildRegistry(
  config: ProjectConfig,
  installedSkills: InstalledSkill[] = [],
): GeneratorSpec[] {
  return [
    ...buildAiToolSpecs(config, installedSkills),
    ...buildInfraSpecs(config),
    ...buildAnalysisSpecs(config),
    ...buildPerfSpecs(config),
    ...buildProviderSpecs(config),
  ]
}

function safeRun(
  spec: GeneratorSpec,
  opts: GeneratorRunOpts,
  errors: GeneratorFailure[],
): WriteResult[] {
  try {
    return spec.run(opts)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Keep the stderr line for operators tailing logs; the structured
    // `errors` sink is the authoritative observable channel (#483).
    getLogger().warn(
      'registry.generator_failed',
      { generator: spec.key, err: message },
      `generator '${spec.key}' failed: ${message}`,
    )
    errors.push({ key: spec.key, message })
    return []
  }
}

export function runGeneratorsFromRegistry(
  specs: GeneratorSpec[],
  errors: GeneratorFailure[] = [],
  opts: GeneratorRunOpts,
): WriteResult[] {
  return specs.filter((s) => s.enabled).flatMap((s) => safeRun(s, opts, errors))
}

export function runGeneratorsSelective(
  specs: GeneratorSpec[],
  keys: Set<GeneratorKey | '*'>,
  errors: GeneratorFailure[] = [],
  opts: GeneratorRunOpts,
): WriteResult[] {
  if (keys.has('*')) {
    return runGeneratorsFromRegistry(specs, errors, opts)
  }
  return specs.filter((s) => s.enabled && keys.has(s.key)).flatMap((s) => safeRun(s, opts, errors))
}
