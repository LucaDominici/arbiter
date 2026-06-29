// SPDX-License-Identifier: Apache-2.0
// CANON-05/07/11: generator for the live-API e2e layer (#1365, INV-126).
//
// For SERVICE archetypes (backend-web-db) it scaffolds a non-mocked starter suite that
// boots the REAL binary/server, plus an executable runner (tests/api/run.sh) and a README,
// and emits api-e2e.json with required:true. For every other archetype it emits only
// api-e2e.json with required:false so the gate (check-api-e2e.mjs) SKIPs.
//
// skipIfExists: true — teams customise the suite/runner after init.
import { chmodSync, unlinkSync } from 'node:fs'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { renderTemplate } from '../utils/render.js'
import type { Archetype, Language, ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ApiE2eResult {
  files: WriteResult[]
}

// The single service archetype in arbiter's taxonomy. There is no separate `api`
// archetype (see wizard/types.ts Archetype union) — `backend-web-db` is it.
const SERVICE_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(['backend-web-db'])

interface StackSuite {
  /** EJS template under src/templates/api-e2e/ */
  template: string
  /** Emitted suite filename under tests/api/ */
  filename: string
  /** Framework label recorded in the manifest */
  framework: string
  /** Glob the gate uses to locate the suite file */
  glob: string
}

// Language → starter-suite mapping. typescript→supertest, go→httptest, java/kotlin→
// RestAssured, python→httpx. Anything else falls back to a Newman/Postman collection.
const STACK_BY_LANGUAGE: Partial<Record<Language, StackSuite>> = {
  typescript: {
    template: 'api-e2e/ts-supertest.test.ts.ejs',
    filename: 'api.e2e.test.ts',
    framework: 'supertest',
    glob: 'tests/api/**/*.test.ts',
  },
  go: {
    template: 'api-e2e/go-httptest.go.ejs',
    filename: 'api_e2e_test.go',
    framework: 'httptest',
    glob: 'tests/api/**/*_test.go',
  },
  java: {
    template: 'api-e2e/java-restassured.java.ejs',
    filename: 'ApiE2ETest.java',
    framework: 'restassured',
    glob: 'tests/api/**/*.java',
  },
  kotlin: {
    template: 'api-e2e/kotlin-restassured.kt.ejs',
    filename: 'ApiE2ETest.kt',
    framework: 'restassured',
    glob: 'tests/api/**/*.kt',
  },
  python: {
    template: 'api-e2e/python-httpx.py.ejs',
    filename: 'test_api_e2e.py',
    framework: 'httpx',
    glob: 'tests/api/**/*.py',
  },
}

const POSTMAN_FALLBACK: StackSuite = {
  template: 'api-e2e/postman.collection.json.ejs',
  filename: 'postman.collection.json',
  framework: 'newman',
  glob: 'tests/api/**/*.collection.json',
}

function suiteForLanguage(language: Language): StackSuite {
  return STACK_BY_LANGUAGE[language] ?? POSTMAN_FALLBACK
}

export function generateApiE2e(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): ApiE2eResult {
  const base = config.targetDir
  const required = SERVICE_ARCHETYPES.has(config.archetype)
  const suite = suiteForLanguage(config.language)
  const files: WriteResult[] = []

  // The manifest is rendered through an EJS template (not JSON.stringify) so the
  // diff dry-run path — which mocks renderTemplate — treats it like every other
  // generated file (convention parity with optional-emissions.json, #1331).
  //
  // #1706 (probe≠writer): emit `suiteCount` so the D-LIVE-E2E conformance probe —
  // which reads m['suiteCount'] and returns N when absent/0 — scores Y on a fresh
  // service project. The count reflects what THIS generator just registered: 1
  // starter suite for a required service archetype, 0 otherwise. A team adding
  // more suites edits the manifest (skipIfExists protects it on re-init).
  const manifestData = {
    archetype: config.archetype,
    required,
    suiteDir: 'tests/api',
    framework: suite.framework,
    glob: suite.glob,
    suiteCount: required ? 1 : 0,
  }
  files.push(
    writeFile(
      resolvedPath(base, 'api-e2e.json'),
      renderTemplate('api-e2e/manifest.json.ejs', manifestData),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  if (!required) {
    return { files }
  }

  const data = config as unknown as Record<string, unknown>

  // Starter suite file.
  files.push(
    writeFile(
      resolvedPath(base, 'tests', 'api', suite.filename),
      renderTemplate(suite.template, data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  // README documenting the live-binary contract.
  files.push(
    writeFile(
      resolvedPath(base, 'tests', 'api', 'README.md'),
      renderTemplate('api-e2e/README.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  // Executable runner — must be chmod 0o755. Mirror local-wrapper.ts: unlink on
  // chmod failure so a partial (non-executable) runner is never left behind.
  const runShPath = resolvedPath(base, 'tests', 'api', 'run.sh')
  const runShResult = writeFile(runShPath, renderTemplate('api-e2e/run.sh.ejs', data), {
    skipIfExists: true,
    dryRun: opts.dryRun,
  })
  files.push(runShResult)
  if (!opts.dryRun && runShResult.action !== 'skipped') {
    try {
      chmodSync(runShPath, 0o755)
    } catch (err) {
      try {
        unlinkSync(runShPath)
      } catch {
        // ignore secondary failure
      }
      throw new Error(`chmod tests/api/run.sh failed: ${(err as Error).message}. File removed.`, {
        cause: err,
      })
    }
  }

  return { files }
}
