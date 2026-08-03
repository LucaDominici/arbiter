#!/usr/bin/env node
// INV-48: Every EJS template under src/templates/ must have a render test (CANON-04).
// Uses a ratchet: fails if the count of untested EJS files INCREASES beyond the committed baseline.
// Update baseline: node scripts/check-template-tests.mjs --update-baseline
// Usage: node scripts/check-template-tests.mjs [--templates=path] [--tests=path] [--baseline=file]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { walkRepo } from './lib/glob-walk.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

/**
 * Collect every `.ejs` file under `dir` (recursively). Traversal is delegated to the shared
 * cycle-safe walkRepo (#1521/#1544); walkRepo's SKIP_DIRS prunes vendor trees. Returns absolute
 * paths. src/templates has no vendor dirs, so the widened skip set is a no-op here.
 */
export function collectEjsFiles(dir) {
  return walkRepo(dir)
    .filter((rel) => rel.endsWith('.ejs'))
    .map((rel) => join(dir, rel))
}

function collectTestContent(dir) {
  const content = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry.endsWith('.ts') || entry.endsWith('.js')) {
      content.push(readFileSync(full, 'utf-8'))
    }
  }
  return content.join('\n')
}

export function main() {
  const args = process.argv.slice(2)
  const updateBaseline = args.includes('--update-baseline')
  const templatesArg = args.find((a) => a.startsWith('--templates='))
  const testsArg = args.find((a) => a.startsWith('--tests='))
  const baselineArg = args.find((a) => a.startsWith('--baseline='))

  const root = process.cwd()
  const templatesDir = templatesArg
    ? resolve(templatesArg.split('=')[1])
    : resolve(root, 'src/templates')
  const testsDir = testsArg ? resolve(testsArg.split('=')[1]) : resolve(root, '__tests__/templates')
  const baselineFile = baselineArg
    ? resolve(baselineArg.split('=')[1])
    : resolve(root, '.template-tests-baseline.txt')

  const ejsFiles = collectEjsFiles(templatesDir)
  const testContent = collectTestContent(testsDir)

  const missing = []
  for (const ejsFile of ejsFiles) {
    const relPath = relative(templatesDir, ejsFile)
    const stem = relPath.replace(/\.ejs$/, '')
    if (!testContent.includes(relPath) && !testContent.includes(stem)) {
      missing.push(relPath)
    }
  }

  const currentCount = missing.length

  if (updateBaseline) {
    writeFileSync(baselineFile, String(currentCount))
    process.stdout
      .write(`[check-template-tests] Baseline updated to ${currentCount} untested EJS files
`)
    process.exit(0)
  }

  const baseline = existsSync(baselineFile)
    ? parseInt(readFileSync(baselineFile, 'utf-8').trim(), 10)
    : 0

  // #2013: a bare count hides how wide the grandfathered gap really is. Always print the
  // denominator and the percentage, so "183" reads as "183/564 (32%)".
  const total = ejsFiles.length
  const scale = `${currentCount}/${total} (${total === 0 ? 0 : Math.round((currentCount / total) * 100)}%)`

  // #2013: blocking only the widening direction left slack — an unbanked improvement
  // freed slots that could be silently re-filled up to the stale baseline. Banking is
  // mandatory: a gap narrower than the baseline fails until the baseline follows it down.
  // Introduced at currentCount === baseline, so it is a no-op on this tree.
  if (currentCount < baseline) {
    process.stdout.write(
      `[check-template-tests] FAIL: unbanked improvement — ${scale} untested EJS files, below the baseline of ${baseline}.\n`,
    )
    process.stdout.write(
      '  Bank it so the recovered slots cannot be silently re-filled: node scripts/check-template-tests.mjs --update-baseline\n',
    )
    process.exit(1)
  }

  if (currentCount > baseline) {
    process.stdout.write(
      `[check-template-tests] FAIL: regression — ${scale} untested EJS files (baseline: ${baseline})\n`,
    )
    process.stdout.write('  New untested files (compared to baseline):\n')
    for (const f of missing.slice(0, 10)) {
      process.stdout.write(`    ${f}
`)
    }
    if (missing.length > 10) {
      process.stdout.write(`    ... and ${missing.length - 10} more
`)
    }
    process.stdout.write(
      '  To update baseline after adding tests: node scripts/check-template-tests.mjs --update-baseline\n',
    )
    process.exit(1)
  }

  process.stdout.write(
    `[check-template-tests] OK — ${scale} untested EJS files (baseline: ${baseline})\n`,
  )
}

// Only run main when invoked as CLI (not imported in tests).
if (isMainModule(import.meta.url)) {
  main()
}
