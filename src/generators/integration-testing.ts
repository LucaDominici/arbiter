// SPDX-License-Identifier: Apache-2.0
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { injectGradleWiring, safeApplyFromSnippet } from '../utils/gradle.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

function appendCargoDevDep(base: string, name: string, version: string, dryRun: boolean): void {
  if (dryRun) return
  const cargoPath = join(base, 'Cargo.toml')
  if (!existsSync(cargoPath)) return
  const content = readFileSync(cargoPath, 'utf-8')
  if (content.includes(name)) return
  const section = '[dev-dependencies]'
  const entry = `${name} = "${version}"\n`
  if (content.includes(section)) {
    writeFileSync(cargoPath, content.replace(section, `${section}\n${entry}`), 'utf-8')
  } else {
    writeFileSync(cargoPath, `${content.trimEnd()}\n\n${section}\n${entry}`, 'utf-8')
  }
}

export interface IntegrationTestingGeneratorResult {
  files: WriteResult[]
}

/**
 * Database integration-testing scaffolding (#487 scope clarification).
 *
 * Generates Testcontainers + PostgreSQL setup for projects with a database.
 * Most templates under `src/templates/integration-testing/` hardcode
 * PostgreSQLContainer / @Testcontainers; the Go `sqlite` variant is the one
 * containerless exception. The generator is intentionally DB-only, not
 * "any integration".
 *
 * **API-only projects** (REST contract testing without a database) are NOT
 * served by this generator — broadening the gate to `hasDatabase || hasPublicApi`
 * would emit PostgreSQL scaffolding for projects that have no database, which
 * is strictly worse than under-generating. Those projects are covered by the
 * separate `contract-testing` generator (Pact) gated on `config.contractType`.
 *
 * Gate: emits when the project has a database AND `governanceLevel !== 'L1'`.
 * `databaseEngine` is the source of truth: when it is explicitly `'none'` the
 * gate emits nothing even if a stale `hasDatabase:true` was hand-edited in
 * (incoherent input ⇒ engine wins). When the engine is unset we fall back to
 * the legacy `hasDatabase` boolean.
 *
 * Engine ⇒ template mapping (#1317):
 *  - `sqlite`     ⇒ containerless Go TestMain (no Docker / testcontainers).
 *  - `postgresql` ⇒ Postgres testcontainers scaffolding.
 *  - `mysql` / `mongodb` / `other` / legacy-unset ⇒ currently fall back to the
 *    Postgres testcontainers scaffolding (dedicated templates tracked under #1317).
 */
/**
 * Emit the Java/multi Testcontainers scaffold + wire config/testcontainers-deps.gradle
 * into the root build. Extracted from generateIntegrationTesting to keep it under
 * the complexity-15 ceiling (#1887-F added the wiring call on top of the
 * pre-existing 3-file emission).
 */
function emitJavaIntegrationTesting(
  config: ProjectConfig,
  base: string,
  data: object,
  dryRun: boolean,
): WriteResult[] {
  const supportPkg = config.basePackage
    ? `src/test/java/${config.basePackage.replace(/\./g, '/')}/support`
    : 'src/test/java/support'

  const results: WriteResult[] = [
    writeFile(
      resolvedPath(base, supportPkg, 'AbstractIntegrationTest.java'),
      renderTemplate('integration-testing/AbstractIntegrationTest.java.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, supportPkg, 'NoH2ArchTest.java'),
      renderTemplate('integration-testing/NoH2ArchTest.java.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, 'config', 'testcontainers-deps.gradle'),
      renderTemplate('integration-testing/testcontainers-deps.gradle.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]

  // #1887-F: config/testcontainers-deps.gradle was emitted but never wired
  // into the root build — same ghost class as #1886. No plugins{} block in
  // the snippet (pure deps), so only apply(from=...) is needed.
  if (config.buildTool === 'gradle') {
    const applyTestcontainers = safeApplyFromSnippet(base, 'config/testcontainers-deps.gradle')
    if (applyTestcontainers) {
      injectGradleWiring(base, dryRun, { snippets: [applyTestcontainers] })
    }
  }

  return results
}

export function generateIntegrationTesting(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): IntegrationTestingGeneratorResult {
  // Gate: skip at L1, and skip when there is no database. The engine is the
  // source of truth — an explicit 'none' suppresses generation regardless of a
  // (possibly stale, hand-edited) hasDatabase:true. Engine unset ⇒ legacy
  // hasDatabase boolean. See JSDoc for #487 / #1317 rationale.
  const hasDatabase =
    config.databaseEngine != null ? config.databaseEngine !== 'none' : config.hasDatabase
  if (!hasDatabase || config.governanceLevel === 'L1') {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config
  const results: WriteResult[] = []

  if (config.language === 'java' || config.language === 'multi') {
    results.push(...emitJavaIntegrationTesting(config, base, data, opts.dryRun))
  }
  if (config.language === 'typescript' || config.language === 'multi') {
    results.push(
      writeFile(
        resolvedPath(base, 'src', 'test', 'test-setup.ts'),
        renderTemplate('integration-testing/test-setup.ts.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, '.eslintrc-no-fake-db.json'),
        renderTemplate('integration-testing/eslint-no-fake-db.json.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    // #1887-D: flat-config sibling (INV-34) — ESLint v9 cannot load the legacy
    // .eslintrc-no-fake-db.json above (eslintrc support removed), so it was
    // inert. Mirrors eslint.config.static.mjs's precedent.
    results.push(
      writeFile(
        resolvedPath(base, 'eslint.config.no-fake-db.mjs'),
        renderTemplate('integration-testing/eslint.config.no-fake-db.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }
  if (config.language === 'rust') {
    results.push(
      writeFile(
        resolvedPath(base, 'tests', 'db_fixture.rs'),
        renderTemplate('integration-testing/db_fixture.rs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    appendCargoDevDep(base, 'testcontainers', '0.23', opts.dryRun)
  } else if (config.language === 'go') {
    // #1317: sqlite ⇒ containerless TestMain (no testcontainers/Docker import).
    // postgresql ⇒ Postgres testcontainers. mysql/mongodb/other and legacy
    // hasDatabase:true with engine unset currently fall back to the Postgres
    // testcontainers template (dedicated per-engine templates tracked under #1317).
    const goTemplate =
      config.databaseEngine === 'sqlite'
        ? 'integration-testing/main_test_sqlite.go.ejs'
        : 'integration-testing/main_test.go.ejs'
    results.push(
      writeFile(resolvedPath(base, 'tests', 'main_test.go'), renderTemplate(goTemplate, data), {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    )
  } else if (config.language === 'python') {
    results.push(
      writeFile(
        resolvedPath(base, 'tests', 'conftest.py'),
        renderTemplate('integration-testing/conftest.py.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files: results }
}
