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
import { generateEslintBoundaries } from './boundaries.js'
import { generateRustBoundaries } from './rust-boundaries.js'
import { generateGoBoundaries } from './go-boundaries.js'
import { generatePythonBoundaries } from './python-boundaries.js'
import { generateMutation } from './mutation.js'
import { generateNightly } from './nightly.js'
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
import { generateRiskRegister } from './risk-register.js'
import { generateCompliance } from './compliance.js'
import { generateObservability } from './observability.js'
import { generateAuth } from './auth.js'
import { generateCiTier } from './ci-tier.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'
import type { GeneratorKey } from '../config/diff.js'

export interface GeneratorSpec {
  key: GeneratorKey
  enabled: boolean
  run: () => WriteResult[]
}

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
      run: () => [generateAgentsMd(config, installedSkills, skipReport)],
    },
    {
      key: 'global-invariants',
      enabled: true,
      run: () => [generateGlobalInvariants(config)],
    },
    {
      key: 'claude',
      enabled: noAiRulez && config.tools.includes('claude'),
      run: () => generateClaude(config).files,
    },
    {
      key: 'codex',
      enabled: noAiRulez && config.tools.includes('codex'),
      run: () => generateCodex(config).files,
    },
    {
      key: 'cursor',
      enabled: noAiRulez && config.tools.includes('cursor'),
      run: () => generateCursor(config).files,
    },
    {
      key: 'copilot',
      enabled: noAiRulez && config.tools.includes('copilot'),
      run: () => generateCopilot(config).files,
    },
    {
      key: 'gemini',
      enabled: noAiRulez && config.tools.includes('gemini'),
      run: () => generateGemini(config).files,
    },
    {
      key: 'windsurf',
      enabled: noAiRulez && config.tools.includes('windsurf'),
      run: () => generateWindsurf(config).files,
    },
    {
      key: 'aider',
      enabled: noAiRulez && config.tools.includes('aider'),
      run: () => generateAider(config).files,
    },
    {
      key: 'skills',
      enabled: noAiRulez,
      run: () => generateSkills(config, installedSkills).files,
    },
    {
      key: 'agents-claude',
      enabled: noAiRulez,
      run: () => generateAgentsClaude(config).files,
    },
  ]
}

function buildInfraSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    {
      key: 'github',
      enabled: config.useGitHub,
      run: () => generateGithub(config).files,
    },
    {
      key: 'root',
      enabled: config.useGitHub,
      run: () => generateRoot(config).files,
    },
    {
      key: 'check-all',
      enabled: true,
      run: () => generateCheckAll(config).files,
    },
    {
      key: 'debt-gates',
      enabled: config.enableDebtGates,
      run: () => generateDebtGates(config).files,
    },
    {
      key: 'debt-ratchet',
      enabled: config.enableDebtGates,
      run: () => generateDebtRatchet(config).files,
    },
    {
      key: 'coverage',
      enabled: config.enableDebtGates,
      run: () => generateCoverage(config).files,
    },
    {
      key: 'suppressions',
      enabled: true,
      run: () => generateSuppressions(config).files,
    },
    {
      key: 'security',
      enabled: config.enableSecurityScanning,
      run: () => generateSecurity(config).files,
    },
    {
      key: 'stride-enforcement',
      enabled: config.enableDebtGates,
      run: () => generateStrideEnforcement(config).files,
    },
    {
      key: 'githooks',
      enabled: true,
      run: () => generateGithooks(config).files,
    },
    {
      key: 'github-setup',
      enabled: config.useGitHub && config.governanceLevel !== 'L1',
      run: () => generateGithubSetup(config).files,
    },
    {
      key: 'docs',
      enabled: config.governanceLevel !== 'L1',
      run: () => generateDocs(config).files,
    },
    {
      key: 'api-middleware',
      enabled: config.hasPublicApi,
      run: () => generateApiMiddleware(config).files,
    },
    {
      key: 'seed',
      enabled: config.archetype === 'backend-web-db' && config.governanceLevel !== 'L1',
      run: () => generateSeed(config).files,
    },
    {
      key: 'self-validation',
      enabled: config.enableSelfValidationHarness !== false,
      run: () => generateSelfValidation(config).files,
    },
  ]
}

function buildAnalysisSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    {
      key: 'archunit',
      enabled: true,
      run: () => generateArchUnit(config).files,
    },
    {
      key: 'eslint-boundaries',
      enabled: true,
      run: () => generateEslintBoundaries(config).files,
    },
    {
      key: 'rust-boundaries',
      enabled: true,
      run: () => generateRustBoundaries(config).files,
    },
    {
      key: 'go-boundaries',
      enabled: true,
      run: () => generateGoBoundaries(config).files,
    },
    {
      key: 'python-boundaries',
      enabled: true,
      run: () => generatePythonBoundaries(config).files,
    },
    {
      key: 'mutation',
      enabled: config.enableMutationTesting !== false,
      run: () => generateMutation(config).files,
    },
    { key: 'nightly', enabled: true, run: () => generateNightly(config).files },
    { key: 'ci-tier', enabled: true, run: () => generateCiTier(config).files },
    {
      // #487: this is DATABASE integration-testing (Testcontainers + PostgreSQL).
      // API-only projects (no DB but with public API) are served by `contract-testing`
      // below — gated on config.contractType (Pact). Do NOT broaden this gate to
      // `hasDatabase || hasPublicApi`; every template here hardcodes PostgreSQL and
      // would emit broken DB scaffolding for an API-only project.
      key: 'integration-testing',
      enabled: config.hasDatabase,
      run: () => generateIntegrationTesting(config).files,
    },
    {
      // Companion to integration-testing above: covers API-only / contract paths.
      key: 'contract-testing',
      enabled: config.enableContractTesting !== false,
      run: () => generateContractTesting(config).files,
    },
    {
      key: 'evidence-retention',
      enabled: config.enableEvidenceHarness !== false,
      run: () => generateEvidenceRetention(config).files,
    },
    {
      key: 'evidence-backlog',
      enabled: config.governanceLevel !== 'L1',
      run: () => generateEvidenceBacklog(config).files,
    },
    {
      key: 'test-taxonomy',
      enabled: true,
      run: () => generateTestTaxonomy(config).files,
    },
    {
      key: 'operations',
      enabled: config.enableOperationsHandbook === true,
      run: () => generateOperations(config).files,
    },
    {
      key: 'risk-register',
      enabled: config.enableRiskRegister === true,
      run: () => generateRiskRegister(config).files,
    },
    {
      key: 'compliance',
      enabled:
        config.enableIso27001Mapping === true ||
        config.enableNis2Mapping === true ||
        config.enableGdprMapping === true,
      run: () => generateCompliance(config).files,
    },
    {
      key: 'behavioral-tests',
      enabled: true,
      run: () => generateBehavioralTests(config).files,
    },
    {
      key: 'playwright-python',
      enabled:
        config.language === 'python' &&
        (config.archetype === 'frontend-spa' || config.archetype === 'backend-web-db'),
      run: () => generatePlaywrightPython(config).files,
    },
    {
      key: 'playwright-ts',
      enabled:
        config.language === 'typescript' &&
        (config.archetype === 'frontend-spa' || config.archetype === 'backend-web-db'),
      run: () => generatePlaywrightTs(config).files,
    },
    { key: 'ssot', enabled: true, run: () => generateSsot(config).files },
  ]
}

function buildProviderSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    {
      key: 'observability',
      enabled: config.observability != null && config.observability.provider !== 'none',
      run: () => generateObservability(config).files,
    },
    {
      key: 'auth',
      enabled: config.auth != null && config.auth.provider !== 'none',
      run: () => generateAuth(config).files,
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
    ...buildProviderSpecs(config),
  ]
}

function safeRun(spec: GeneratorSpec, errors: GeneratorFailure[]): WriteResult[] {
  try {
    return spec.run()
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
): WriteResult[] {
  return specs.filter((s) => s.enabled).flatMap((s) => safeRun(s, errors))
}

export function runGeneratorsSelective(
  specs: GeneratorSpec[],
  keys: Set<GeneratorKey | '*'>,
  errors: GeneratorFailure[] = [],
): WriteResult[] {
  if (keys.has('*')) {
    return runGeneratorsFromRegistry(specs, errors)
  }
  return specs.filter((s) => s.enabled && keys.has(s.key)).flatMap((s) => safeRun(s, errors))
}
