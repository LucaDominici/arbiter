#!/usr/bin/env node
// CATALOG: Checks the formatting of what src/templates/**/*.ejs EMITS, not the .ejs bytes.
// CATALOG: Rejected fold-in into check-template-tests.mjs because that gate asserts render-test
// CATALOG: EXISTENCE per template (a different artifact-class question) and shares only the
// CATALOG: enumeration helper (`collectEjsFiles`), not the check semantics.
// CATALOG: Rejected fold-in into check-all.mjs's own `format` step (`prettier --check .`)
// CATALOG: because that step operates on raw repo files and cannot infer a parser for a
// CATALOG: `.<ext>.ejs` path at all — this script exists precisely to cover that blind spot.
//
// #2571: Every EJS template under src/templates/ emits content into a governed project,
// where that project's OWN `format` gate reads it as a plain file. Arbiter's whole-repo
// `npx prettier --check .` cannot infer a parser for `*.<ext>.ejs` and silently no-ops
// (exit 0) on every one — so a template can be committed mis-formatted and no arbiter-side
// check says a word, while `arbiter init` hands the consumer a red first gate run.
//
// Derive the input, don't list it (rejecting the `check-tarball-contents.mjs` allowlist
// anti-pattern, #2335): enumerate every `*.ejs` under src/templates/, strip the `.ejs`
// suffix, and ask prettier itself (`getFileInfo`) whether it can infer a parser for that
// path. Partition on whether the template body contains an EJS tag (`<%`):
//   - tag-free: the template content IS the emitted content — prettier-check it directly.
//   - tag-bearing: emitted content depends on locals a render pass would need to supply;
//     out of scope here (harder half, should not block the first — issue's own scoping).
//     Reported as a skipped count, not silently dropped. This gate is arbiter self-only
//     (scripts/canon01-self-only.json): a target project has no src/templates/, and the
//     tag-bearing (render-based) half — the other track the issue asks for — is deferred,
//     not implemented here.
//
// Ratchet is a sorted LIST of grandfathered mis-formatted template paths
// (.emitted-formatting-baseline.json), not a bare count — a count is blind to an identity
// swap (fix one grandfathered file, dirty a different one; the total stays put). Any
// mis-formatted path NOT in the list is a regression, named. Any grandfathered path that is
// no longer mis-formatted is an unbanked improvement — it must be removed from the list via
// --update-baseline, or a fixed site could be silently re-dirtied later (#2013 pattern).
// Fail-closed: a template prettier cannot even PARSE (throws) counts as mis-formatted and
// is named in the output, never silently skipped; a baseline file that fails to parse as
// the documented shape FAILs closed, naming the baseline file, rather than defaulting open.
//
// Update baseline: node scripts/check-emitted-formatting.mjs --update-baseline
// Usage: node scripts/check-emitted-formatting.mjs [--templates=path] [--baseline=file]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import prettier from 'prettier'
import { isMainModule } from './lib/run-helpers.mjs'
import { collectEjsFiles } from './check-template-tests.mjs'

/**
 * Check every tag-free, prettier-parsable template under `templatesDir` against
 * `resolveConfig`'s repo config. Returns the mis-formatted templates (repo-relative paths,
 * sorted) and the count of tag-bearing templates skipped as out of scope.
 */
export async function collectMisformatted(templatesDir) {
  const ejsFiles = collectEjsFiles(templatesDir)
  const misformatted = []
  let tagFreeCount = 0
  let tagBearingSkipped = 0

  for (const file of ejsFiles) {
    const strippedPath = file.replace(/\.ejs$/, '')
    const info = await prettier.getFileInfo(strippedPath)
    if (!info.inferredParser) continue // prettier has no parser for this emitted kind

    const content = readFileSync(file, 'utf-8')
    if (content.includes('<%')) {
      tagBearingSkipped++
      continue
    }
    tagFreeCount++

    const config = (await prettier.resolveConfig(strippedPath)) ?? {}
    const relPath = relative(templatesDir, file)
    try {
      const ok = await prettier.check(content, { ...config, filepath: strippedPath })
      if (!ok) misformatted.push(relPath)
    } catch (err) {
      // Fail-closed: unparsable emitted content is a FAIL naming the template, never a skip.
      console.error(`[check-emitted-formatting] cannot parse ${relPath}: ${err.message}`)
      misformatted.push(relPath)
    }
  }

  misformatted.sort((a, b) => a.localeCompare(b))
  return { misformatted, tagFreeCount, tagBearingSkipped }
}

