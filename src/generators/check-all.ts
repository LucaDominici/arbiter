// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { resolveEffectiveThresholds } from '../config/thresholds.js'
import { resolveCollaborationMode } from '../config/collaboration-mode-defaults.js'
import { isSubtreeFrontendLane } from '../detectors/lanes.js'
import { levelAtLeast, LEVEL_ORDER } from '../config/levels.js'
import { parse as parseYaml } from 'yaml'
import type { Archetype, ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

/**
 * #2041 (AC-2041.4): the declarative gate registry — every gate the emitted
 * check-all.mjs runs, with its level/name/kind/cmd. Rendered from
 * gate-registry.yml.ejs (EJS expressions resolve with the project config) and
 * parsed here; shape-validated so a malformed registry fails generation LOUD.
 */
export interface GateRegistryEntry {
  id: string
  name: string
  level: 'L1' | 'L2' | 'L3'
  kind: 'check' | 'warn' | 'tool' | 'inline'
  cmd?: string[]
  language?: string
  /** Generation-time condition — resolved against the render data (e.g. useGitHub). */
  emitIf?: string
  /** Runtime condition — wrapped as `if (<expr>)` in the emitted script (gateFilePresent/existsSync). */
  condition?: string
  else?: string
  soft?: boolean
  /**
   * #9003 — this gate is the promoted ("full-strength") variant of the base
   * gate whose id is named here. When the requested run level is high enough
   * for THIS gate's own `level` to execute (same L1⊆L2⊆L3 containment as
   * everything else), the base gate is skipped at runtime in its favor —
   * e.g. an L3 `harness-full` gate with `promotes_to: harness-fast`.
   * Optional; a gate with no `promotes_to` behaves exactly as today.
   */
  promotes_to?: string
  /**
   * #9003 — marks a gate as audit-only: a second axis orthogonal to level.
   * Skipped at runtime when the consumer sets `ARBITER_AUDIT_MODE=off`
   * (default: gates run). Optional; a gate with no `audit` behaves exactly
   * as today.
   */
  audit?: boolean
}

const VALID_LEVELS = new Set(['L1', 'L2', 'L3'])
const VALID_KINDS = new Set(['check', 'warn', 'tool', 'inline'])

// Normalize the render data the registry's EJS expressions rely on — the same
// derivations the check-all.mjs.ejs template computes for itself: packageManager
// default, the L3 ratchet flag, and the FE source glob. isL3Plus is DERIVED
// from governanceLevel here (renderTemplate injects the same booleans via
// withRenderDefaults, but loadGateRegistry runs BEFORE that injection —
// reading data['isL3Plus'] directly would always see undefined and emit the
// L2 ratchet flag even for an L3 project, #2041).
function deriveGateRegistryRenderData(data: Record<string, unknown>): Record<string, unknown> {
  const fe = (data['frontend'] as { framework?: string } | undefined)?.framework ?? 'react'
  const feGlob =
    fe === 'vue'
      ? 'src/**/*.{ts,vue}'
      : fe === 'svelte'
        ? 'src/**/*.{ts,svelte}'
        : 'src/**/*.{ts,tsx,jsx}'
  const govLevel = data['governanceLevel']
  const isL3Plus =
    typeof govLevel === 'string' &&
    (LEVEL_ORDER as readonly string[]).includes(govLevel) &&
    levelAtLeast(govLevel as 'L1' | 'L2' | 'L3' | 'L4', 'L3')
  return {
    ...data,
    packageManager: data['packageManager'] ?? 'npm',
    ratchetFlag: isL3Plus ? '--require-improvement' : '--gate',
    _feGlob: feGlob,
  }
}

// Parse + shape-check the rendered YAML down to its raw `gates` array —
// everything about the entries themselves is normalizeGateEntry's job.
function parseGateRegistryYaml(rendered: string): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = parseYaml(rendered)
  } catch (err) {
    throw new Error(
      `gate registry: invalid YAML in gate-registry.yml.ejs — ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
  // parsed can legitimately be null (an empty YAML document) — the cast is
  // honest about that so the optional-chain null-check stays real, not a
  // type-checker-only assertion papering over a possible runtime throw.
  const raw = (parsed as { gates?: unknown } | null | undefined)?.gates
  if (!Array.isArray(raw)) {
    throw new Error('gate registry: missing "gates" array')
  }
  return raw as Record<string, unknown>[]
}

// id/level/kind/cmd shape validation for one raw gate entry (throws LOUD on
// any malformed field); `seen` tracks duplicate ids across the whole registry.
function validateGateEntryShape(
  entry: Record<string, unknown>,
  seen: Set<string>,
): { id: string; level: GateRegistryEntry['level']; kind: GateRegistryEntry['kind'] } {
  const id = entry['id']
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('gate registry: every gate needs a string id')
  }
  if (seen.has(id)) throw new Error(`gate registry: duplicate gate id "${id}"`)
  seen.add(id)
  const level = entry['level']
  if (typeof level !== 'string' || !VALID_LEVELS.has(level)) {
    throw new Error(`gate registry: gate "${id}" has invalid level ${String(level)}`)
  }
  const kind = entry['kind']
  if (typeof kind !== 'string' || !VALID_KINDS.has(kind)) {
    throw new Error(`gate registry: gate "${id}" has invalid kind ${String(kind)}`)
  }
  if (kind !== 'inline' && !Array.isArray(entry['cmd'])) {
    throw new Error(`gate registry: non-inline gate "${id}" needs a cmd array`)
  }
  if (kind === 'inline' && entry['cmd'] !== undefined) {
    throw new Error(
      `gate registry: inline gate "${id}" must not declare cmd (bodies live in the template)`,
    )
  }
  return { id, level: level as GateRegistryEntry['level'], kind: kind as GateRegistryEntry['kind'] }
}

// cmd is declared as `[bin, [arg, ...]]` in the YAML (readable flow form);
// flattened to `[bin, arg, ...]` for the render loop (g.cmd.slice(1) = args).
function flattenGateCmd(entry: Record<string, unknown>): string[] | undefined {
  const rawCmd = entry['cmd'] as unknown[] | undefined
  if (rawCmd === undefined) return undefined
  return [String(rawCmd[0]), ...((rawCmd[1] as unknown[] | undefined) ?? []).map(String)]
}

function normalizeGateEntry(entry: Record<string, unknown>, seen: Set<string>): GateRegistryEntry {
  const { id, level, kind } = validateGateEntryShape(entry, seen)
  const flatCmd = flattenGateCmd(entry)
  return {
    id,
    name: String(entry['name']),
    level,
    kind,
    ...(flatCmd !== undefined ? { cmd: flatCmd } : {}),
    ...(typeof entry['language'] === 'string' ? { language: entry['language'] } : {}),
    ...(typeof entry['emitIf'] === 'string' ? { emitIf: entry['emitIf'] } : {}),
    ...(typeof entry['condition'] === 'string' ? { condition: entry['condition'] } : {}),
    ...(typeof entry['else'] === 'string' ? { else: entry['else'] } : {}),
    ...(entry['soft'] === true ? { soft: true } : {}),
    ...(typeof entry['promotes_to'] === 'string' ? { promotes_to: entry['promotes_to'] } : {}),
    ...(entry['audit'] === true ? { audit: true } : {}),
  }
}

// #9003: a `promotes_to` value must reference a real gate id in the SAME
// registry — a typo would otherwise silently never suppress anything and
// fail loud only at runtime (or never), matching the loud-by-construction
// intent of the duplicate-id check above.
export function validatePromotions(entries: GateRegistryEntry[]): void {
  const ids = new Set(entries.map((e) => e.id))
  for (const entry of entries) {
    if (entry.promotes_to === undefined) continue
    if (!ids.has(entry.promotes_to)) {
      throw new Error(
        `gate registry: gate "${entry.id}" promotes_to unknown gate id "${entry.promotes_to}"`,
      )
    }
    // #9003: the runtime suppression of the base gate is decided ONLY from
    // the registry (level + promotes_to) — it never consults the promoting
    // gate's own runtime `condition`. A promoting gate that ALSO carries a
    // runtime `condition` (the gateFilePresent idiom every script-backed
    // gate uses) can self-skip when the condition is false, while the base
    // it suppresses is unconditionally gone — neither gate runs, silently.
    // Fail loud at generation time instead of allowing that fake-green class.
    // (emitIf is NOT checked here: it filters entries out of GATE_REGISTRY
    // entirely at generation time, before loadGateRegistry even sees them, so
    // a false emitIf can never populate the runtime `_promotedAway` set.)
    if (entry.condition !== undefined || entry.else !== undefined) {
      throw new Error(
        `gate registry: gate "${entry.id}" declares promotes_to and a runtime condition/else — ` +
          'a false condition would suppress both gates silently',
      )
    }
    // An inline gate's body is a hardcoded EJS branch matched on `g.id` in
    // check-all.mjs.ejs (INLINE_BLOCKS) — a promoting gate declared `inline`
    // with no matching branch emits nothing while still counting as "this
    // level is reached" for _promotedAway, again suppressing both gates.
    if (entry.kind === 'inline') {
      throw new Error(
        `gate registry: gate "${entry.id}" declares promotes_to and kind: inline — ` +
          'an inline gate with no matching template branch would suppress both gates silently',
      )
    }
  }
}

export function loadGateRegistry(data: Record<string, unknown>): GateRegistryEntry[] {
  const registryData = deriveGateRegistryRenderData(data)
  const rendered = renderTemplate('scripts/gate-registry.yml.ejs', registryData)
  const raw = parseGateRegistryYaml(rendered)
  const seen = new Set<string>()
  const entries = raw.map((entry) => normalizeGateEntry(entry, seen))
  validatePromotions(entries)
  return entries
}

/**
 * #359 Phase 7G — release binary size budget per archetype (bytes). Inlined
 * (not exported) to avoid expanding the public API surface; kept in sync with
 * the matching copy in src/generators/coverage.ts.
 */
function binarySizeBudget(archetype: Archetype): number {
  const MB = 1024 * 1024
  if (archetype === 'cli') return 10 * MB
  if (archetype === 'embedded') return 5 * MB
  return 0
}

export interface CheckAllGeneratorResult {
  files: WriteResult[]
}

/**
 * #1319.8 (CANON-01, INV-30): emit the greenfield-aware coverage gate predicate
 * for TypeScript projects with coverage enabled. check-all.mjs imports
 * evaluateCoverageGate from ./lib/coverage-gate.mjs to decide PASS (greenfield,
 * zero executable statements) vs threshold-enforcement vs FAIL (no/malformed
 * summary). Only TS uses vitest+coverage-summary.json; other languages enforce
 * coverage via their native toolchain (tarpaulin/jacoco/coverage.py). Extracted
 * to keep generateCheckAll under the complexity/line ceiling (CANON-22).
 */
function emitCoverageGate(
  base: string,
  data: { language: string; enableDebtGates: boolean; coverageEnabled: boolean },
  opts: { dryRun: boolean },
): WriteResult[] {
  if (!(data.language === 'typescript' && data.enableDebtGates && data.coverageEnabled)) {
    return []
  }
  const coverageGatePath = resolvedPath(base, 'scripts', 'lib', 'coverage-gate.mjs')
  return [
    writeFile(coverageGatePath, renderTemplate('scripts/lib/coverage-gate.mjs.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  ]
}

/**
 * #1331 (INV-123): emit a single skipIfExists template file under the project
 * root and return its WriteResult. Keeps generateCheckAll under the line ceiling
 * (CANON-22) while sharing the resolvedPath/renderTemplate/writeFile boilerplate.
 */
function emitTemplateFile(
  base: string,
  relPath: readonly string[],
  template: string,
  data: object,
  opts: { dryRun: boolean },
): WriteResult {
  return writeFile(resolvedPath(base, ...relPath), renderTemplate(template, data), {
    skipIfExists: true,
    dryRun: opts.dryRun,
  })
}

/**
 * #1331 (CANON-22): the unconditional emissions every governed project gets
 * alongside check-all.mjs, written via one shared loop so the boilerplate (and
 * its cyclomatic weight) lives outside generateCheckAll:
 *   check-all.mjs               — the gate script itself
 *   optional-emissions.json     — #1331/INV-123 manifest of intentionally-optional
 *                                 (existsSync-guarded) gate scripts so the
 *                                 emission-coherence lint tells a declared optional
 *                                 from a real ghost
 *   lib/run-helpers.mjs         — #351/CANON-01 runCheck/runToolCheck trinity
 *   check-collab-mode-wired.mjs — #1093/INV-100 collaborationMode L1 assertion
 *   check-constraint-scan.mjs   — #1214/INV-115 governance constraint scanner
 */
const UNCONDITIONAL_EMISSIONS: ReadonlyArray<{ rel: readonly string[]; tpl: string }> = [
  { rel: ['scripts', 'check-all.mjs'], tpl: 'scripts/check-all.mjs.ejs' },
  // #2041 (AC-2041.3): the emitted gate-layering contract test — asserts the
  // L1 ⊂ L2 ⊂ L3 containment from the registry embedded in check-all.mjs.
  { rel: ['scripts', 'test-gate-layering.mjs'], tpl: 'scripts/test-gate-layering.mjs.ejs' },
  { rel: ['scripts', 'optional-emissions.json'], tpl: 'scripts/optional-emissions.json.ejs' },
  { rel: ['scripts', 'lib', 'run-helpers.mjs'], tpl: 'scripts/lib/run-helpers.mjs.ejs' },
  // #2328: the gate-pass evidence binding. Emitted unconditionally — check-all.mjs
  // imports it to STAMP the marker, and the pre-push hook plus both Claude hooks
  // import it to VERIFY one. A project missing it fails closed everywhere.
  { rel: ['scripts', 'lib', 'gate-evidence.mjs'], tpl: 'scripts/lib/gate-evidence.mjs.ejs' },
  // #2399: the review/dispatch evidence binding (ancestor + source-unchanged). Emitted
  // unconditionally — the review gates and the Stop hook all import it, and a project
  // missing it fails closed everywhere.
  { rel: ['scripts', 'lib', 'evidence-binding.mjs'], tpl: 'scripts/lib/evidence-binding.mjs.ejs' },
  {
    rel: ['scripts', 'check-collab-mode-wired.mjs'],
    tpl: 'scripts/check-collab-mode-wired.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-hook-routing.mjs'],
    tpl: 'scripts/check-hook-routing.mjs.ejs',
  },
  // #2110: emission parity — every file recorded in `.arbiter-generated-manifest.json`
  // is still on disk. Reads the committed manifest, so it needs no arbiter install:
  // arbiter is not a dependency of the projects it governs, and a check that shelled
  // out to its generators would SKIP exactly where it matters.
  {
    rel: ['scripts', 'check-emission-parity.mjs'],
    tpl: 'scripts/check-emission-parity.mjs.ejs',
  },
  { rel: ['scripts', 'check-constraint-scan.mjs'], tpl: 'scripts/check-constraint-scan.mjs.ejs' },
  // #2037 (INV-115): scaffold the map alongside its checker so the gate never runs
  // against an absent map by construction. skipIfExists — a project's curated
  // coverage is never clobbered by a later `arbiter update`.
  { rel: ['scripts', 'constraint-map.json'], tpl: 'scripts/constraint-map.json.ejs' },
  // #1407 (INV-129): repo-hygiene gate — no tracked data/state files or compiled
  // binaries in the index. Emitted unconditionally and wired at L1 in check-all.mjs.ejs.
  {
    rel: ['scripts', 'check-no-tracked-artifacts.mjs'],
    tpl: 'scripts/check-no-tracked-artifacts.mjs.ejs',
  },
  // #1442: container image digest-pin gate. Emitted unconditionally (self-SKIPs when
  // the repo ships no Dockerfiles); wired at L1 in check-all.mjs.ejs.
  {
    rel: ['scripts', 'check-image-pins.mjs'],
    tpl: 'scripts/check-image-pins.mjs.ejs',
  },
  // #1445 (INV-130): stack-agnostic E2E reliability subsystem. The library
  // (fingerprint/classify/retryLadder/riskTier/ledger/quarantine schema) is emitted
  // first; the fail-closed quarantine hygiene gate imports it and is wired at L1 in
  // check-all.mjs.ejs. Both self-SKIP/vacuous-pass when no quarantine registry exists.
  {
    rel: ['scripts', 'lib', 'e2e-reliability.mjs'],
    tpl: 'scripts/lib/e2e-reliability.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-e2e-quarantine.mjs'],
    tpl: 'scripts/check-e2e-quarantine.mjs.ejs',
  },
  // #1446 (INV-131): TDD red→green evidence re-verification gate. Self-contained
  // (inlines schema + git checks — no arbiter CLI dependency); wired at L2 in
  // check-all.mjs.ejs. Self-SKIPs (no origin/main or no task-ID commits).
  {
    rel: ['scripts', 'check-tdd-evidence.mjs'],
    tpl: 'scripts/check-tdd-evidence.mjs.ejs',
  },
  // #2429: the tabletop evidence gate + the schema it validates against. Emitted (not
  // self-only) because consumers run tabletops too — the exercise is a consumer practice,
  // not an arbiter-internal audit. Zero-dep plain node; wired at L1 in check-all.mjs.ejs
  // and vacuous when .arbiter/evidence/tabletop/ is absent.
  {
    rel: ['scripts', 'check-tabletop-evidence.mjs'],
    tpl: 'scripts/check-tabletop-evidence.mjs.ejs',
  },
  {
    rel: ['schemas', 'tabletop-evidence.schema.json'],
    tpl: 'schemas/tabletop-evidence.schema.json.ejs',
  },
  // #2480 (INV-147): SOTA source certification, tier 1 — every quoted span a project claims must
  // be a literal substring of a committed excerpt whose sha256 matches what was recorded. The rule
  // is generic and deterministic offline, so it ports whole; only the registry's path differs
  // (docs/SOURCES.md here, docs/internal/PRODUCT/SOURCES.md in arbiter's own tree). Emitted with
  // its schema, because a gate that errors the moment a project records a source is worse than no
  // gate; wired at L1 in check-all.mjs.ejs and SKIPs out loud when docs/SOURCES.md is absent.
  {
    rel: ['scripts', 'check-sources.mjs'],
    tpl: 'scripts/check-sources.mjs.ejs',
  },
  {
    rel: ['schemas', 'source-record.schema.json'],
    tpl: 'schemas/source-record.schema.json.ejs',
  },
  // #1456 (INV-133): TODO max-age enforcement gate. A TODO(#NNN) whose linked issue
  // was created more than MAX_AGE_DAYS ago FAILS the gate (age from issue created_at
  // only). Self-contained; wired at L2 in check-all.mjs.ejs. Graceful-SKIPs offline.
  {
    rel: ['scripts', 'check-todo-max-age.mjs'],
    tpl: 'scripts/check-todo-max-age.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-test-pyramid.mjs'],
    tpl: 'scripts/check-test-pyramid.mjs.ejs',
  },
  // #1457 (INV-134): per-module coverage non-regression ratchet. Emitted unconditionally
  // (self-SKIPs when no coverage summary exists, or the stack is not yet supported);
  // wired ADVISORY (runWarnCheck) at L2 in check-all.mjs.ejs so it starts as a warning
  // (start-warn-promote-later) and never hard-fails a fresh consumer's gate.
  {
    rel: ['scripts', 'verify-module-coverage.mjs'],
    tpl: 'scripts/verify-module-coverage.mjs.ejs',
  },
  // #1508: mutation-score non-regression ratchet. Emitted unconditionally (self-SKIPs
  // when no mutation report exists, or the stack is not yet supported); wired blocking
  // next to the mutation gate so the killed-mutant ratio cannot silently drift toward
  // the absolute floor without ever tripping a regression.
  {
    rel: ['scripts', 'verify-mutation-baseline.mjs'],
    tpl: 'scripts/verify-mutation-baseline.mjs.ejs',
  },
  {
    // #1365/INV-126: live-API e2e gate. Emitted unconditionally (manifest absent or
    // required:false ⇒ runtime SKIP); the suite itself is scaffolded by the api-e2e
    // generator only for service archetypes.
    rel: ['scripts', 'check-api-e2e.mjs'],
    tpl: 'scripts/check-api-e2e.mjs.ejs',
  },
  // #1366 (INV-127): frontend render-smoke presence gate. Emitted unconditionally
  // (self-SKIPs for non-frontend / ungoverned repos) so the gate is always wired;
  // imports the shared glob-walk helper, also emitted unconditionally below.
  {
    rel: ['scripts', 'check-render-smoke.mjs'],
    tpl: 'scripts/check-render-smoke.mjs.ejs',
  },
  // #2080 (INV-137): declarative smoke-journey acceptance-floor gate. Emitted unconditionally
  // (runtime-SKIPs on applicable:false / absent manifest) so the gate is always wired; imports
  // the shared glob-walk helper emitted just below. The manifest + starter come from
  // src/generators/smoke-journeys.ts.
  {
    rel: ['scripts', 'check-smoke-journeys.mjs'],
    tpl: 'scripts/check-smoke-journeys.mjs.ejs',
  },
  // #2043 (AC-2043.5/6): e2e escalation ledger gate. Emitted unconditionally
  // (runtime-SKIPs when .arbiter/e2e-ledger.jsonl is absent/empty) so the gate is always
  // wired; reads the same ledger shape lib/e2e-reliability.mjs's appendLedger writes.
  {
    rel: ['scripts', 'check-e2e-escalation.mjs'],
    tpl: 'scripts/check-e2e-escalation.mjs.ejs',
  },
  // #2103 (M16): dispatch-template handoff-contract marker gate. SOFT corpus check;
  // corpus files absent in a consumer are SKIPPED at runtime, so unconditional is safe.
  {
    rel: ['scripts', 'check-m16-handoff.mjs'],
    tpl: 'scripts/check-m16-handoff.mjs.ejs',
  },
  {
    rel: ['scripts', 'lib', 'glob-walk.mjs'],
    tpl: 'scripts/lib/glob-walk.mjs.ejs',
  },
  // ADR-110 (INV-138): acceptance-anchor orchestration tools. The generated ship.md
  // preflight/FIT-rubric steps invoke issue-readiness.mjs / rework-log.mjs, so the
  // files must exist in every governed tree (INV-123 emission coherence — command-doc
  // references are unguarded by construction). Both share the pure parsing core in
  // scripts/lib/acceptance-criteria.mjs, co-emitted like glob-walk above. The
  // check-acceptance.mjs GATE stays self-only (not wired in generated check-all) —
  // that wiring is the tracked ADR-110 follow-up.
  {
    rel: ['scripts', 'issue-readiness.mjs'],
    tpl: 'scripts/issue-readiness.mjs.ejs',
  },
  {
    rel: ['scripts', 'rework-log.mjs'],
    tpl: 'scripts/rework-log.mjs.ejs',
  },
  {
    rel: ['scripts', 'lib', 'acceptance-criteria.mjs'],
    tpl: 'scripts/lib/acceptance-criteria.mjs.ejs',
  },
  // #1398 (INV-128) conformance.mjs and #1419 gold-audit.mjs are NOT listed here:
  // each has a dedicated always-on owner (generateConformanceScript / generateGoldKit)
  // that runs later in the registry and is the SOLE emitter. Listing them here too made
  // generateCheckAll a second always-on emitter — the #1318.2 double-write class (false
  // "already exist" on fresh init + duplicated/over-counted `arbiter diff` entries, #1578).
  // The wiring is independent of emission: check-all.mjs.ejs gates each as an advisory
  // `runWarnCheck` on `existsSync(scripts/<file>)`, so the gate stays fully intact.
  // #1428 (INV-135): doc-set + anti-fake-green thin runners. Each delegates to
  // `npx arbiter <cmd>` (the engine + `yaml` dep stay in arbiter's env), so a consumer
  // needs NO local `yaml` dep. Emitted unconditionally and wired ADVISORY (runWarnCheck)
  // in check-all.mjs L2 so a fresh consumer passes with no day-1 redness (gh absent =
  // fail-OPEN; doc-set advisory unless --strict).
  {
    rel: ['scripts', 'check-doc-set.mjs'],
    tpl: 'scripts/check-doc-set.mjs.ejs',
  },
  // T4 (gold-doc-tranches-t3-t5.md §2.3): freshness thin runner, same shape/rationale as
  // check-doc-set.mjs above — delegates to `npx arbiter doc-set --freshness`. Emitted
  // unconditionally but wired OUTSIDE check-all.mjs L2 (monthly + release lane only, per the
  // solo-developer-gate-model doctrine) — see _monthly.yml.ejs / 05-release.yml.ejs.
  // INV-144: arc42 slot-completeness thin runner, same shape/rationale as check-doc-set.mjs —
  // delegates to `npx arbiter doc-set --arc42`. The skeletons the audit compares against stay in
  // arbiter's own tree, so a governed project is held to the skeleton IT received without carrying
  // a copy that could drift. Wired L2 warn in the registry: hollow sections are a real finding, but
  // a freshly generated arc42 is hollow by construction and must not make `arbiter init` red.
  // The registry row is L2 + warn + enableDebtGates — deliberately weaker than the self side's
  // L1 + runCheck + unconditional, and declared as such in the INV-144 catalog entry.
  {
    rel: ['scripts', 'check-arc42-slots.mjs'],
    tpl: 'scripts/check-arc42-slots.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-doc-freshness.mjs'],
    tpl: 'scripts/check-doc-freshness.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-anti-fake-green.mjs'],
    tpl: 'scripts/check-anti-fake-green.mjs.ejs',
  },
  // #2036: decision-registry gate (D-NN orphan check) — self-contained (node-only,
  // no lib import). SKIPs when no registry exists and when the registry carries
  // `arbiter:preserve` (user-owned format); fails on orphan D-NN decisions.
  {
    rel: ['scripts', 'check-decision-registry.mjs'],
    tpl: 'scripts/check-decision-registry.mjs.ejs',
  },
  // #1497 (A5): ship arbiter's deterministic file-scan anti-fake-green guards INTO the generated
  // project so a planted false-green is caught by THIS project's own gate — not only by arbiter's.
  // Each is self-contained (node-only, no lib import) and NO-DATA-safe (PASS when there is nothing
  // to scan), so each is emitted unconditionally and hard-wired (runCheck) in check-all.mjs. The
  // self-contained aggregate (check-anti-fake-green.mjs) also runs this set as an informational view.
  {
    rel: ['scripts', 'check-muted-test.mjs'],
    tpl: 'scripts/check-muted-test.mjs.ejs',
  },
  // Brownfield companion to check-muted-test (#1835 follow-through): pre-existing
  // muted tests (e.g. a legacy repo's @Disabled suites) are grandfathered via
  // `--update-baseline`; NEW muted gate tests always fail. Emitted empty (strict
  // default) so the mechanism is discoverable and manifest-owned.
  {
    rel: ['muted-tests-baseline.json'],
    tpl: 'scripts/muted-tests-baseline.json.ejs',
  },
  {
    rel: ['scripts', 'check-skip-critical-e2e.mjs'],
    tpl: 'scripts/check-skip-critical-e2e.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-no-stub-redirects.mjs'],
    tpl: 'scripts/check-no-stub-redirects.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-grace-window.mjs'],
    tpl: 'scripts/check-grace-window.mjs.ejs',
  },
  // #2161: assertion-delta guard — diff-based, applies to any test stack, so (unlike
  // oracle-discrimination above) it is emitted unconditionally like its five siblings above.
  {
    rel: ['scripts', 'check-assertion-delta.mjs'],
    tpl: 'scripts/check-assertion-delta.mjs.ejs',
  },
  // T1 (convergence playbook): anti-erosion ratchet — fails when a safety-class
  // file (.claude/hooks/*.mjs) is still withheld (user-modified, not re-adopted).
  // Reads .arbiter-generated-manifest.json's withheldSafety section (update.ts).
  // Wired at L1 in check-all.mjs.ejs (safety hooks exist from L1 upward).
  {
    rel: ['scripts', 'check-safety-adopt-ratchet.mjs'],
    tpl: 'scripts/check-safety-adopt-ratchet.mjs.ejs',
  },
  // E1-E7 #1943 (CANON-14): anti-context-rot enforcer twins — verbatim copies of
  // arbiter's own gate set (design: docs/design/anti-context-rot-enforcers.md).
  // Emitted unconditionally: every gate vacuous-PASSes when its evidence surface
  // is absent, and the design's tier table keeps the recorder AVAILABLE from L1
  // ("solo/L1: recorder available, gate not wired").
  // check-touched-vs-manifest is emitted but NOT wired into the gate ring — it is
  // a per-group harvest-time gate that requires --plan/--group/--base args (E7).
  {
    rel: ['scripts', 'check-touched-vs-manifest.mjs'],
    tpl: 'scripts/check-touched-vs-manifest.mjs.ejs',
  },
  { rel: ['scripts', 'record-agent-return.mjs'], tpl: 'scripts/record-agent-return.mjs.ejs' },
  // Shared E1-E7 helpers + the envelope schema the recorder/gate validate against.
  { rel: ['scripts', 'lib', 'gate-args.mjs'], tpl: 'scripts/lib/gate-args.mjs.ejs' },
  {
    rel: ['scripts', 'lib', 'agent-return-validate.mjs'],
    tpl: 'scripts/lib/agent-return-validate.mjs.ejs',
  },
  {
    rel: ['schemas', 'agent-return.schema.json'],
    tpl: 'scripts/schemas/agent-return.schema.json.ejs',
  },
  {
    rel: ['schemas', 'agent-return-external.schema.json'],
    tpl: 'scripts/schemas/agent-return-external.schema.json',
  },
  // #2358: cross-model evidence tooling is available at every governance level. The advisory
  // L2 registry gate is emitted by the debt-gate ring and explicitly skips when the optional
  // crossModelReview config is absent or disabled.
  {
    rel: ['scripts', 'check-cross-model-review.mjs'],
    tpl: 'scripts/check-cross-model-review.mjs.ejs',
  },
  {
    rel: ['schemas', 'cross-model-dispatch.schema.json'],
    tpl: 'scripts/schemas/cross-model-dispatch.schema.json',
  },
  // #2058: best-effort nightly safety net — deletes Actions artifacts GitHub
  // itself already marked expired but hasn't physically purged. Invoked directly
  // by the nightly workflow's cleanup-expired-artifacts job, not wired into the
  // check-all.mjs gate ring (it's CI hygiene, not a correctness gate).
  {
    rel: ['scripts', 'gh-cleanup-expired-artifacts.mjs'],
    tpl: 'scripts/gh-cleanup-expired-artifacts.mjs.ejs',
  },
]

// The repo-wide anti-context-rot gates are wired ADVISORY (runWarnCheck)
// inside check-all.mjs.ejs's enableDebtGates ring (L2+ default) — their emission
// follows the SAME predicate so no fixture ever carries a dead emission (#1835
// class; caught by check-emission-coherence on L1/peer-review).
const DEBT_GATED_EMISSIONS: ReadonlyArray<{ rel: readonly string[]; tpl: string }> = [
  { rel: ['scripts', 'check-agent-return.mjs'], tpl: 'scripts/check-agent-return.mjs.ejs' },
  {
    rel: ['scripts', 'check-review-completion.mjs'],
    tpl: 'scripts/check-review-completion.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-refutation-verdicts.mjs'],
    tpl: 'scripts/check-refutation-verdicts.mjs.ejs',
  },
  { rel: ['scripts', 'check-audit-dry-pass.mjs'], tpl: 'scripts/check-audit-dry-pass.mjs.ejs' },
  { rel: ['scripts', 'check-handoff-doc.mjs'], tpl: 'scripts/check-handoff-doc.mjs.ejs' },
]

function emitUnconditional(base: string, data: object, opts: { dryRun: boolean }): WriteResult[] {
  return UNCONDITIONAL_EMISSIONS.map(({ rel, tpl }) => emitTemplateFile(base, rel, tpl, data, opts))
}

function emitDebtGated(
  base: string,
  data: { enableDebtGates?: boolean },
  opts: { dryRun: boolean },
): WriteResult[] {
  if (data.enableDebtGates !== true) return []
  return DEBT_GATED_EMISSIONS.map(({ rel, tpl }) => emitTemplateFile(base, rel, tpl, data, opts))
}

// #2044 (AC-2044.3): the reuse-registry gate. Emission follows the SAME
// predicate as the wiring in check-all.mjs.ejs (includeExtendedInvariants) so
// a non-extended consumer never carries an unwired guard (check-unwired-guards
// class, #2159).
const EXTENDED_GATED_EMISSIONS: ReadonlyArray<{ rel: readonly string[]; tpl: string }> = [
  { rel: ['scripts', 'check-reuse-registry.mjs'], tpl: 'scripts/check-reuse-registry.mjs.ejs' },
]

function emitExtendedGated(
  base: string,
  data: { includeExtendedInvariants?: boolean },
  opts: { dryRun: boolean },
): WriteResult[] {
  if (data.includeExtendedInvariants !== true) return []
  return EXTENDED_GATED_EMISSIONS.map(({ rel, tpl }) =>
    emitTemplateFile(base, rel, tpl, data, opts),
  )
}

export function generateCheckAll(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CheckAllGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir

  // #1527 — single resolver shared with the coverage + mutation generators so
  // the gate floor can never disagree with the tool-config floor for the same
  // project. Replaces the old per-generator `?? computed` precedence (#484).
  const effective = resolveEffectiveThresholds(config)

  const data = {
    ...config,
    coverageThreshold: effective.lineCoverage,
    coverageEnabled: effective.coverageEnabled,
    mutationEnabled: effective.mutationEnabled,
    mutationThreshold: effective.mutationScore,
    // #359 (INV-60): binary-size cap consumed by the rust archetype branch of
    // check-all.mjs. Value is 0 for non-binary archetypes; the template guards
    // emission on archetype before reading the variable, so 0 is inert.
    binarySizeBytes: binarySizeBudget(config.archetype),
  }
  // #2041: the declarative gate registry (AC-2041.4) — the emitted
  // check-all.mjs embeds it and runs gates from it. Loaded from the SAME
  // enriched data the template renders with (coverage thresholds etc.).
  ;(data as unknown as { gates: GateRegistryEntry[] }).gates = loadGateRegistry(data)

  results.push(...emitUnconditional(base, data, opts))
  results.push(...emitDebtGated(base, data, opts))
  results.push(...emitExtendedGated(base, data, opts))

  // #1319.8 — greenfield-aware coverage gate predicate (TS + coverage only).
  results.push(...emitCoverageGate(base, data, opts))

  // #2278: the PRODUCER of .evidence/SUMMARY.json (INV-33). The template existed
  // since ADR-030 ("L3 projects generate … evidence-collect.mjs") but no generator
  // ever wired it, so the evidence-gate block emitted into check-all.mjs — plus
  // `arbiter verify evidence` and the evidence graph builder — read a file nothing
  // in the tree could write, and the gate WARNed forever. Same ghost class as
  // #1331's ci-classify-changes.mjs. Gated on the SAME condition as its consumer
  // (gate-registry `evidence-gate`, emitIf isL3Plus) so producer and gate can never
  // disagree. skipIfExists — thresholds are the project's to tune afterwards.
  if (
    typeof config.governanceLevel === 'string' &&
    (LEVEL_ORDER as readonly string[]).includes(config.governanceLevel) &&
    levelAtLeast(config.governanceLevel, 'L3')
  ) {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'evidence-collect.mjs'),
        renderTemplate('scripts/evidence-collect.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // #358 (CANON-02, CANON-15, Phase 7F): emit ephemeral-server runner used by
  // integration/e2e gate steps (Playwright TS, pytest-playwright Python) to
  // bring up a server, poll for readiness, run tests, and tear it down. Only
  // archetypes that exercise an HTTP surface at L2+ need the runner; library
  // and L1 setups skip the emission to keep the generated tree minimal.
  const archetypesNeedingServer = new Set(['frontend-spa', 'backend-web-db'])
  if (config.governanceLevel !== 'L1' && archetypesNeedingServer.has(config.archetype)) {
    const ephemeralPath = resolvedPath(base, 'scripts', 'lib', 'ephemeral-server.mjs')
    results.push(
      writeFile(ephemeralPath, renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data), {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    )
  }

  // #360 (CANON-02): Rust context-aware INV-04 checkers — no .unwrap()/.expect() and no `unsafe`.
  // Emitted only for rust projects, invoked at L1 from check-all.mjs.ejs.
  if (config.language === 'rust') {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'checks', 'check-rust-no-unwrap.mjs'),
        renderTemplate('scripts/checks/check-rust-no-unwrap.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'checks', 'check-rust-no-unsafe.mjs'),
        renderTemplate('scripts/checks/check-rust-no-unsafe.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // #356 (CANON-01): rebased-aware docs-check script + [skip-docs] bypass.
  // Mirrors CI docs-check job so the gate fires locally pre-push. L2+ only (matches CI gating).
  if (config.governanceLevel !== 'L1') {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'check-docs.mjs'),
        renderTemplate('scripts/check-docs.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // #1977: trunk-solo requires the local-ci-parity check wired BY DEFAULT — a
  // no-PR flow is only sound when `run.sh gate full ≡ CI` (INV-59); without a
  // PR there is no independent CI net before trunk. peer-review/gated-review
  // rely on the PR itself as that net, so the script is trunk-solo-only.
  if (resolveCollaborationMode(config) === 'trunk-solo') {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'check-local-ci-parity.mjs'),
        renderTemplate('scripts/check-local-ci-parity.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // #1367 (INV-126): domain<->API surface-completeness gate.
  results.push(...emitDomainApiSurface(base, config, data, opts))

  // #2160: oracle-discrimination guard — conditional on an E2E (Playwright) harness being
  // applicable, same predicate as generateE2eConstitution (e2e-constitution.ts).
  results.push(...emitOracleDiscrimination(base, config, data, opts))

  // #1127 / #1330: frontend gate scripts (boundary purity + per-lane subtree gate).
  results.push(...emitFrontendChecks(base, config, data, opts))

  // #1737 (CANON-01 Track-B counterpart of arbiter-self's #1718): consumer-resolution
  // audit gate for published npm libraries.
  results.push(...emitConsumerAudit(base, config, data, opts))

  return { files: results }
}

/**
 * #1737 — consumer-resolution audit gate (`check-consumer-audit.mjs`), the Track-B
 * counterpart of arbiter-self's own #1718 `scripts/check-consumer-audit.mjs` gate.
 * npm silently drops a package's own `overrides` for anyone who installs it as a
 * dependency, so a published library's dev-tree `npm audit` is structurally blind to
 * that class of exposure — this gate packs+installs+audits the CONSUMER-resolved tree
 * instead. Emitted only for a published npm library target (the established
 * `archetype === 'library' && language === 'typescript'` predicate, see
 * debt-ratchet.ts's `includePublicApiSurface`), and only at L2+ (mirrors the
 * suppressions.ts Java/Kotlin/multi owasp-suppressions.xml governance-level guard).
 */
function emitConsumerAudit(
  base: string,
  config: ProjectConfig,
  data: object,
  opts: { dryRun: boolean },
): WriteResult[] {
  if (
    config.archetype !== 'library' ||
    config.language !== 'typescript' ||
    config.governanceLevel === 'L1'
  ) {
    return []
  }
  return [
    writeFile(
      resolvedPath(base, 'scripts', 'check-consumer-audit.mjs'),
      renderTemplate('scripts/check-consumer-audit.mjs.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]
}

/**
 * #1367 (INV-126) — domain<->API surface-completeness gate emission.
 * Only emitted when config.hasPublicApi is true (skip brownfield / library targets).
 */
function emitDomainApiSurface(
  base: string,
  config: ProjectConfig,
  data: object,
  opts: { dryRun: boolean },
): WriteResult[] {
  if (!config.hasPublicApi) return []
  return [
    writeFile(
      resolvedPath(base, 'scripts', 'check-domain-api-surface.mjs'),
      renderTemplate('scripts/check-domain-api-surface.mjs.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(base, 'domain-api-surface.json'),
      renderTemplate('scripts/domain-api-surface.json.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]
}

/**
 * #2160 (port of a proven oracle-discrimination guard from a downstream consumer project): emit the
 * oracle-discrimination guard + its seeded-empty ratchet baseline ONLY where an E2E
 * (Playwright) harness is applicable — same predicate as generateE2eConstitution
 * (e2e-constitution.ts): archetype frontend-spa or backend-web-db. A library/cli/embedded
 * target never gets the file, so check-anti-fake-green.mjs's generic existsSync-guarded
 * roster loop reports it `absent` rather than fabricating a pass (AC-4). The baseline is
 * seeded empty (skipIfExists: true, same brownfield-companion shape as
 * muted-tests-baseline.json) — the guard's OWN runtime never writes it except under an
 * explicit --update-baseline flag (AC-2 fail-closed-on-missing stays a human act, not an
 * emission-time convenience).
 */
function emitOracleDiscrimination(
  base: string,
  config: ProjectConfig,
  data: object,
  opts: { dryRun: boolean },
): WriteResult[] {
  const hasE2eHarness = config.archetype === 'frontend-spa' || config.archetype === 'backend-web-db'
  if (!hasE2eHarness) return []
  return [
    writeFile(
      resolvedPath(base, 'scripts', 'check-oracle-discrimination.mjs'),
      renderTemplate('scripts/check-oracle-discrimination.mjs.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(base, 'oracle-discrimination-baseline.json'),
      renderTemplate('scripts/oracle-discrimination-baseline.json.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]
}

/**
 * #1127 + #1330 — frontend gate-script emissions, extracted to keep generateCheckAll
 * under the complexity/line ceiling (CANON-22).
 *
 *  - #1127 (INV-102/103/104, CANON-09): FE boundary purity gate
 *    (`check-fe-boundaries.mjs`). Emitted for the frontend-spa archetype OR any
 *    project with a 'frontend' lane, L2+ only.
 *  - #1330 (CANON-11): per-lane frontend SUBTREE gate (`check-frontend-lane.mjs`).
 *    A `frontend` lane on a *non-frontend-spa* archetype means the FE app lives in a
 *    `frontend/` subtree beside the primary language; the primary-language gate never
 *    runs the FE lane's typecheck/test/build, so emit a dedicated gate-on-present
 *    runner. The frontend-spa archetype keeps its root-level wiring (no subtree emit).
 */
function emitFrontendChecks(
  base: string,
  config: ProjectConfig,
  data: object,
  opts: { dryRun: boolean },
): WriteResult[] {
  const out: WriteResult[] = []
  const isFrontend = config.archetype === 'frontend-spa' || config.lanes.includes('frontend')
  if (isFrontend && config.governanceLevel !== 'L1') {
    out.push(
      writeFile(
        resolvedPath(base, 'scripts', 'check-fe-boundaries.mjs'),
        renderTemplate('scripts/check-fe-boundaries.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }
  if (isSubtreeFrontendLane(config)) {
    out.push(
      writeFile(
        resolvedPath(base, 'scripts', 'check-frontend-lane.mjs'),
        renderTemplate('scripts/check-frontend-lane.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }
  return out
}
