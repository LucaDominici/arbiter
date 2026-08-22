// SPDX-License-Identifier: Apache-2.0
import { levelAtLeast } from '../config/levels.js'
import { getLogger } from '../utils/logger.js'
import { generateAgentsMd } from './agents-md.js'
import type { InstalledSkill } from '../integrations/types.js'
import { computeSkipReport } from './skills.js'
import { generateClaude } from './claude.js'
import { generateCodex } from './codex.js'
import { generateGithub } from './github.js'
import { generateRoot } from './root.js'
import { generateCheckAll } from './check-all.js'
import { generateAntiProforma } from './anti-proforma.js'
import { generateCommitFooter } from './commit-footer.js'
import { generateStackConformity } from './check-stack-conformity.js'
import { generateCursor } from './cursor.js'
import { generateCopilot } from './copilot.js'
import { generateCoverage } from './coverage.js'
import { generateDuplication } from './duplication.js'
import { generateDebtGates } from './debt-gates.js'
import { generateDebtRatchet } from './debt-ratchet.js'
import { generateSuppressions } from './suppressions.js'
import { generateSecurity } from './security.js'
import { generateStrideEnforcement } from './stride-enforcement.js'
import { generateEvidenceRetention } from './evidence-retention.js'
import { generateGitignore } from './gitignore.js'
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
import { generateAntiDriftValidators } from './anti-drift-validators.js'
import { generateBehavioralTests } from './behavioral-tests.js'
import { generatePlaywrightPython } from './playwright-python.js'
import { generatePlaywrightTs } from './playwright-ts.js'
import { generateE2eConstitution } from './e2e-constitution.js'
import { generateGithooks } from './githooks.js'
import { generateShipDriver } from './ship-driver.js'
import { generateGithubSetup } from './github-setup.js'
import { generateDocs } from './docs.js'
import { generateApiMiddleware } from './api-middleware.js'
import { generateSeed } from './seed.js'
import { generateSelfValidation } from './self-validation.js'
import { generateOperations } from './operations.js'
import { generateFrontendGovernance } from './frontend-governance.js'
import { generateFrontendQuality } from './frontend-quality.js'
import { generateRiskRegister } from './risk-register.js'
import { generateCompliance } from './compliance.js'
import { generateComplianceMenu } from './compliance-menu.js'
import { generatePharma } from './pharma.js'
import { generateIso27001 } from './iso27001.js'
import { generateIso9001 } from './iso9001.js'
import { generateRegulated } from './regulated.js'
import { generateObservability } from './observability.js'
import { generateAuth } from './auth.js'
import { generateCiTier } from './ci-tier.js'
import { generateCiFiveLane } from './ci-five-lane.js'
import { generateLocalWrapper } from './local-wrapper.js'
import { generateEnvTemplate } from './env-template.js'
import { generateInfra } from './infra.js'
import { generateAuditToolchain } from './audit-toolchain.js'
import { generatePerfK6 } from './perf-k6.js'
import { generateModulith } from './modulith.js'
import { generateFeatureMatrix } from './feature-matrix.js'
import { generateGap } from './gap.js'
import { generateResilience } from './resilience.js'
import { generateTestPyramidManifest } from './test-pyramid-manifest.js'
import { generateApiE2e } from './api-e2e.js'
import { generateSmokeJourneys } from './smoke-journeys.js'
import { generateSoloException } from './solo-exception.js'
import { generateWiki } from './wiki.js'
import { generatePrTooling } from './pr-tooling.js'
import { generateConformanceScript } from './conformance.js'
import { generateGoldKit } from './gold-kit.js'
import { generateDocSetSkeletons } from './doc-set.js'
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
      // Baseline .gitignore — ALWAYS-ON (B6/#1491, M3). Previously only emitted by
      // evidence-retention (gated on enableEvidenceHarness, off at L1/L2), so L1/L2
      // users committed .arbiter/ + .evidence/ runtime state. skipIfExists keeps it
      // brownfield-safe.
      key: 'baseline-gitignore',
      enabled: true,
      run: (opts) => generateGitignore(config, opts).files,
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

/**
 * #1319.1 — gate-script generators that emit checkers invoked by check-all.mjs.
 * The registry never emitted these, so a virgin-init self-gate failed with a
 * missing-module error. Activation EXACTLY mirrors the corresponding runCheck
 * gating in check-all.mjs.ejs. Extracted from buildInfraSpecs to keep that
 * function under the line ceiling (CANON-22).
 */
function buildGateScriptSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    {
      // check-all.mjs.ejs invokes scripts/check-anti-proforma.mjs UNCONDITIONALLY
      // (outside any governanceLevel guard), so the script must be emitted at every
      // level or the L1 gate false-fails with a missing-module error. The script is
      // warn-default ⇒ greenfield-safe (exits 0 with 0 tests).
      key: 'anti-proforma',
      enabled: true,
      run: (opts) => generateAntiProforma(config, opts).files,
    },
    {
      // check-all.mjs.ejs runs scripts/check-commit-footer-rationale.mjs only inside
      // `<% if (governanceLevel !== 'L1') %>`. Mirror that gating EXACTLY so the
      // script is present whenever it is invoked (L2+) and never dead-emitted at L1.
      // The emitted script fails-OPEN (exit 0 + SKIP) when origin/main is unreachable,
      // so a virgin repo with no upstream does not false-fail (INV-119).
      key: 'commit-footer-rationale',
      enabled: config.governanceLevel !== 'L1',
      run: (opts) => generateCommitFooter(config, opts).files,
    },
    {
      // #1312 (CANON-01, INV-121): stack-conformity gate. check-all.mjs.ejs invokes
      // scripts/check-stack-conformity.mjs inside `<% if (language) %>` (truthy gate),
      // so the registry mirrors it with the same truthy check — emit exactly when the
      // config carries a (non-empty) language. ProjectConfig.language is type-required,
      // but Boolean() keeps the gate textually paired with the template's `if (language)`
      // and tolerant of an empty-string sentinel. Self-safety (absent language in the
      // TARGET arbiter.json ⇒ exit 0) is RUNTIME-resident in the emitted .mjs, not here.
      key: 'stack-conformity',
      enabled: Boolean(config.language),
      run: (opts) => generateStackConformity(config, opts).files,
    },
    {
      // check-all.mjs.ejs invokes scripts/check-test-pyramid.mjs UNCONDITIONALLY
      // (every archetype has ≥1 declared level; manifest absent → SKIP). The gate
      // runs L1 pre-commit so empty-level violations surface immediately.
      key: 'test-pyramid',
      enabled: true,
      run: (opts) => generateTestPyramidManifest(config, opts).files,
    },
    {
      // #1365/INV-126: live-API e2e layer. Always emits api-e2e.json (required flag is
      // archetype-driven); scaffolds the suite + runner only for service archetypes.
      // The check-api-e2e.mjs gate runtime-SKIPs on required:false / absent manifest.
      key: 'api-e2e',
      enabled: true,
      run: (opts) => generateApiE2e(config, opts).files,
    },
    {
      // #2080/INV-137: declarative login/CRUD/authz smoke-journey acceptance floor. Always
      // emits smoke-journeys.json (applicability is archetype×language-computed inside the
      // generator ⇒ non-applicable combos emit applicable:false and the gate runtime-SKIPs);
      // scaffolds a real Playwright starter only for the frontend-spa + TypeScript combo.
      key: 'smoke-journeys',
      enabled: true,
      run: (opts) => generateSmokeJourneys(config, opts).files,
    },
  ]
}

function buildInfraSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    {
      key: 'github',
      // A1 (#1817): enableFiveLaneCi is mutually exclusive with the standard
      // (up to 18-workflow) shape — a fresh repo opting into the collapsed
      // 5-lane doctrine must never end up with the union of both.
      enabled: (config.permitGitHub ?? config.useGitHub) && !config.enableFiveLaneCi,
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
    ...buildGateScriptSpecs(config),
    {
      key: 'debt-gates',
      // Always run: generateDebtGates emits the language-agnostic config-lint pair
      // (.yamllint.yml + .shellcheckrc) for EVERY archetype/level (#1546), then guards
      // the language-specific scaffold internally. It already ran unconditionally for
      // typescript/multi (injectTestScripts, #933 F13) and python (gate-essential
      // ruff.toml + requirements-dev.txt at L1, B4 #1491); now rust/go/java/kotlin at
      // L1 run too so the universal configs land — their debt extras still sit below
      // the in-function enableDebtGates guard.
      enabled: true,
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
      // CANON-22: DRY/duplication gate (jscpd). Dogfooded by arbiter at
      // scripts/check-all.mjs; this emits the same gate to TypeScript targets.
      key: 'duplication',
      enabled: config.enableDebtGates,
      run: (opts) => generateDuplication(config, opts).files,
    },
    {
      key: 'suppressions',
      enabled: true,
      run: (opts) => generateSuppressions(config, opts).files,
    },
    {
      key: 'security',
      // generateSecurity always emits the pure-Node PII baseline; gitleaks,
      // hooks, and ZAP remain internally gated by enableSecurityScanning.
      enabled: true,
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
      // #1290 — thin consumer ship driver (ADR-093). Claude-harness tick prompt for
      // now; the artifact is inert until run (autonomy gating is #1291).
      key: 'ship-driver',
      enabled: config.tools.includes('claude'),
      run: (opts) => generateShipDriver(config, opts).files,
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
      key: 'self-validation',
      enabled: config.enableSelfValidationHarness !== false,
      run: (opts) => generateSelfValidation(config, opts).files,
    },
    {
      key: 'infra',
      enabled:
        config.deployTarget === 'azure-container-app' || config.deployTarget === 'nas-compose',
      run: (opts) => generateInfra(config, opts).files,
    },
  ]
}