/**
 * Load the grandfathered-paths baseline. Returns `{ grandfathered: string[] }` on success,
 * or `{ error: string }` when the file exists but does not parse as the documented shape —
 * fail-closed, never a silent default to an empty (or worse, NaN-derived) baseline.
 * A MISSING file is not an error: it behaves as an empty baseline (nothing grandfathered).
 */
export function loadBaseline(baselineFile) {
  if (!existsSync(baselineFile)) return { grandfathered: [] }
  const raw = readFileSync(baselineFile, 'utf-8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error(`[check-emitted-formatting] ${baselineFile}: not valid JSON: ${err.message}`)
    return { error: `not valid JSON (${err.message})` }
  }
  if (!parsed || !Array.isArray(parsed.grandfathered)) {
    return { error: 'missing a top-level `grandfathered` array' }
  }
  if (!parsed.grandfathered.every((p) => typeof p === 'string')) {
    return { error: '`grandfathered` must be an array of strings' }
  }
  return { grandfathered: parsed.grandfathered }
}

function writeBaseline(baselineFile, grandfathered) {
  const body = {
    _comment:
      'Pre-existing mis-formatted src/templates/**/*.ejs paths (#2571). The gate fails on any ' +
      'path here that is now clean (unbanked improvement — remove it) and on any mis-formatted ' +
      'path NOT here (regression). Regenerate: node scripts/check-emitted-formatting.mjs --update-baseline',
    grandfathered: [...grandfathered].sort((a, b) => a.localeCompare(b)),
  }
  writeFileSync(baselineFile, JSON.stringify(body, null, 2) + '\n')
}

export async function main() {
  const args = process.argv.slice(2)
  const updateBaseline = args.includes('--update-baseline')
  const templatesArg = args.find((a) => a.startsWith('--templates='))
  const baselineArg = args.find((a) => a.startsWith('--baseline='))

  const root = process.cwd()
  const templatesDir = templatesArg
    ? resolve(templatesArg.split('=')[1])
    : resolve(root, 'src/templates')
  const baselineFile = baselineArg
    ? resolve(baselineArg.split('=')[1])
    : resolve(root, '.emitted-formatting-baseline.json')

  const { misformatted, tagFreeCount, tagBearingSkipped } = await collectMisformatted(templatesDir)
  const scale = `${misformatted.length}/${tagFreeCount} (${tagFreeCount === 0 ? 0 : Math.round((misformatted.length / tagFreeCount) * 100)}%)`

  if (updateBaseline) {
    writeBaseline(baselineFile, misformatted)
    process.stdout.write(
      `[check-emitted-formatting] Baseline updated: ${scale} mis-formatted templates grandfathered\n`,
    )
    process.exit(0)
  }

  const baselineResult = loadBaseline(baselineFile)
  if (baselineResult.error) {
    process.stdout.write(
      `[check-emitted-formatting] FAIL: baseline file ${baselineFile} ${baselineResult.error}\n`,
    )
    process.exit(1)
  }

  const grandfathered = new Set(baselineResult.grandfathered)
  const misformattedSet = new Set(misformatted)
  const newlyMisformatted = misformatted.filter((p) => !grandfathered.has(p))
  const nowClean = [...grandfathered]
    .filter((p) => !misformattedSet.has(p))
    .sort((a, b) => a.localeCompare(b))

  if (newlyMisformatted.length === 0 && nowClean.length === 0) {
    process.stdout.write(
      `[check-emitted-formatting] OK — ${scale} mis-formatted templates, all grandfathered ` +
        `(${tagBearingSkipped} tag-bearing skipped)\n`,
    )
    return
  }

  if (newlyMisformatted.length > 0) {
    process.stdout.write(
      `[check-emitted-formatting] FAIL: regression — ${newlyMisformatted.length} new mis-formatted template(s) not in the baseline:\n`,
    )
    for (const f of newlyMisformatted.slice(0, 10)) process.stdout.write(`    ${f}\n`)
    if (newlyMisformatted.length > 10) {
      process.stdout.write(`    ... and ${newlyMisformatted.length - 10} more\n`)
    }
  }

  if (nowClean.length > 0) {
    process.stdout.write(
      `[check-emitted-formatting] FAIL: unbanked improvement — ${nowClean.length} grandfathered template(s) are no longer mis-formatted:\n`,
    )
    for (const f of nowClean.slice(0, 10)) process.stdout.write(`    ${f}\n`)
    if (nowClean.length > 10) process.stdout.write(`    ... and ${nowClean.length - 10} more\n`)
    process.stdout.write(
      '  Bank it so the recovered slots cannot be silently re-filled: node scripts/check-emitted-formatting.mjs --update-baseline\n',
    )
  }

  process.exit(1)
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`[check-emitted-formatting] ERROR: ${err.stack ?? err}\n`)
    process.exit(2)
  })
}
