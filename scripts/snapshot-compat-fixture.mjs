#!/usr/bin/env node
// Capture an arbiter init output into __tests__/fixtures/compat/<version>-<archetype>/
// and update __tests__/fixtures/compat/MANIFEST.json.
//
// Usage: node scripts/snapshot-compat-fixture.mjs <version> <archetype> [--language <lang>]
//
// Release protocol (see docs/REFERENCE/backward-compat-harness.md):
//   Before bumping the package version, run this script for each supported archetype
//   to seed a fixture from the current code. This creates a historical record that
//   future arbiter update --dry-run must pass without schema errors.
//   NEVER fake-pin historical data — only capture real arbiter init output.
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const ROOT = resolve('.')
const COMPAT_DIR = join(ROOT, '__tests__', 'fixtures', 'compat')
const MANIFEST_PATH = join(COMPAT_DIR, 'MANIFEST.json')

const args = process.argv.slice(2)
if (args.length < 2) {
  console.error(
    'Usage: node scripts/snapshot-compat-fixture.mjs <version> <archetype> [--language <lang>]',
  )
  console.error('Example: node scripts/snapshot-compat-fixture.mjs 0.1.0 ts-cli')
  process.exit(1)
}

const version = args[0]
const archetype = args[1]
const langIdx = args.indexOf('--language')
const language = langIdx !== -1 ? args[langIdx + 1] : 'typescript'

if (!version || !archetype) {
  console.error('Error: version and archetype are required')
  process.exit(1)
}

const fixtureName = `v${version}-${archetype}`
const fixturePath = join(COMPAT_DIR, fixtureName)

if (existsSync(fixturePath)) {
  console.error(`Error: fixture already exists at ${fixturePath}`)
  console.error('Remove it first if you want to regenerate.')
  process.exit(1)
}

// Create a temp dir, run arbiter init, then copy results to fixture
const tmp = mkdtempSync(join(tmpdir(), 'arbiter-compat-seed-'))
try {
  // Init a git repo in temp dir (arbiter init requires git)
  execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'fixture@arbiter.dev'], {
    cwd: tmp,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: tmp, stdio: 'ignore' })

  // Run arbiter init programmatically by importing runInit
  // We do this via tsx to avoid needing a built dist
  const scriptContent = `
import { runInit } from '${ROOT}/src/commands/init.js'
await runInit({ yes: true, tools: 'claude', level: 'L1', dir: '${tmp}', noVerify: true })
`
  const scriptPath = join(tmp, '_init_runner.mts')
  writeFileSync(scriptPath, scriptContent)
  execFileSync('npx', ['tsx', scriptPath], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ARBITER_NO_EVIDENCE: '1' },
  })

  // Copy results to fixture directory (exclude the temp runner script)
  mkdirSync(fixturePath, { recursive: true })
  cpSync(tmp, fixturePath, {
    recursive: true,
    filter: (src) => !src.endsWith('_init_runner.mts') && !src.split(sep).includes('.git'),
  })

  // Update MANIFEST.json
  const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) : []
  manifest.push({ version, archetype, language, path: fixtureName })
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')

  console.log(`snapshot-compat-fixture: created ${fixtureName}`)
  console.log(`snapshot-compat-fixture: updated MANIFEST.json (${manifest.length} entries)`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
