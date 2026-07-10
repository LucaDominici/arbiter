// SPDX-License-Identifier: Apache-2.0
// #1835-class fix: the Java gold tooling (checkstyle/pmd/spotbugs/spotless/pitest
// configs, archunit + behavioral test scaffolds) was emitted as standalone files
// but never WIRED into the Gradle build — the generated gate then called tasks
// that did not exist (`Task 'checkstyleMain' not found`) and scaffolded tests
// that could not compile (missing AssertJ/ArchUnit deps). These tests pin the
// wiring: plugins declared in the root plugins block, config blocks + guarded
// apply(from=...) lines in the arbiter-managed block, deps injected fill-gaps-only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateDebtGates } from '../../src/generators/debt-gates.js'
import { generateArchUnit } from '../../src/generators/archunit.js'
import { generateBehavioralTests } from '../../src/generators/behavioral-tests.js'
import { generateMutation } from '../../src/generators/mutation.js'

function javaGradleConfig(dir: string, overrides = {}) {
  return makeConfig(dir, {
    language: 'java',
    buildTool: 'gradle',
    basePackage: 'com.example.demo',
    ...overrides,
  })
}

describe('java gold tooling wiring (#1835-class)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('java')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  describe('generateDebtGates → static-analysis wiring', () => {
    it('declares the tooling plugins in the root plugins block', () => {
      generateDebtGates(javaGradleConfig(dir))
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build).toContain("id 'checkstyle'")
      expect(build).toContain("id 'pmd'")
      expect(build).toMatch(/id 'com\.github\.spotbugs' version '\d/)
      expect(build).toMatch(/id 'com\.diffplug\.spotless' version '\d/)
    })

    it('points the config blocks at the emitted config files and applies the scripts', () => {
      generateDebtGates(javaGradleConfig(dir))
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build).toContain('>>> arbiter:java-tooling')
      expect(build).toContain("configFile = file('config/checkstyle.xml')")
      expect(build).toContain("ruleSetFiles = files('config/pmd-ruleset.xml')")
      // SpotBugs enum config MUST live here — applied scripts cannot see the
      // plugin classpath (script-plugin classloader isolation).
      // Groovy DSL uses valueOf(): a direct enum-constant reference resolves to
      // the constant's inner CLASS in Groovy property access (verified on 8.8).
      expect(build).toContain("com.github.spotbugs.snom.Effort.valueOf('MAX')")
      expect(build).toContain("excludeFilter = file('config/spotbugs-exclude.xml')")
      expect(build).toContain("apply from: 'spotless.gradle'")
      expect(build).toContain("apply from: 'spotbugs.gradle'")
    })

    it('emits applied scripts WITHOUT a plugins block (illegal in applied scripts)', () => {
      generateDebtGates(javaGradleConfig(dir))
      for (const rel of ['spotless.gradle', 'spotbugs.gradle']) {
        const script = readFileSync(join(dir, rel), 'utf-8')
        expect(script, `${rel} must not carry a plugins {} block`).not.toMatch(
          /(?:^|\n)[ \t]*plugins\s*\{/,
        )
      }
    })

    it('is idempotent — regeneration leaves the build file byte-identical', () => {
      const config = javaGradleConfig(dir)
      generateDebtGates(config)
      const first = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      generateDebtGates(config)
      expect(readFileSync(join(dir, 'build.gradle'), 'utf-8')).toBe(first)
    })

    it('withholds apply(from=...) when the on-disk script still has the pre-fix plugins block', () => {
      // A user-modified spotless.gradle is withheld from template fixes (#1344);
      // wiring it anyway would turn a dormant scaffold into a hard build failure.
      writeFileSync(
        join(dir, 'spotless.gradle'),
        "plugins {\n    id 'com.diffplug.spotless' version '7.0.3'\n}\n\nspotless { java { } }\n",
      )
      generateDebtGates(javaGradleConfig(dir))
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build).not.toContain("apply from: 'spotless.gradle'")
      // The rest of the wiring still lands.
      expect(build).toContain("apply from: 'spotbugs.gradle'")
      expect(build).toContain("id 'checkstyle'")
    })

    // #1898: confirmed on a real brownfield repo (onboarded before #1890) — the
    // root build already authored spotless {} / spotbugs {} directly (its own
    // brownfield wiring, predating the managed-block redesign). Re-wiring via
    // apply(from=...) on top duplicated that config and, whenever a pre-#1890
    // relic script was still on disk (see the next test), broke the build
    // outright.
    it('withholds apply(from=...) for spotless/spotbugs when already configured inline', () => {
      writeFileSync(
        join(dir, 'build.gradle'),
        [
          "plugins { id 'java' }",
          '',
          'spotless {',
          "    java { googleJavaFormat('1.22.0').aosp() }",
          '}',
          '',
          'spotbugs {',
          '    ignoreFailures = true', // brownfield ratchet — must survive untouched
          '}',
          '',
        ].join('\n'),
      )
      generateDebtGates(javaGradleConfig(dir))
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build).not.toContain("apply from: 'spotless.gradle'")
      expect(build).not.toContain("apply from: 'spotbugs.gradle'")
      expect(build.match(/ignoreFailures = true/g)).toHaveLength(1)
      // Everything NOT already configured inline (checkstyle/pmd plugins +
      // config, which this fixture omits) is still filled in.
      expect(build).toContain("id 'checkstyle'")
      expect(build).toContain("id 'pmd'")
    })

    it('withholds apply(from=...) for a pre-#1890 relic script even without inline config', () => {
      // The exact crash confirmed on ripme: a relic spotbugs.gradle from
      // before #1890 still imports the plugin's enum type directly — script-
      // plugin classloader isolation means that import can never resolve in an
      // applied script ("unable to resolve class ...Effort").
      writeFileSync(
        join(dir, 'spotbugs.gradle'),
        "import com.github.spotbugs.snom.Effort\n\nspotbugs {\n    effort = Effort.MAX\n}\n",
      )
      generateDebtGates(javaGradleConfig(dir))
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build).not.toContain("apply from: 'spotbugs.gradle'")
      // spotless.gradle is untouched by this fixture, so it still wires normally.
      expect(build).toContain("apply from: 'spotless.gradle'")
    })

    it('emits checkstyle.xml with the mandatory DOCTYPE (checkstyle rejects it otherwise)', () => {
      generateDebtGates(javaGradleConfig(dir))
      const xml = readFileSync(join(dir, 'config', 'checkstyle.xml'), 'utf-8')
      expect(xml).toContain('<!DOCTYPE module PUBLIC')
      // google-java-format compat: empty bodies (`{}`) must satisfy WhitespaceAround.
      expect(xml).toContain('allowEmptyConstructors')
    })

    it('bakes ratchetFrom into spotless.gradle for a brownfield repo (origin default branch)', () => {
      initGit(dir)
      execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['commit', '-m', 'legacy'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
        cwd: dir,
        stdio: 'ignore',
      })
      generateDebtGates(javaGradleConfig(dir))
      const spotless = readFileSync(join(dir, 'spotless.gradle'), 'utf-8')
      expect(spotless).toContain("ratchetFrom 'origin/main'")
    })

    it('omits ratchetFrom for a greenfield repo (no origin ref) — full enforcement', () => {
      initGit(dir)
      generateDebtGates(javaGradleConfig(dir))
      const spotless = readFileSync(join(dir, 'spotless.gradle'), 'utf-8')
      expect(spotless).not.toContain('ratchetFrom')
    })

    it('does not touch the build for maven projects', () => {
      const before = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      generateDebtGates(javaGradleConfig(dir, { buildTool: 'maven' }))
      expect(readFileSync(join(dir, 'build.gradle'), 'utf-8')).toBe(before)
    })

    it('wires the gate-essential pair (checkstyle + spotless) even at L1 (B4 rule)', () => {
      // The generated L1 gate already runs `./gradlew checkstyleMain
      // spotlessCheck test` — without this wiring an L1 Java init is RED on
      // first run with "Task 'checkstyleMain' not found" (same B4/#1491 rule
      // that emits the TS/python gate-essential scaffold below enableDebtGates).
      generateDebtGates(javaGradleConfig(dir, { governanceLevel: 'L1', enableDebtGates: false }))
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build).toContain("id 'checkstyle'")
      expect(build).toMatch(/id 'com\.diffplug\.spotless' version '\d/)
      expect(build).toContain("apply from: 'spotless.gradle'")
      expect(existsSync(join(dir, 'config', 'checkstyle.xml'))).toBe(true)
      expect(existsSync(join(dir, 'spotless.gradle'))).toBe(true)
      // Debt-tier tooling stays behind the guard at L1.
      expect(build).not.toContain("id 'pmd'")
      expect(build).not.toContain('spotbugs')
      expect(existsSync(join(dir, 'config', 'pmd-ruleset.xml'))).toBe(false)
    })
  })

  describe('generateArchUnit → test deps wiring', () => {
    it('emits + wires arch-test-deps.gradle whenever ANY archunit test lands (not only hexagonal)', () => {
      // architectureStyle 'none' still emits NoMockMvcTest (INV-29) — which
      // imports com.tngtech.archunit and previously could never compile.
      generateArchUnit(javaGradleConfig(dir, { architectureStyle: 'none' }))
      const depsPath = join(dir, 'gradle', 'arch-test-deps.gradle')
      expect(existsSync(depsPath)).toBe(true)
      expect(readFileSync(depsPath, 'utf-8')).toContain('com.tngtech.archunit:archunit-junit5')
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build).toContain("apply from: 'gradle/arch-test-deps.gradle'")
    })

    it('gates the Spring/testcontainers deps on a spring framework', () => {
      generateArchUnit(javaGradleConfig(dir, { architectureStyle: 'none' }))
      const plain = readFileSync(join(dir, 'gradle', 'arch-test-deps.gradle'), 'utf-8')
      expect(plain).not.toContain('spring-boot-testcontainers')
      expect(plain).not.toContain('rest-assured')

      const springDir = createTestProject('java')
      try {
        generateArchUnit(
          javaGradleConfig(springDir, { architectureStyle: 'none', framework: 'spring-boot' }),
        )
        const spring = readFileSync(join(springDir, 'gradle', 'arch-test-deps.gradle'), 'utf-8')
        expect(spring).toContain('spring-boot-testcontainers')
        expect(spring).toContain('rest-assured')
      } finally {
        cleanupTestProject(springDir)
      }
    })

    // #1898: brownfield may already declare the archunit coordinate directly
    // (its own wiring, predating arbiter's generated deps file). Gradle
    // tolerates the duplicate, but the injector should not introduce it.
    it('withholds apply(from=...) when the archunit coordinate is already declared inline', () => {
      writeFileSync(
        join(dir, 'build.gradle'),
        "plugins { id 'java' }\n\ndependencies {\n    testImplementation 'com.tngtech.archunit:archunit-junit5:1.3.0'\n}\n",
      )
      generateArchUnit(javaGradleConfig(dir, { architectureStyle: 'none' }))
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build).not.toContain("apply from: 'gradle/arch-test-deps.gradle'")
      expect(build.match(/com\.tngtech\.archunit:archunit-junit5/g)).toHaveLength(1)
    })
  })

  describe('generateBehavioralTests → example suite deps', () => {
    it('injects the deps the emitted Java example suite imports (AssertJ, JUnit 5, Cucumber)', () => {
      generateBehavioralTests(javaGradleConfig(dir))
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build).toContain("testImplementation 'org.assertj:assertj-core:")
      expect(build).toContain("testImplementation 'org.junit.jupiter:junit-jupiter:")
      expect(build).toContain("testImplementation 'io.cucumber:cucumber-java:")
      expect(build).toContain("testImplementation 'io.cucumber:cucumber-junit-platform-engine:")
      expect(build).toContain("testImplementation 'org.junit.platform:junit-platform-suite:")
      expect(build).toContain("testRuntimeOnly 'org.junit.platform:junit-platform-launcher:")
    })

    it('respects an existing declaration (fill-gaps-only, brownfield versions win)', () => {
      writeFileSync(
        join(dir, 'build.gradle'),
        "plugins { id 'java' }\n\ndependencies {\n    testImplementation 'org.assertj:assertj-core:3.11.1'\n}\n",
      )
      generateBehavioralTests(javaGradleConfig(dir))
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build.match(/org\.assertj:assertj-core/g)).toHaveLength(1)
      expect(build).toContain('assertj-core:3.11.1')
    })
  })

  describe('generateMutation → pitest wiring (L3)', () => {
    it('declares the pitest plugin in the root plugins block and applies gradle/pitest.gradle', () => {
      generateMutation(javaGradleConfig(dir, { governanceLevel: 'L3' }))
      const build = readFileSync(join(dir, 'build.gradle'), 'utf-8')
      expect(build).toMatch(/id 'info\.solidsoft\.pitest' version '\d/)
      expect(build).toContain("apply from: 'gradle/pitest.gradle'")
      const pitest = readFileSync(join(dir, 'gradle', 'pitest.gradle'), 'utf-8')
      expect(pitest).not.toMatch(/(?:^|\n)[ \t]*plugins\s*\{/)
    })
  })
})
