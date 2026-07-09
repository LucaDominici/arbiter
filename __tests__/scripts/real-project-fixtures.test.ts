import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readFixture(relPath: string): string {
  return readFileSync(resolve(relPath), 'utf-8')
}

describe('real-project fixture regressions', () => {
  it('ts-backend-web-db keeps the L2 TypeScript/testcontainers contract', () => {
    const pkg = JSON.parse(
      readFixture('__tests__/fixtures/real-projects/ts-backend-web-db/package.json'),
    ) as { devDependencies?: Record<string, string> }
    const tsconfig = JSON.parse(
      readFixture('__tests__/fixtures/real-projects/ts-backend-web-db/tsconfig.json'),
    ) as { compilerOptions?: Record<string, string> }

    expect(pkg.devDependencies?.testcontainers).toBeDefined()
    expect(tsconfig.compilerOptions?.moduleResolution).toBe('Bundler')
  })

  it('python-library keeps pytest-cov in the test extra for L2 coverage', () => {
    const pyproject = readFixture('__tests__/fixtures/real-projects/python-library/pyproject.toml')
    expect(pyproject).toContain('pytest-cov')
  })

  it('java-backend-web-db-gradle keeps jacoco, spotless, and generated test deps wired', () => {
    const buildGradle = readFixture(
      '__tests__/fixtures/real-projects/java-backend-web-db-gradle/build.gradle',
    )
    const checkstyle = readFixture(
      '__tests__/fixtures/real-projects/java-backend-web-db-gradle/config/checkstyle/checkstyle.xml',
    )

    expect(
      existsSync(
        resolve('__tests__/fixtures/real-projects/java-backend-web-db-gradle/gradle/jacoco.gradle'),
      ),
    ).toBe(true)
    expect(buildGradle).toContain('com.diffplug.spotless')
    expect(buildGradle).toContain("apply from: 'gradle/jacoco.gradle'")
    expect(buildGradle).toContain('org.assertj:assertj-core')
    expect(buildGradle).toContain('archunit-junit5')
    expect(checkstyle).not.toContain('<!DOCTYPE')
  })

  it('java-backend-web-db-gradle has PMD and SpotBugs configs wired (#404)', () => {
    const buildGradle = readFixture(
      '__tests__/fixtures/real-projects/java-backend-web-db-gradle/build.gradle',
    )
    const jacocoGradle = readFixture(
      '__tests__/fixtures/real-projects/java-backend-web-db-gradle/gradle/jacoco.gradle',
    )

    expect(
      existsSync(
        resolve(
          '__tests__/fixtures/real-projects/java-backend-web-db-gradle/config/pmd/ruleset.xml',
        ),
      ),
    ).toBe(true)
    expect(
      existsSync(
        resolve(
          '__tests__/fixtures/real-projects/java-backend-web-db-gradle/config/spotbugs/spotbugs-exclude.xml',
        ),
      ),
    ).toBe(true)
    expect(buildGradle).toContain('pmd')
    expect(buildGradle).toContain('com.github.spotbugs')
    expect(jacocoGradle).toContain('jacocoTestCoverageVerification')
    expect(jacocoGradle).toContain('check.dependsOn')
  })

  it('java-library-gradle keeps spotless and generated test deps wired', () => {
    const buildGradle = readFixture(
      '__tests__/fixtures/real-projects/java-library-gradle/build.gradle',
    )

    expect(buildGradle).toContain('com.diffplug.spotless')
    expect(buildGradle).toContain('org.assertj:assertj-core')
    expect(buildGradle).toContain('archunit-junit5')
    // #1042: BDD test deps, required for `./gradlew test` to compile arbiter's
    // generated ExampleBddIT.java (this is the "functional" tier fixture whose
    // generated L1 gate is actually EXECUTED by fixture-functional.test.ts, not
    // just rendered — see that file for the un-skip history).
    expect(buildGradle).toContain('io.cucumber:cucumber-java')
    expect(buildGradle).toContain('io.cucumber:cucumber-junit-platform-engine')
    expect(buildGradle).toContain('org.junit.platform:junit-platform-suite')
  })

  it('java-library-gradle checkstyle.xml declares a DOCTYPE (#1042)', () => {
    // Unlike java-backend-web-db-gradle (bake tier — never executed), this fixture's
    // `checkstyleMain` IS actually run by fixture-functional.test.ts. Verified
    // empirically: checkstyle-gradle-plugin's Ant bridge (any toolVersion, any rule
    // content) throws "Document root element must match DOCTYPE root" without a
    // DOCTYPE — the config simply does not parse. The DOCTYPE's PUBLIC ID resolves
    // to a DTD BUNDLED inside checkstyle's own jar
    // (com/puppycrawl/tools/checkstyle/configuration_1_3.dtd) — no network fetch,
    // so this does not reintroduce the DTD-network-resolution risk that motivated
    // omitting it from arbiter's OWN generated config/checkstyle.xml (M29, a
    // different file consumed by a different, non-Gradle-checkstyle-plugin path).
    const checkstyle = readFixture(
      '__tests__/fixtures/real-projects/java-library-gradle/config/checkstyle/checkstyle.xml',
    )
    expect(checkstyle).toContain('<!DOCTYPE module PUBLIC')
    expect(checkstyle).toContain('-//Checkstyle//DTD Checkstyle Configuration 1.3//EN')
  })

  it('rust-library keeps must_use on the public API used by clippy pedantic', () => {
    const lib = readFixture('__tests__/fixtures/real-projects/rust-library/src/lib.rs')
    expect(lib).toMatch(/#\[must_use\]\s+pub fn add/)
    expect(lib).toMatch(/#\[must_use\]\s+pub fn multiply/)
  })

  it('ts-bdd fixture has @cucumber/cucumber dep and feature file', () => {
    const pkg = JSON.parse(readFixture('__tests__/fixtures/real-projects/ts-bdd/package.json')) as {
      devDependencies?: Record<string, string>
    }
    expect(pkg.devDependencies?.['@cucumber/cucumber']).toBeDefined()
    expect(
      existsSync(resolve('__tests__/fixtures/real-projects/ts-bdd/features/example.feature')),
    ).toBe(true)
  })

  it('python-bdd fixture has pytest-bdd dep and feature file', () => {
    const pyproject = readFixture('__tests__/fixtures/real-projects/python-bdd/pyproject.toml')
    expect(pyproject).toContain('pytest-bdd')
    expect(
      existsSync(
        resolve('__tests__/fixtures/real-projects/python-bdd/tests/bdd/features/example.feature'),
      ),
    ).toBe(true)
  })

  it('go-bdd fixture has godog dep and feature file', () => {
    const goMod = readFixture('__tests__/fixtures/real-projects/go-bdd/go.mod')
    expect(goMod).toContain('cucumber/godog')
    expect(
      existsSync(resolve('__tests__/fixtures/real-projects/go-bdd/features/example.feature')),
    ).toBe(true)
  })

  it('java-bdd-gradle fixture has cucumber-jvm dep and feature file', () => {
    const buildGradle = readFixture('__tests__/fixtures/real-projects/java-bdd-gradle/build.gradle')
    expect(buildGradle).toContain('cucumber-java')
    expect(
      existsSync(
        resolve(
          '__tests__/fixtures/real-projects/java-bdd-gradle/src/test/resources/features/example.feature',
        ),
      ),
    ).toBe(true)
  })

  it('rust-bdd fixture has cucumber dep and feature file', () => {
    const cargoToml = readFixture('__tests__/fixtures/real-projects/rust-bdd/Cargo.toml')
    expect(cargoToml).toContain('cucumber')
    expect(
      existsSync(
        resolve('__tests__/fixtures/real-projects/rust-bdd/tests/features/example.feature'),
      ),
    ).toBe(true)
  })

  // #1840 F4 tranche-3: promoted to `tier: functional` — replaced the old
  // pytest-playwright-only fixture (a live-server E2E test with no unit-testable
  // app module at all) with a real FastAPI + SQLAlchemy(sqlite) app, so the
  // generated L1 gate (ruff + pytest) actually executes. testpaths scopes L1
  // `pytest` to tests/unit/; tests/integration/ is the L2 target.
  it('python-backend-web fixture has a real FastAPI+SQLAlchemy app with unit + integration tests', () => {
    const pyproject = readFixture(
      '__tests__/fixtures/real-projects/python-backend-web/pyproject.toml',
    )
    expect(pyproject).toContain('fastapi')
    expect(pyproject).toContain('sqlalchemy')
    expect(pyproject).toContain('testpaths = ["tests/unit"]')
    expect(
      existsSync(resolve('__tests__/fixtures/real-projects/python-backend-web/app/main.py')),
    ).toBe(true)
    expect(
      existsSync(
        resolve('__tests__/fixtures/real-projects/python-backend-web/tests/unit/test_crud.py'),
      ),
    ).toBe(true)
    expect(
      existsSync(
        resolve(
          '__tests__/fixtures/real-projects/python-backend-web/tests/integration/test_items_api.py',
        ),
      ),
    ).toBe(true)
  })
})

// #1859 — CI enables the corepack npm shim (`corepack enable npm`). For any
// project directory WITHOUT a `packageManager` pin, the shim resolves npm@latest
// at run time: when npm 12.0.0 shipped (requires node ^22.22.2 || ^24.15.0 ||
// >=26.0.0) every unpinned npm fixture started running the generated gate under
// an npm that refuses the CI node from .nvmrc (22.21.1) — `npm pack` died with
// "could not determine executable to run" and consumer-audit fail-closed exit 2
// (nightly run 29006188001). Same failure class as the Go toolchain pins
// (#1854/#1856): an unpinned tool resolved "latest" drifts out from under the
// pinned runtime. This guard requires every npm fixture to pin packageManager
// and requires the pinned npm major to support the .nvmrc node version.
describe('npm fixtures pin packageManager compatible with CI node (#1859)', () => {
  // Minimum node per npm major — from each npm major's own engines.node.
  // Extend this table when bumping a fixture's npm pin to a newer major.
  const MIN_NODE_FOR_NPM_MAJOR: Record<string, [number, number, number]> = {
    '10': [18, 17, 0],
    '11': [20, 17, 0],
    '12': [22, 22, 2],
  }

  const nvmrcNode = readFixture('.nvmrc').trim()
  const [ciMajor, ciMinor, ciPatch] = nvmrcNode.split('.').map(Number)

  const npmFixtures = [
    'multi-lane-fe-be',
    'ts-backend-web-db',
    'ts-bdd',
    'ts-frontend-spa',
    'ts-library',
    'vue-frontend-spa',
  ]

  it.each(npmFixtures)('%s pins packageManager to an npm the CI node supports', (fixture) => {
    const pkg = JSON.parse(
      readFixture(`__tests__/fixtures/real-projects/${fixture}/package.json`),
    ) as { packageManager?: string }

    const pin = pkg.packageManager
    expect(
      pin,
      `${fixture}/package.json has no packageManager pin — under the corepack shim an ` +
        'unpinned directory resolves npm@latest, which can refuse the CI node (#1859)',
    ).toBeDefined()

    const match = /^npm@(\d+)\.\d+\.\d+$/.exec(pin as string)
    expect(match, `${fixture} packageManager "${pin}" is not an exact npm@X.Y.Z pin`).not.toBeNull()

    const npmMajor = match![1]
    const minNode = MIN_NODE_FOR_NPM_MAJOR[npmMajor]
    expect(
      minNode,
      `no known minimum node version recorded for npm major ${npmMajor} — ` +
        'add it to MIN_NODE_FOR_NPM_MAJOR in this test (read engines.node from the npm release)',
    ).toBeDefined()

    const [minMajor, minMinor, minPatch] = minNode
    const satisfies =
      ciMajor > minMajor ||
      (ciMajor === minMajor &&
        (ciMinor > minMinor || (ciMinor === minMinor && ciPatch >= minPatch)))
    expect(
      satisfies,
      `.nvmrc node ${nvmrcNode} does not satisfy npm@${npmMajor}'s minimum ` +
        `${minNode.join('.')} — bump .nvmrc or lower the fixture's npm pin (#1859)`,
    ).toBe(true)
  })
})
