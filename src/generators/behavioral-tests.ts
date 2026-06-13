// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { formatContent } from '../utils/prettier-format.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface BehavioralTestsResult {
  files: WriteResult[]
}

function emitJavaBdd(
  base: string,
  data: object,
  config: ProjectConfig,
  dryRun: boolean,
): WriteResult[] {
  const testPkg = config.basePackage
    ? `src/test/java/${config.basePackage.replace(/\./g, '/')}/example`
    : 'src/test/java/example'
  const bddPkg = config.basePackage
    ? `src/test/java/${config.basePackage.replace(/\./g, '/')}/bdd`
    : 'src/test/java/com/example/bdd'
  return [
    writeFile(
      resolvedPath(base, testPkg, 'ExampleBehavioralTest.java'),
      renderTemplate('behavioral-tests/ExampleBehavioralTest.java.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, bddPkg, 'ExampleBddIT.java'),
      renderTemplate('behavioral-tests/bdd/ExampleBddIT.java.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, 'src', 'test', 'resources', 'features', 'example.feature'),
      renderTemplate('behavioral-tests/bdd/example.feature.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]
}

function emitTypeScriptBdd(base: string, data: object, dryRun: boolean): WriteResult[] {
  // Format TS content to the target's prettier style BEFORE writing (#933 F13) so
  // the recorded render hash matches the on-disk bytes (#1349 — no post-write
  // reformat that would desync the generated-manifest). The .feature file is not TS.
  const behPath = resolvedPath(base, 'src', 'test', 'example.behavioral.test.ts')
  const stepsPath = resolvedPath(base, 'features', 'step_definitions', 'example.steps.ts')
  return [
    writeFile(
      behPath,
      formatContent(
        renderTemplate('behavioral-tests/example.behavioral.test.ts.ejs', data),
        behPath,
        base,
      ),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      stepsPath,
      formatContent(
        renderTemplate('behavioral-tests/bdd/example.steps.ts.ejs', data),
        stepsPath,
        base,
      ),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, 'features', 'example.feature'),
      renderTemplate('behavioral-tests/bdd/example.feature.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]
}

function emitRustBdd(base: string, data: object, dryRun: boolean): WriteResult[] {
  return [
    writeFile(
      resolvedPath(base, 'tests', 'example_behavioral_test.rs'),
      renderTemplate('behavioral-tests/example_behavioral_test.rs.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, 'tests', 'example_bdd_test.rs'),
      renderTemplate('behavioral-tests/bdd/example_bdd_test.rs.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, 'tests', 'features', 'example.feature'),
      renderTemplate('behavioral-tests/bdd/example.feature.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]
}

function emitGoBdd(base: string, data: object, dryRun: boolean): WriteResult[] {
  return [
    writeFile(
      resolvedPath(base, 'internal', 'example_behavioral_test.go'),
      renderTemplate('behavioral-tests/example_behavioral_test.go.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, 'internal', 'bdd', 'example_test.go'),
      renderTemplate('behavioral-tests/bdd/example_test.go.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, 'features', 'example.feature'),
      renderTemplate('behavioral-tests/bdd/example.feature.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]
}

function emitPythonBdd(base: string, data: object, dryRun: boolean): WriteResult[] {
  return [
    writeFile(
      resolvedPath(base, 'tests', 'test_example_behavioral.py'),
      renderTemplate('behavioral-tests/test_example_behavioral.py.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, 'tests', 'bdd', 'test_example_bdd.py'),
      renderTemplate('behavioral-tests/bdd/test_example_bdd.py.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, 'tests', 'bdd', 'features', 'example.feature'),
      renderTemplate('behavioral-tests/bdd/example.feature.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]
}

export function generateBehavioralTests(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): BehavioralTestsResult {
  const base = config.targetDir
  const data = config
  const results: WriteResult[] = []

  if (config.language === 'java' || config.language === 'multi')
    results.push(...emitJavaBdd(base, data, config, opts.dryRun))
  if (config.language === 'typescript' || config.language === 'multi') {
    results.push(...emitTypeScriptBdd(base, data, opts.dryRun))
  }
  if (config.language === 'rust') results.push(...emitRustBdd(base, data, opts.dryRun))
  if (config.language === 'go') results.push(...emitGoBdd(base, data, opts.dryRun))
  if (config.language === 'python') results.push(...emitPythonBdd(base, data, opts.dryRun))

  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'TESTING_POLICY.md'),
      renderTemplate('behavioral-tests/TESTING_POLICY.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(base, 'scripts', 'check-test-naming.mjs'),
      renderTemplate('scripts/check-test-naming.mjs.ejs', data),
      { skipIfExists: false, dryRun: opts.dryRun },
    ),
  )

  if (
    config.archetype === 'frontend-spa' &&
    (config.language === 'typescript' || config.language === 'multi')
  ) {
    results.push(
      writeFile(
        resolvedPath(base, '.eslintrc-playwright.json'),
        renderTemplate('behavioral-tests/eslint-playwright.json.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files: results }
}
