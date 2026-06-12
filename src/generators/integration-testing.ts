// SPDX-License-Identifier: Apache-2.0
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
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
 * Every template under `src/templates/integration-testing/` hardcodes
 * PostgreSQLContainer / @Testcontainers; the generator is intentionally
 * DB-only, not "any integration".
 *
 * **API-only projects** (REST contract testing without a database) are NOT
 * served by this generator — broadening the gate to `hasDatabase || hasPublicApi`
 * would emit PostgreSQL scaffolding for projects that have no database, which
 * is strictly worse than under-generating. Those projects are covered by the
 * separate `contract-testing` generator (Pact) gated on `config.contractType`.
 *
 * Gate: emits when `hasDatabase === true` AND `governanceLevel !== 'L1'`.
 */
export function generateIntegrationTesting(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): IntegrationTestingGeneratorResult {
  // Gate: only generate when hasDatabase is true AND governance level is not L1.
  // See JSDoc for #487 rationale — this generator is intentionally DB-scoped.
  if (!config.hasDatabase || config.governanceLevel === 'L1') {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config
  const results: WriteResult[] = []

  if (config.language === 'java' || config.language === 'multi') {
    const supportPkg = config.basePackage
      ? `src/test/java/${config.basePackage.replace(/\./g, '/')}/support`
      : 'src/test/java/support'

    results.push(
      writeFile(
        resolvedPath(base, supportPkg, 'AbstractIntegrationTest.java'),
        renderTemplate('integration-testing/AbstractIntegrationTest.java.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, supportPkg, 'NoH2ArchTest.java'),
        renderTemplate('integration-testing/NoH2ArchTest.java.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, 'config', 'testcontainers-deps.gradle'),
        renderTemplate('integration-testing/testcontainers-deps.gradle.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
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
    // #1317: sqlite ⇒ containerless TestMain (no testcontainers/Docker import);
    // postgresql/mysql (and legacy hasDatabase:true with engine unset) ⇒ testcontainers.
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