/** Specs gated on archetype=backend-web-db + level≠L1 (service-pattern generators). */
function buildBackendServiceSpecs(config: ProjectConfig): GeneratorSpec[] {
  const enabled = config.archetype === BACKEND_WEB_DB && config.governanceLevel !== 'L1'
  return [
    {
      key: 'seed',
      enabled,
      run: (opts) => generateSeed(config, opts).files,
    },
    {
      key: 'resilience',
      enabled,
      run: (opts) => generateResilience(config, opts).files,
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
      enabled:
        config.language === 'java' || config.language === 'kotlin' || config.language === 'multi',
      run: (opts) => generateModulith(config, opts).files,
    },
  ]
}

function buildGovernanceOverlaySpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
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
      // F5 (#888) + #1156: audit-trail overlay — opt-in via industryOverlay.
      // 'pharma' → Java JPA/ArchUnit scaffolding (the generator self-guards on Java);
      // 'sox'|'gdpr'|'generic' → language-neutral audit docs + gate rules.
      // Gated here (not dead): fires only when an overlay is selected.
      key: 'pharma',
      enabled: config.industryOverlay != null && config.industryOverlay !== 'none',
      run: (opts) => generatePharma(config, opts).files,
    },
    {
      // #1252: ISO 27001:2022 Annex-A controls→gate traceability overlay.
      // Self-guards on industryOverlay === 'iso27001'; emits ONLY the
      // ISO-specific traceability doc (the generic audit docs are emitted by the
      // 'pharma' spec above, which fires for any non-none overlay).
      key: 'iso27001-controls',
      enabled: config.industryOverlay === 'iso27001',
      run: (opts) => generateIso27001(config, opts).files,
    },
    {
      // #1253: ISO 9001 quality-process overlay (RTM + doc-control + CAPA + gate).
      // Orthogonal to the audit-trail 'pharma' spec above; fires only for iso9001.
      key: 'iso9001',
      enabled: config.industryOverlay === 'iso9001',
      run: (opts) => generateIso9001(config, opts).files,
    },
    {
      // Regulated / high-assurance overlay: bundles separation-of-duties (human
      // approval on AI PRs), audit retention, suppression-expiry, signing/SBOM,
      // and a mutation-coverage floor into one fail-closed policy gate. Fires only
      // for industryOverlay === 'regulated'. The generic audit-trail docs come from
      // the 'pharma' spec above (gate: overlay != 'none'); this adds the regulated
      // bundle (manifest + gate + policy doc).
      key: 'regulated-overlay',
      enabled: config.industryOverlay === 'regulated',
      run: (opts) => generateRegulated(config, opts).files,
    },
    {
      // #1254: (team × compliance) menu doc. Always-on onboarding aid presenting
      // every collaborationMode × industryOverlay cell + (overlay × level) coherence.
      key: 'compliance-menu',
      enabled: true,
      run: (opts) => generateComplianceMenu(config, opts).files,
    },
    {
      // 'solo-exception' → §11.10(k) regulated single-dev pack: attestation doc,
      // validation-evidence template, CI mental model, reactivation check script.
      // Only fires for trunk-solo at L3/L4 (ADR-091).
      key: 'solo-exception',
      enabled:
        config.collaborationMode === 'trunk-solo' && levelAtLeast(config.governanceLevel, 'L3'),
      run: (opts) => generateSoloException(config, opts).files,
    },
  ]
}

function buildAnalysisSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    ...buildBoundarySpecs(config),
    {
      // Audit toolchain (audit.json + helper scripts). #1835: was always-on but never
      // wired into check-all.mjs (a dead emission on every project) — made explicit
      // opt-in. Relocated here from buildInfraSpecs (#1319.1) to keep that function
      // under the line ceiling after wiring the anti-proforma/commit-footer gate scripts.
      key: 'audit-toolchain',
      enabled: config.enableAuditToolchain === true,
      run: (opts) => generateAuditToolchain(config, opts).files,
    },
    {
      key: 'mutation',
      enabled: config.enableMutationTesting !== false,
      run: (opts) => generateMutation(config, opts).files,
    },
    {
      key: 'ci-tier',
      // A1 (#1817): five-lane mode owns its own minimal infra; the standard
      // notify/label-sync/setup-action bundle stays off so file count holds
      // at exactly 4 workflows (AC: arbiter init on a fresh repo emits ≤5).
      enabled: (config.permitGitHub ?? config.useGitHub) && !config.enableFiveLaneCi,
      run: (opts) => generateCiTier(config, opts).files,
    },
    {
      // A1+A6 (#1817): collapsed 5-lane CI doctrine (pre-commit local +
      // ci/nightly/weekly/release workflows) + shared sticky-failure-issue
      // script. Opt-in, mutually exclusive with 'github'/'ci-tier' above.
      key: 'ci-five-lane',
      enabled: (config.permitGitHub ?? config.useGitHub) && config.enableFiveLaneCi === true,
      run: (opts) => generateCiFiveLane(config, opts).files,
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
      key: 'test-taxonomy',
      enabled: true,
      run: (opts) => generateTestTaxonomy(config, opts).files,
    },
    {
      key: 'operations',
      enabled: config.enableOperationsHandbook === true,
      run: (opts) => generateOperations(config, opts).files,
    },
    ...buildGovernanceOverlaySpecs(config),
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
      // #1606: a polyglot (multi) repo's frontend is a TS SPA — give it the same
      // Playwright a11y/render harness a pure-TS repo gets (otherwise silently stripped).
      enabled:
        (config.language === 'typescript' || config.language === 'multi') &&
        (config.archetype === 'frontend-spa' || config.archetype === BACKEND_WEB_DB),
      run: (opts) => generatePlaywrightTs(config, opts).files,
    },
    {
      // #1817 (A4): installable E2E constitution — same applicability as the two
      // playwright-* entries above combined, independent of language (stack-agnostic).
      key: 'e2e-constitution',
      enabled: config.archetype === 'frontend-spa' || config.archetype === BACKEND_WEB_DB,
      run: (opts) => generateE2eConstitution(config, opts).files,
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
    ...buildBackendServiceSpecs(config),
    ...buildAnalysisSpecs(config),
    ...buildPerfSpecs(config),
    ...buildProviderSpecs(config),
    {
      key: 'anti-drift-validators' as const,
      enabled: true,
      run: (opts) => generateAntiDriftValidators(config, opts).files,
    },
    {
      key: 'feature-matrix',
      enabled: config.governanceLevel !== 'L1',
      run: (opts) => generateFeatureMatrix(config, opts).files,
    },
    {
      key: 'gap',
      enabled: config.governanceLevel !== 'L1',
      run: (opts) => generateGap(config, opts).files,
    },
    {
      key: 'wiki',
      enabled: config.governanceLevel !== 'L1',
      run: (opts) => generateWiki(config, opts).files,
    },
    {
      // #2098: pr-merge-watch (merge-on-green watcher) + capacity-probe
      // (queue-depth advisory) + their shared waiter-count helper.
      // Orchestration glue, not gate infrastructure — always-on like
      // conformance/gold-kit, no governance-level gate.
      key: 'pr-tooling',
      enabled: true,
      run: (opts) => generatePrTooling(config, opts).files,
    },
    {
      // #1398 (INV-128): conformance scorecard runner — always-on; the script delegates
      // to `arbiter conformance --check` via npx (no local install required).
      key: 'conformance',
      enabled: true,
      run: (opts) => generateConformanceScript(config, opts).files,
    },
    {
      // #1419: downstream gold-audit kit — thin runner (delegates to `npx arbiter
      // gold-audit --check`) + consumer-DATA standards (registry, thresholds, doc-set,
      // doc-profile). No engine copy, no `yaml` dep, no baseline seed. Always-on.
      key: 'gold-kit',
      enabled: true,
      run: (opts) => generateGoldKit(config, opts).files,
    },
    {
      // T3 (gold-doc-tranches-t3-t5.md §1.2c): real per-doc-type skeleton bodies for gaps the
      // gold-kit manifest declares — shells check-doc-set.mjs (via runDocSet), never a second
      // resolution engine. Runs immediately after gold-kit so the manifest it reads is already
      // on disk in a real (non-dry-run) run; the dry-run edge (manifest not yet emitted) is
      // handled honestly inside generateDocSetSkeletons (SKIP, not a phantom plan). Always-on:
      // right-sizing (which rows even appear in `missing[]`) is the engine's job, not a gate here.
      key: 'doc-set-skeletons',
      enabled: true,
      run: (opts) => generateDocSetSkeletons(config, opts).files,
    },
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
