// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator for smoke-journeys.json (#2080, INV-137).
// Emits the declarative login/CRUD/authz acceptance floor. Synthesis of two precedents:
//   - INV-124 (test-pyramid): the per-item { id, name, globs, status, rationale } shape and
//     the ≥20-char n/a rationale / all-n/a hard-fail auditable machinery.
//   - INV-126 (api-e2e): the FAIL-CLOSED default direction — applicability is archetype-computed
//     (not aspirational), and day-1-green comes from a REAL scaffolded starter, never a default flag.
//
// Applicability is archetype × language. frontend-spa + TypeScript is the only combo with a
// scaffolded honest starter today (a Playwright browser suite), mirroring how the sibling
// render-smoke floor (INV-127) scaffolds TS-only and tolerates other stacks as a pending gap.
// Every other combo emits an explicit top-level applicable:false + reason — a VISIBLE
// floor-reduction the gate SKIPs on, never a per-journey n/a lie that would launder a real gap.
//
// ponytail: TS frontend-spa only. Add a per-language starter table (mirroring api-e2e's
// STACK_BY_LANGUAGE) and widen applicability when a non-TS / backend browser-journey floor is
// actually needed — until then a truthful applicable:false beats a fake-green required journey.
//
// skipIfExists: true — teams customise the manifest/starter after init.
import { writeFile, resolvedPath } from '../utils/fs.js'
import { renderTemplate } from '../utils/render.js'
import type { Archetype, Language, ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface SmokeJourneysResult {
  files: WriteResult[]
}

// Globs the required journeys resolve against (OR semantics in the gate). The dedicated
// starter below lands at tests/smoke/smoke-journeys.spec.ts → matches the first glob, so a
// fresh project is honestly day-1 green. The second glob lets a team carry a journey in any
// *.smoke-journey.spec.ts file elsewhere in the tree.
const SMOKE_GLOBS = ['tests/smoke/**/*.spec.ts', '**/*.smoke-journey.spec.ts']

const AUTHZ_RATIONALE =
  'frontend-spa enforces authorization server-side; the authz smoke floor belongs to the ' +
  "backend archetype's own live-API manifest (INV-126), not the browser journey suite."

// The archetype × language combos that get the scaffolded, applicable:true floor.
function isApplicable(archetype: Archetype, language: Language): boolean {
  return archetype === 'frontend-spa' && language === 'typescript'
}

// Honest, VISIBLE reason for every non-applicable combo (never a per-journey n/a).
function applicabilityReason(archetype: Archetype, language: Language): string {
  if (archetype === 'frontend-spa') {
    return (
      `Smoke-journey starters are scaffolded for TypeScript frontends only (like the render-smoke ` +
      `floor, INV-127); add a Playwright smoke-journey suite for ${language} and flip ` +
      `applicable:true. Floor pending for this stack.`
    )
  }
  if (archetype === 'backend-web-db') {
    return (
      'Browser smoke-journey floor not scaffolded for a backend service archetype; the separate ' +
      'api-e2e gate (INV-126, api-e2e.json) mandates a live-API suite here but checks suite ' +
      'presence, not the login/CRUD/authz journeys specifically. Floor pending for this archetype.'
    )
  }
  return `Archetype "${archetype}" has no interactive login/CRUD/authz user journeys to smoke-test.`
}

function buildManifest(archetype: Archetype, language: Language): object {
  if (!isApplicable(archetype, language)) {
    return { archetype, applicable: false, reason: applicabilityReason(archetype, language) }
  }
  return {
    archetype,
    applicable: true,
    journeys: [
      { id: 'auth', name: 'Authentication flow', globs: SMOKE_GLOBS, status: 'required' },
      { id: 'crud', name: 'Core CRUD operation', globs: SMOKE_GLOBS, status: 'required' },
      {
        id: 'authz',
        name: 'Authorization enforcement',
        globs: SMOKE_GLOBS,
        status: 'n/a',
        rationale: AUTHZ_RATIONALE,
      },
    ],
  }
}

export function generateSmokeJourneys(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): SmokeJourneysResult {
  const base = config.targetDir
  const applicable = isApplicable(config.archetype, config.language)
  const files: WriteResult[] = []

  const manifest = buildManifest(config.archetype, config.language)
  // Render the manifest through an EJS template (not a bare JSON.stringify write) so the
  // `arbiter diff` dry-run path — which mocks renderTemplate — treats it like every other
  // generated file (convention parity with api-e2e.ts / optional-emissions.json, #1331);
  // a JSON.stringify write mismatches the mock and reads as a spurious withheld-drift.
  files.push(
    writeFile(
      resolvedPath(base, 'smoke-journeys.json'),
      renderTemplate('smoke-journeys/manifest.json.ejs', {
        manifestJson: JSON.stringify(manifest, null, 2),
      }),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  if (!applicable) {
    return { files }
  }

  // Day-1-green via a real starter (mirrors api-e2e.ts): every required journey is carried by
  // this scaffolded spec, so `required` is never a lie on a fresh project.
  files.push(
    writeFile(
      resolvedPath(base, 'tests', 'smoke', 'smoke-journeys.spec.ts'),
      renderTemplate('e2e/smoke-journeys/journeys.spec.ts.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  return { files }
}
