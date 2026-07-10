// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from init.ts — L3 maturity capability
// derivation and the two pre-generation coherence gates (maturity, collaboration
// mode). Pure extraction, no behavior change.
import { t } from '../../i18n/index.js'
import { levelAtLeast } from '../../config/levels.js'
import { buildRegistry } from '../../generators/registry.js'
import type { GeneratorSpec } from '../../generators/registry.js'
import { resolveStyle } from '../../generators/github.js'
import { resolveServiceBucket } from '../../utils/render.js'
import { isL3Allowed, hasMatrixCell } from '../../utils/maturity-check.js'
import type { MaturityFeature } from '../../utils/maturity-check.js'
import {
  validateCollaborationCoherence,
  validateLanguageArchetypeCoherence,
} from '../wizard/coherence.js'
import type { ProjectConfig, Language } from '../../wizard/types.js'

/** A single (matrix dimension × effective tool-language) the L3 gate must consult. */
export interface L3MaturityCapability {
  feature: MaturityFeature
  /** The language whose TOOL is actually emitted — not always config.language (#1606). */
  language: Language
}

/**
 * #1678: map ONE enabled generator to the matrix dimension(s) it emits + the EFFECTIVE
 * tool-language for each. The effective language is `config.language` for per-language
 * tooling, but a FIXED tool-language where the emitted binding is language-specific:
 *  - frontend `style_tokens` is always stylelint (typescript);
 *  - `playwright-ts` runs the proven TS axe/Playwright binding even for a `multi` repo
 *    (#1606) — so a11y/e2e resolve to typescript, never the unmodeled 'multi';
 *  - `playwright-python` runs the python binding → python.
 * Generators with no matrix dimension return [].
 */
function capabilitiesForGenerator(
  key: GeneratorSpec['key'],
  config: ProjectConfig,
): L3MaturityCapability[] {
  switch (key) {
    case 'mutation':
      return [{ feature: 'mutation', language: config.language }]
    case 'contract-testing':
      return [{ feature: 'contract', language: config.language }]
    case 'coverage':
      return [{ feature: 'coverage', language: config.language }]
    case 'security':
      return [{ feature: 'security', language: config.language }]
    case 'debt-gates':
      return [{ feature: 'static_analysis', language: config.language }]
    case 'behavioral-tests':
      return [{ feature: 'bdd', language: config.language }]
    // architecture is emitted by the always-on boundary generators; one representative
    // key avoids N duplicate (architecture, config.language) rows (deduped anyway).
    case 'archunit':
      return [{ feature: 'architecture', language: config.language }]
    case 'frontend-quality':
      return [{ feature: 'style_tokens', language: 'typescript' }]
    case 'playwright-ts':
      return [
        { feature: 'a11y', language: 'typescript' },
        { feature: 'e2e', language: 'typescript' },
      ]
    case 'playwright-python':
      return [
        { feature: 'a11y', language: 'python' },
        { feature: 'e2e', language: 'python' },
      ]
    // #1678: the 'github' registry key emits all CI workflow templates. The
    // workflow-template-emitted dims (fuzz/dast/sbom/etc.) are derived from the emission
    // plan via deriveWorkflowCapabilities. Routed through this case (not iterated
    // separately) so the existing spec.enabled check gates it: workflow caps are
    // consulted only when github is actually emitted (no false-block when disabled).
    case 'github':
      return deriveWorkflowCapabilities(config)
    default:
      return []
  }
}

/**
 * #1725: resolve the effective tool-language(s) the workflow-emitted dims should be
 * gated against. `hasMatrixCell` has no explicit cell for the unmodeled `'multi'`
 * pseudo-language, so gating a workflow capability against the raw `'multi'` value
 * causes the gate to silently skip ALL 8 workflow dims for a polyglot repo — a
 * false-pass, not a correct "no opinion" skip. A `multi` repo's generated CI workflows
 * actually emit BOTH the TypeScript and Java/JVM toolchains, so resolve to their union —
 * mirroring the established `probe.ts` `matrixEntriesFor`/`buildProbesFor` precedent
 * (`case 'multi': return [...MATRIX.typescript, ...MATRIX.java]`). Every other language
 * is already a modelled matrix key and resolves to itself.
 */
