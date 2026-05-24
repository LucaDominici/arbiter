#!/usr/bin/env node
// INV-32: Verifies every language with ≥1 'proven' cell in cross-language-matrix.json
// has at least one fixture under __tests__/fixtures/real-projects/.
// Also validates every fixture directory has a well-formed manifest.json.
// Usage: node scripts/check-matrix-fixtures.mjs [--fixtures-dir=path] [--matrix=path]
// Exits 1 if any violations are found.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const fixturesDirArg = args.find((a) => a.startsWith('--fixtures-dir='))
const matrixArg = args.find((a) => a.startsWith('--matrix='))

const root = process.cwd()
const FIXTURES_DIR = fixturesDirArg
  ? resolve(fixturesDirArg.split('=')[1])
  : join(root, '__tests__', 'fixtures', 'real-projects')
const MATRIX_PATH = matrixArg
  ? resolve(matrixArg.split('=')[1])
  : join(root, 'src', 'compatibility', 'cross-language-matrix.json')

let violations = 0

// ─── Step 1: Collect proven languages from the matrix ────────────────────────

let matrix
try {
  matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf-8'))
} catch (err) {
  process.stdout.write(`  Cannot read matrix: ${MATRIX_PATH} — ${err.message}
`)
  process.exit(1)
}

const provenLanguages = new Set()

for (const [category, langMap] of Object.entries(matrix)) {
  if (category.startsWith('_')) continue
  if (typeof langMap !== 'object' || langMap === null) continue
  for (const [lang, entry] of Object.entries(langMap)) {
    if (lang.startsWith('_')) continue
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'maturity' in entry &&
      entry.maturity === 'proven'
    ) {
      provenLanguages.add(lang)
    }
  }
}

// ─── Step 2: Read fixture directories ─────────────────────────────────────────

let fixtureDirs = []
if (existsSync(FIXTURES_DIR)) {
  fixtureDirs = readdirSync(FIXTURES_DIR).filter((entry) => {
    try {
      return statSync(join(FIXTURES_DIR, entry)).isDirectory()
    } catch (err) {
      console.error(`  warning: cannot stat ${entry} — ${err.message}, skipping`)
      return false
    }
  })
}

// ─── Step 3: Validate each fixture manifest ───────────────────────────────────

const REQUIRED_FIELDS = ['language', 'archetype', 'levels', 'tier']
// INV-32 (#1041): tier selects which bake-and-run E2E harness layer runs against
// the fixture — snapshot (no exec), bake (init + structural diff), functional
// (init + run generated gate). See docs/DEVELOPMENT/REAL-PROJECT-TESTING.md.
const VALID_TIERS = new Set(['snapshot', 'bake', 'functional'])
const fixtureLanguages = new Set()

for (const fixture of fixtureDirs) {
  const manifestPath = join(FIXTURES_DIR, fixture, 'manifest.json')
  if (!existsSync(manifestPath)) {
    process.stdout.write(`  ${fixture}: missing manifest.json
`)
    violations++
    continue
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    process.stdout.write(`  ${fixture}/manifest.json: invalid JSON — ${err.message}
`)
    violations++
    continue
  }
  let fixtureValid = true
  for (const field of REQUIRED_FIELDS) {
    if (field === 'levels') {
      if (!Array.isArray(manifest.levels) || manifest.levels.length === 0) {
        process.stdout.write(
          `  ${fixture}/manifest.json: missing required field 'levels' (must be a non-empty array)\n`,
        )
        violations++
        fixtureValid = false
      }
    } else if (!manifest[field]) {
      process.stdout.write(`  ${fixture}/manifest.json: missing required field '${field}'
`)
      violations++
      fixtureValid = false
    }
  }
  if (fixtureValid && manifest.tier && !VALID_TIERS.has(manifest.tier)) {
    process.stdout.write(
      `  ${fixture}/manifest.json: tier '${manifest.tier}' invalid — expected one of: ${[...VALID_TIERS].join(', ')}\n`,
    )
    violations++
    fixtureValid = false
  }
  if (fixtureValid && manifest.language) {
    fixtureLanguages.add(manifest.language)
  }
}

// ─── Step 4: Check every proven language has ≥1 fixture ──────────────────────

for (const lang of provenLanguages) {
  if (!fixtureLanguages.has(lang)) {
    process.stdout.write(
      `  language '${lang}' has proven cells in the matrix but no fixture in ${FIXTURES_DIR}\n`,
    )
    violations++
  }
}

// ─── Result ───────────────────────────────────────────────────────────────────

if (violations > 0) {
  process.stdout.write(
    `\n  Found ${violations} violation(s). See docs/DEVELOPMENT/REAL-PROJECT-TESTING.md for how to add fixtures.\n`,
  )
  process.exit(1)
}
