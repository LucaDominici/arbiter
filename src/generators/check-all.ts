import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { computeThresholds } from '../config/thresholds.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface CheckAllGeneratorResult {
  files: WriteResult[]
}

export function generateCheckAll(config: ProjectConfig): CheckAllGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir

  const computed = computeThresholds(
    config.linesOfCode ?? 0,
    config.thresholdProfile ?? 'fixed',
    config.governanceLevel,
  )

  const data = {
    ...config,
    coverageThreshold: config.thresholds?.lineCoverage || computed.coverageThreshold,
    coverageEnabled: computed.coverageEnabled,
    mutationEnabled: computed.mutationEnabled,
    mutationThreshold: config.thresholds?.mutationScore || computed.mutationThreshold,
  }

  const scriptPath = resolvedPath(base, 'scripts', 'check-all.mjs')
  results.push(
    writeFile(scriptPath, renderTemplate('scripts/check-all.mjs.ejs', data), {
      skipIfExists: true,
    }),
  )

  // #351 (CANON-01): emit shared helper trinity alongside the gate script.
  // check-all.mjs imports runCheck/runWarnCheck/runToolCheck/pushResult from
  // ./lib/run-helpers.mjs; the file must always be present when check-all.mjs is.
  const helpersPath = resolvedPath(base, 'scripts', 'lib', 'run-helpers.mjs')
  results.push(
    writeFile(helpersPath, renderTemplate('scripts/lib/run-helpers.mjs.ejs', data), {
      skipIfExists: true,
    }),
  )

  // #360 (CANON-02): Rust context-aware INV-04 checkers — no .unwrap()/.expect() and no `unsafe`.
  // Emitted only for rust projects, invoked at L1 from check-all.mjs.ejs.
  if (config.language === 'rust') {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'checks', 'check-rust-no-unwrap.mjs'),
        renderTemplate('scripts/checks/check-rust-no-unwrap.mjs.ejs', data),
        { skipIfExists: true },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'checks', 'check-rust-no-unsafe.mjs'),
        renderTemplate('scripts/checks/check-rust-no-unsafe.mjs.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  // #356 (CANON-01): rebased-aware docs-check script + [skip-docs] bypass.
  // Mirrors CI docs-check job so the gate fires locally pre-push. L2+ only (matches CI gating).
  if (config.governanceLevel !== 'L1') {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'check-docs.mjs'),
        renderTemplate('scripts/check-docs.mjs.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  return { files: results }
}
