// SPDX-License-Identifier: Apache-2.0
import { chmodSync, unlinkSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface LocalWrapperGeneratorResult {
  files: WriteResult[]
}

export function generateLocalWrapper(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): LocalWrapperGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = { projectName: config.projectName }

  const makefilePath = resolvedPath(base, 'Makefile')
  results.push(
    writeFile(makefilePath, renderTemplate('local-wrapper/Makefile.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )

  const runShPath = resolvedPath(base, 'run.sh')
  const runShResult = writeFile(runShPath, renderTemplate('local-wrapper/run.sh.ejs', data), {
    skipIfExists: true,
    dryRun: opts.dryRun,
  })
  results.push(runShResult)
  if (!opts.dryRun && runShResult.action !== 'skipped') {
    try {
      chmodSync(runShPath, 0o755)
    } catch (err) {
      try {
        unlinkSync(runShPath)
      } catch {
        // ignore secondary failure
      }
      throw new Error(
        `chmod run.sh failed: ${(err as Error).message}. File removed to avoid partial state.`,
        { cause: err },
      )
    }
  }

  return { files: results }
}
