// SPDX-License-Identifier: Apache-2.0
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { prettierFormat } from '../utils/prettier-format.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface CodexHooksGeneratorResult {
  files: WriteResult[]
}

export function generateCodexHooks(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CodexHooksGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config

  // .codex/config.toml — always rewrite so hook wiring stays current; backup preserves customizations
  results.push(
    writeFile(
      resolvedPath(base, '.codex', 'config.toml'),
      renderTemplate('codex/config.toml.ejs', data),
      { backup: true, dryRun: opts.dryRun },
    ),
  )

  // .codex/codex-adapter.mjs — copied from static template; skip if exists
  const adapterSrc = join(__dirname, '..', 'templates', 'codex', 'codex-adapter.mjs')
  const adapterDest = join(resolvedPath(base, '.codex'), 'codex-adapter.mjs')
  const writeResult = writeFile(adapterDest, readFileSync(adapterSrc, 'utf-8'), {
    skipIfExists: true,
    dryRun: opts.dryRun,
  })
  results.push(writeResult)

  // Post-emit format: apply target's prettier config so style matches target project (#933 F13).
  // Only format when the file was newly written; skip if the existing file was preserved.
  if (writeResult.action !== 'skipped' && writeResult.action !== 'dry-run') {
    prettierFormat(adapterDest, base)
  }

  return { files: results }
}
