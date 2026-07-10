// SPDX-License-Identifier: Apache-2.0
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { formatContent } from '../utils/prettier-format.js'
import { injectGradleWiring } from '../utils/gradle.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

// What the emitted Java example suite actually imports (#1835-class fix: the
// tests were scaffolded WITHOUT their dependencies, so a fresh init could not
// compile — `error: package org.assertj.core.api does not exist`):
//   ExampleBehavioralTest → org.assertj + org.junit.jupiter
//   ExampleBddIT          → io.cucumber junit-platform engine + junit suite
//   ExampleSteps          → io.cucumber java + org.assertj
// junit-platform-launcher is what `test { useJUnitPlatform() }` needs on the
// runtime classpath (required explicitly from Gradle 9). Versions are pinned;
// the injector skips any group:artifact the build already declares, so a
// brownfield project's own versions are never overwritten.
const JAVA_BDD_TEST_DEPS: { coordinate: string; configuration?: string }[] = [
  { coordinate: 'org.assertj:assertj-core:3.26.3' },
  { coordinate: 'org.junit.jupiter:junit-jupiter:5.10.2' },
  { coordinate: 'org.junit.platform:junit-platform-suite:1.10.2' },
  { coordinate: 'io.cucumber:cucumber-java:7.18.0' },
  { coordinate: 'io.cucumber:cucumber-junit-platform-engine:7.18.0' },
  { coordinate: 'org.junit.platform:junit-platform-launcher:1.10.2', configuration: 'testRuntimeOnly' },
]

export interface BehavioralTestsResult {
  files: WriteResult[]
}

/**
 * #1776: has the project already grown REAL (non-example) `.feature` files?
 * skipIfExists already protects an EXISTING example scaffold from being
 * overwritten (CANON-11); the gap is a MISSING one — once a user deletes the
 * example trio (its undefined steps break the BDD suite once real features
 * exist), `existsSync` is false and the next `arbiter update` unconditionally
 * re-creates it, with no memory of "this project outgrew the example."
 * Checked once per language's features directory before emitting the example
 * set; recurses so a nested layout (e.g. `tests/bdd/features/`) still counts
 * a real feature file placed in a subdirectory.
 */
function hasRealFeatureFiles(featuresDir: string): boolean {
  let entries: string[]
  try {
    entries = readdirSync(featuresDir)
    // FAIL-OPEN-INTENT: missing featuresDir (fresh project) — nothing to find, example stays safe to emit.
  } catch {
    return false
  }
  for (const entry of entries) {
    const full = join(featuresDir, entry)
    let isDir: boolean
    try {
      isDir = statSync(full).isDirectory()
      // FAIL-OPEN-INTENT: TOCTOU race (entry removed between readdir and stat) — skip just this entry.
    } catch {
      continue
    }
    if (isDir) {
      if (hasRealFeatureFiles(full)) return true
    } else if (entry.endsWith('.feature') && entry !== 'example.feature') {
      return true
    }
  }
  return false
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
  if (hasRealFeatureFiles(resolvedPath(base, 'src', 'test', 'resources', 'features'))) return []
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
    // #1042 follow-up: glue code for ExampleBddIT's @Suite. Without it Cucumber
    // resolves the feature's steps as UNDEFINED and fails the run (strict by
    // default) — the Go/Rust/TS BDD examples all ship their step defs alongside
    // the suite/runner for the same reason.
    writeFile(
      resolvedPath(base, bddPkg, 'ExampleSteps.java'),
      renderTemplate('behavioral-tests/bdd/ExampleSteps.java.ejs', data),
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
  if (hasRealFeatureFiles(resolvedPath(base, 'features'))) return []
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
  if (hasRealFeatureFiles(resolvedPath(base, 'tests', 'features'))) return []
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
  if (hasRealFeatureFiles(resolvedPath(base, 'features'))) return []
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
  if (hasRealFeatureFiles(resolvedPath(base, 'tests', 'bdd', 'features'))) return []
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

  if (config.language === 'java' || config.language === 'multi') {
    const javaFiles = emitJavaBdd(base, data, config, opts.dryRun)
    results.push(...javaFiles)
    // Wire the deps the emitted suite imports into the root Gradle build —
    // fill-gaps-only, so existing declarations win (#1835-class fix).
    if (javaFiles.length > 0 && config.buildTool === 'gradle') {
      injectGradleWiring(base, opts.dryRun, { dependencies: JAVA_BDD_TEST_DEPS })
    }
  }
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
