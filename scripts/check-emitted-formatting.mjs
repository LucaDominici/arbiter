#!/usr/bin/env node
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
//     Reported as a skipped count, not silently dropped.
//
// Ratchet (mirrors check-template-tests.mjs / INV-48): fails if the count of mis-formatted
// tag-free templates INCREASES beyond the committed baseline (pre-existing debt found by
// generalizing past the issue's manually-checked `*.json.ejs` subset) — and fails on an
// unbanked improvement too, so recovered slots cannot be silently re-filled (#2013 pattern).
// Fail-closed: a template prettier cannot even PARSE (throws) counts as mis-formatted and
// is named in the output, never silently skipped.
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
 * `resolveConfig`'s repo config. Returns the mis-formatted templates (repo-relative paths)
 * and the count of tag-bearing templates skipped as out of scope.
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

  return { misformatted, tagFreeCount, tagBearingSkipped }
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
    : resolve(root, '.emitted-formatting-baseline.txt')

  const { misformatted, tagFreeCount, tagBearingSkipped } = await collectMisformatted(templatesDir)
  const currentCount = misformatted.length

  if (updateBaseline) {
    writeFileSync(baselineFile, String(currentCount))
    process.stdout.write(
      `[check-emitted-formatting] Baseline updated to ${currentCount} mis-formatted templates\n`,
    )
    process.exit(0)
  }

  const baseline = existsSync(baselineFile)
    ? parseInt(readFileSync(baselineFile, 'utf-8').trim(), 10)
    : 0

  const scale = `${currentCount}/${tagFreeCount} (${tagFreeCount === 0 ? 0 : Math.round((currentCount / tagFreeCount) * 100)}%)`

  if (currentCount < baseline) {
    process.stdout.write(
      `[check-emitted-formatting] FAIL: unbanked improvement — ${scale} mis-formatted, below the baseline of ${baseline}.\n`,
    )
    process.stdout.write(
      '  Bank it so the recovered slots cannot be silently re-filled: node scripts/check-emitted-formatting.mjs --update-baseline\n',
    )
    process.exit(1)
  }

  if (currentCount > baseline) {
    process.stdout.write(
      `[check-emitted-formatting] FAIL: regression — ${scale} mis-formatted templates (baseline: ${baseline}, ${tagBearingSkipped} tag-bearing skipped)\n`,
    )
    process.stdout.write('  New mis-formatted templates (compared to baseline):\n')
    for (const f of misformatted.slice(0, 10)) {
      process.stdout.write(`    ${f}\n`)
    }
    if (misformatted.length > 10) {
      process.stdout.write(`    ... and ${misformatted.length - 10} more\n`)
    }
    process.stdout.write(
      '  To update baseline after fixing templates: node scripts/check-emitted-formatting.mjs --update-baseline\n',
    )
    process.exit(1)
  }

  process.stdout.write(
    `[check-emitted-formatting] OK — ${scale} mis-formatted templates (baseline: ${baseline}, ${tagBearingSkipped} tag-bearing skipped)\n`,
  )
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`[check-emitted-formatting] ERROR: ${err.stack ?? err}\n`)
    process.exit(2)
  })
}
