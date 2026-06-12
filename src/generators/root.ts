// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { prettierFormat } from '../utils/prettier-format.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface RootGeneratorResult {
  files: WriteResult[]
}

/** Post-emit format guard — only format a file that was actually written. */
function formatIfWritten(result: WriteResult, filePath: string, targetDir: string): void {
  if (result.action !== 'skipped' && result.action !== 'dry-run') {
    prettierFormat(filePath, targetDir)
  }
}

export function generateRoot(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): RootGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = { ...config, strictnessTier: config.strictnessTier ?? 'practical' }

  // CODEOWNERS — create if missing
  if (config.githubOwner) {
    results.push(
      writeFile(
        resolvedPath(base, '.github', 'CODEOWNERS'),
        renderTemplate('root/CODEOWNERS.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // SECURITY.md — create if missing
  results.push(
    writeFile(resolvedPath(base, 'SECURITY.md'), renderTemplate('root/SECURITY.md.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )

  // CONTRIBUTING.md — create if missing
  results.push(
    writeFile(
      resolvedPath(base, 'CONTRIBUTING.md'),
      renderTemplate('root/CONTRIBUTING.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  // .editorconfig — create if missing
  results.push(
    writeFile(resolvedPath(base, '.editorconfig'), renderTemplate('root/editorconfig.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )

  // tsconfig.json — TypeScript greenfield baseline (skipIfExists for brownfield)
  if (config.language === 'typescript' || config.language === 'multi') {
    results.push(
      writeFile(
        resolvedPath(base, 'tsconfig.json'),
        renderTemplate('root/tsconfig.json.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // clippy.toml — Rust pedantic lints for non-hexagonal projects (hexagonal gets it via rust-boundaries)
  if (
    config.language === 'rust' &&
    data.strictnessTier === 'pedantic' &&
    config.architectureStyle !== 'hexagonal'
  ) {
    results.push(
      writeFile(resolvedPath(base, 'clippy.toml'), renderTemplate('rust/clippy.toml.ejs', data), {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    )
  }

  // commitlint.config.js — conventional commit config for all projects
  const commitlintPath = resolvedPath(base, 'commitlint.config.js')
  const commitlintResult = writeFile(
    commitlintPath,
    renderTemplate('root/commitlint.config.js.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )
  results.push(commitlintResult)
  // Post-emit format (#1325): the template is house-style (single-quote, no semi),
  // but the target project's own prettier config may differ (e.g. a pre-existing
  // .prettierrc with singleQuote:false wins by precedence) — re-format the emitted
  // file to the project's effective config so the generated `format` gate stays
  // green out of the box. Best-effort, only when newly written.
  formatIfWritten(commitlintResult, commitlintPath, base)

  return { files: results }
}
