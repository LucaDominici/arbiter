#!/usr/bin/env node
// Reads __tests__/fixtures/real-projects/*/manifest.json and emits a GitHub
// Actions matrix JSON. Each fixture is fanned out by its declared levels.
// Usage: node scripts/build-matrix.mjs [--fixtures-dir=path]
// Output: matrix=<json> on stdout (sets GITHUB_OUTPUT step output).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const fixturesDirArg = args.find((a) => a.startsWith('--fixtures-dir='))

const root = process.cwd()
const FIXTURES_DIR = fixturesDirArg
  ? resolve(fixturesDirArg.split('=')[1])
  : join(root, '__tests__', 'fixtures', 'real-projects')

const include = []

if (existsSync(FIXTURES_DIR)) {
  const entries = readdirSync(FIXTURES_DIR).filter((entry) => {
    try {
      return statSync(join(FIXTURES_DIR, entry)).isDirectory()
    } catch (err) {
      process.stderr.write(`  warning: cannot stat ${entry} — ${err.message}, skipping\n`)
      return false
    }
  })

  for (const fixture of entries) {
    const manifestPath = join(FIXTURES_DIR, fixture, 'manifest.json')
    if (!existsSync(manifestPath)) {
      process.stderr.write(`  warning: ${fixture} has no manifest.json — skipped\n`)
      continue
    }
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (err) {
      process.stderr.write(
        `  warning: ${fixture}/manifest.json is invalid JSON — ${err.message} — skipped\n`,
      )
      continue
    }
    if (!manifest.language || !manifest.archetype) {
      process.stderr.write(
        `  warning: ${fixture}/manifest.json missing 'language' or 'archetype' — skipped\n`,
      )
      continue
    }
    if (!Array.isArray(manifest.levels) || manifest.levels.length === 0) {
      process.stderr.write(
        `  warning: ${fixture}/manifest.json has no valid 'levels' array — skipped\n`,
      )
      continue
    }
    for (const level of manifest.levels) {
      const entry = {
        fixture,
        language: manifest.language,
        archetype: manifest.archetype,
        level,
      }
      if (manifest.buildTool) {
        entry.buildTool = manifest.buildTool
      }
      include.push(entry)
    }
  }
}

if (include.length === 0) {
  process.stderr.write(
    `  error: no matrix entries produced — all manifests are missing, broken, or have empty levels\n`,
  )
  process.exit(1)
}

const matrix = JSON.stringify({ include })
process.stdout.write(`matrix=${matrix}\n`)
