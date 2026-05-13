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

  // #358 (CANON-02, CANON-15, Phase 7F): emit ephemeral-server runner used by
  // integration/e2e gate steps (Playwright TS, pytest-playwright Python) to
  // bring up a server, poll for readiness, run tests, and tear it down. Only
  // archetypes that exercise an HTTP surface at L2+ need the runner; library
  // and L1 setups skip the emission to keep the generated tree minimal.
  const archetypesNeedingServer = new Set(['frontend-spa', 'backend-web-db'])
  if (config.governanceLevel !== 'L1' && archetypesNeedingServer.has(config.archetype)) {
    const ephemeralPath = resolvedPath(base, 'scripts', 'lib', 'ephemeral-server.mjs')
    results.push(
      writeFile(ephemeralPath, renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data), {
        skipIfExists: true,
      }),
    )
  }

  return { files: results }
}
