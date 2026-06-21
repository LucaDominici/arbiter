// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { formatContent } from '../utils/prettier-format.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface RootGeneratorResult {
  files: WriteResult[]
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

  // NOTE: tsconfig.json is emitted by the debt-gates generator (always-on for TS),
  // not here — the `root` generator is gated on permitGitHub, so emitting the
  // tsconfig here dropped it for every non-GitHub TS init and broke the typecheck
  // gate on first run (B4, #1491). It now lives next to the rest of the TS gate
  // toolchain so it ships regardless of the GitHub flag.

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

  // commitlint.config.js — conventional commit config for all projects.
  // Format to the project's effective prettier config BEFORE writing (#1325) so the
  // generated `format` gate is green out of the box AND the recorded render hash
  // matches the bytes on disk (#1349 — no post-write reformat to desync the manifest).
  const commitlintPath = resolvedPath(base, 'commitlint.config.js')
  results.push(
    writeFile(
      commitlintPath,
      formatContent(renderTemplate('root/commitlint.config.js.ejs', data), commitlintPath, base),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  return { files: results }
}