function resolveWorkflowLanguages(language: Language): Language[] {
  return language === 'multi' ? ['typescript', 'java'] : [language]
}

/**
 * #1678: derive the workflow-template-emitted L3 maturity capabilities from the actual
 * emission plan (the github.ts + EJS predicates), so the L3 gate consults the dims the CI
 * workflows will really run. Mirrors `src/generators/github.ts` emission predicates + the
 * EJS job-level `_isService` guards; the drift-detection test
 * (`init-l3-workflow-drift.test.ts`) verifies the mirror against the rendered workflows.
 * `hasMatrixCell` skips truly unmodelled cells (no false-block) — see the #1724 follow-up
 * for the kotlin matrix-gap (kotlin isn't gated on these dims yet); `multi` is resolved to
 * its modelled constituent languages by `resolveWorkflowLanguages` (#1725).
 * Exported for unit + drift tests.
 */
export function deriveWorkflowCapabilities(config: ProjectConfig): L3MaturityCapability[] {
  // The L3 gate is a floor, not an exact match — L4 must stay gated too (#1732 cascade).
  if (!levelAtLeast(config.governanceLevel, 'L3')) return []
  const c = workflowCtx(config)
  const langs = resolveWorkflowLanguages(config.language)
  return WORKFLOW_DIM_RULES.filter((r) => r.emit(c))
    .flatMap((r) => r.dims)
    .flatMap((feature) => langs.map((language) => ({ feature, language })))
}

/**
 * #1678: the workflow-dim emission rules — one row per dim (or dim group sharing a
 * predicate), mirroring the github.ts + EJS emission predicates. Data-driven so
 * deriveWorkflowCapabilities stays under the complexity ceiling (the decision points live
 * in the small per-row predicates, not in a branched function body). See the inline
 * comments for the emission source of each dim; the drift test verifies the mirror.
 */
const WORKFLOW_DIM_RULES: ReadonlyArray<{
  dims: MaturityFeature[]
  emit: (c: WorkflowCtx) => boolean
}> = [
  // 02-pr-extended license-scan job — always, not service-guarded.
  { dims: ['license_scan'], emit: () => true },
  // 01-pr-fast gitleaks (enableSecurityScanning) OR 05/_nightly (style !== starter) OR
  // 07-weekly-lite (cm === trunk-solo).
  {
    dims: ['secret_scan'],
    emit: (c) => c.secScanning || c.style !== 'starter' || c.cm === 'trunk-solo',
  },
  // 02-pr-extended Trivy (service) OR 04-deploy-test Trivy (deploy).
  { dims: ['container_scan'], emit: (c) => c.isService || c.deploy },
  // 05-release (style !== starter) OR 04/10-deploy.
  { dims: ['sbom', 'binary_signing'], emit: (c) => c.style !== 'starter' || c.deploy },
  // 05-release slsa-provenance/attest-build-provenance ONLY (style !== starter). 04 emits
  // SBOM attestation (sbom dim); 10's provenance gate is cosign verify (consume).
  { dims: ['provenance'], emit: (c) => c.style !== 'starter' },
  // _nightly fuzz job (scheduled suite).
  { dims: ['fuzz'], emit: (c) => c.isScheduled },
  // _shared-security dast-full (scheduled + service) OR 04-deploy-test dast-baseline (deploy).
  { dims: ['dast'], emit: (c) => (c.isScheduled && c.isService) || c.deploy },
]

/**
 * #1678: the workflow-emission context the gate derives from, computed once. Extracted
 * from deriveWorkflowCapabilities to keep that function under the complexity ceiling
 * (decision points live here, not in the dim branches).
 */
interface WorkflowCtx {
  style: 'starter' | 'standard' | 'industrial'
  cm: string
  deploy: boolean
  isService: boolean
  isScheduled: boolean
  secScanning: boolean
}

