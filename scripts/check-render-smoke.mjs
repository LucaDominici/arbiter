#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-127 enforcement. Frontend archetypes (or a `frontend` lane) MUST carry a
// CATALOG:   render-smoke behavioural test: a headless-browser spec that boots the built
// CATALOG:   SPA and asserts the app shell mounts without console errors. Fails-closed when
// CATALOG:   a frontend project has zero render-smoke specs — catches the haben failure mode
// CATALOG:   (token-purity passed while the screen rendered as broken empty boxes, #1366).
// CATALOG:   SKIPs for non-frontend / ungoverned repos so they never false-fail.
// CATALOG:   Boundary: file PRESENCE only — the spec is executed by the CI render-smoke lane.
// Exit codes (INV-53): 0=PASS/SKIP, 1=policy violation, 2=schema error.
// Usage: node scripts/check-render-smoke.mjs [--help]
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { globMatch, walkRepo } from './lib/glob-walk.mjs'

const ROOT = resolve(process.cwd())
const ARBITER_PATH = join(ROOT, 'arbiter.json')

// Render-smoke spec naming conventions accepted by the gate (OR semantics).
const RENDER_SMOKE_GLOBS = [
  'tests/e2e/render-smoke.spec.ts',
  'frontend/tests/e2e/render-smoke.spec.ts',
  '**/render-smoke.spec.ts',
  '**/*.render-smoke.spec.ts',
  '**/*.render-smoke.test.ts',
]

const HELP = `Usage: node scripts/check-render-smoke.mjs [--help]

Enforces that frontend archetypes carry a render-smoke behavioural test (INV-127).

A render-smoke spec boots the built SPA in a headless browser and asserts the app
shell + key screens mount without console errors. It catches the failure mode where
a token-purity gate passes but the screen renders as broken empty boxes.

Applicability:
  Active when arbiter.json declares archetype "frontend-spa" OR a "frontend" lane.
  Any other archetype / a missing arbiter.json → SKIP (exit 0).

Accepted spec locations (any one satisfies the gate):
${RENDER_SMOKE_GLOBS.map((g) => `  ${g}`).join('\n')}

Exit codes:
  0 — pass or SKIP (non-frontend / ungoverned repo)
  1 — frontend project has no render-smoke spec
  2 — schema error (unreadable / invalid arbiter.json)`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`${HELP}\n`)
  process.exit(0)
}

function isFrontend(arbiter) {
  if (arbiter.archetype === 'frontend-spa') return true
  return Array.isArray(arbiter.lanes) && arbiter.lanes.includes('frontend')
}

function main() {
  if (!existsSync(ARBITER_PATH)) {
    process.stdout.write('[check-render-smoke] SKIP — arbiter.json not found\n')
    process.exit(0)
  }

  let arbiter
  try {
    arbiter = JSON.parse(readFileSync(ARBITER_PATH, 'utf-8'))
  } catch (err) {
    process.stderr.write(`[check-render-smoke] ERROR — invalid arbiter.json: ${err.message}\n`)
    process.exit(2)
  }

  if (!isFrontend(arbiter)) {
    process.stdout.write(
      '[check-render-smoke] SKIP — not a frontend archetype and no frontend lane\n',
    )
    process.exit(0)
  }

  const allFiles = walkRepo(ROOT)
  const found = RENDER_SMOKE_GLOBS.some((g) => allFiles.some((f) => globMatch(g, f)))

  if (!found) {
    process.stderr.write(
      '[check-render-smoke] FAIL — frontend project has no render-smoke behavioural test. ' +
        'A token-purity pass does not prove the screen renders. Scaffold one at ' +
        'tests/e2e/render-smoke.spec.ts (arbiter init emits a starter), or run arbiter update. ' +
        `Accepted: ${RENDER_SMOKE_GLOBS.join(', ')}\n`,
    )
    process.exit(1)
  }

  process.stdout.write('[check-render-smoke] OK — render-smoke behavioural test present\n')
  process.exit(0)
}

main()
