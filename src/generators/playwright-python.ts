import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface PlaywrightPythonResult {
  files: WriteResult[]
}

const E2E_ARCHETYPES = new Set(['frontend-spa', 'backend-web-db'])

export function generatePlaywrightPython(config: ProjectConfig): PlaywrightPythonResult {
  if (!E2E_ARCHETYPES.has(config.archetype)) {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config as unknown as Record<string, unknown>

  return {
    files: [
      writeFile(
        resolvedPath(base, 'tests', 'e2e', 'conftest.py'),
        renderTemplate('e2e/playwright-python/conftest.py.ejs', data),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(base, 'tests', 'e2e', 'test_smoke.py'),
        renderTemplate('e2e/playwright-python/test_smoke.py.ejs', data),
        { skipIfExists: true },
      ),
    ],
  }
}