function workflowCtx(config: ProjectConfig): WorkflowCtx {
  const style = resolveStyle(config)
  const cm = config.collaborationMode ?? 'peer-review'
  return {
    style,
    cm,
    deploy: (config.deployTarget ?? 'none') !== 'none',
    isService: resolveServiceBucket(config.archetype) === 'service',
    isScheduled: style !== 'starter' && cm !== 'trunk-solo', // scheduled suite at L3
    secScanning: config.enableSecurityScanning,
  }
}

/**
 * #1678: derive the L3 maturity checks from the ACTUAL emission plan rather than a
 * hard-coded feature list. Iterates the enabled registry specs, maps each to its matrix
 * dimension(s) + effective tool-language, drops dimensions the matrix has no cell for
 * (an unmodeled language×dim such as anything on a polyglot `multi` core — blocking
 * those would be the #1606 false-positive generalised), and dedupes.
 *
 * `specs` is injected (the caller passes `buildRegistry(config)`) so the pure mapping
 * is unit-testable without the init machinery and without re-deriving enabled-ness.
 */
export function deriveL3MaturityChecks(
  config: ProjectConfig,
  specs: GeneratorSpec[],
): L3MaturityCapability[] {
  const seen = new Set<string>()
  const checks: L3MaturityCapability[] = []
  for (const spec of specs) {
    if (!spec.enabled) continue
    for (const cap of capabilitiesForGenerator(spec.key, config)) {
      if (!hasMatrixCell(cap.language, cap.feature)) continue
      const dedupeKey = `${cap.feature}:${cap.language}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      checks.push(cap)
    }
  }
  return checks
}

/**
 * Gate check for L3 maturity. Blocks generation when any capability the emission plan
 * will ACTUALLY emit resolves to beta/unsafe/unavailable in the cross-language matrix
 * without --accept-beta-tools (#1678 — driven by the registry, not a hard-coded list).
 * Exits the process with an actionable error message on violation.
 */
export function checkL3MaturityGates(config: ProjectConfig): void {
  if (!levelAtLeast(config.governanceLevel, 'L3')) return

  const accept = config.acceptBetaTools ?? false
  const blocked: string[] = []

  for (const { feature, language } of deriveL3MaturityChecks(config, buildRegistry(config))) {
    const result = isL3Allowed(language, feature, accept)
    if (!result.allowed && result.errorMessage) {
      blocked.push(`  • ${result.errorMessage}`)
    }
  }

  if (blocked.length > 0) {
    process.stderr.write(`${t('cli.init.gate_failed')}\n`)
    for (const msg of blocked) {
      process.stderr.write(`${msg}\n`)
    }
    process.stderr.write(`${t('cli.init.accept_beta_hint')}\n`)
    process.exit(1)
  }
}

/**
 * #1347: Gate (collaborationMode × governanceLevel) coherence at the init
 * pre-generation point — the same place checkL3MaturityGates aborts — so a
 * CRITICAL cell (e.g. L4 × trunk-solo, ADR-050/ADR-051) is refused BEFORE any
 * files are written, instead of being surfaced only later by `arbiter doctor`.
 * Reuses the SAME shared matrix doctor uses (validateCollaborationCoherence);
 * the rule lives in one place to avoid divergence.
 */
export function checkCollaborationCoherenceGate(config: ProjectConfig): void {
  // #1347: advisory language × archetype axis — WARN only, never blocks. Surfaced
  // at the same pre-init gate (and in `arbiter doctor`) so the two guardrail paths
  // read one coherence SSOT. Printed before the collaboration check so the user
  // sees it even when the collaboration cell aborts.
  const langArch = validateLanguageArchetypeCoherence(config.language, config.archetype)
  if (langArch.severity === 'WARN') {
    process.stdout.write(`\n  ⚠ ${langArch.message}\n`)
  }

  if (config.collaborationMode === undefined) return
  const result = validateCollaborationCoherence(config.collaborationMode, config.governanceLevel)
  if (result.severity !== 'CRITICAL') return
  process.stderr.write(`${t('cli.init.coherence_gate_failed')}\n`)
  process.stderr.write(`  • ${result.message}\n`)
  if (result.remediation !== undefined) {
    process.stderr.write(`  ${result.remediation}\n`)
  }
  process.exit(1)
}
