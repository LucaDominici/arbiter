// SPDX-License-Identifier: Apache-2.0
// Idempotent root-build Gradle injector (#1835-class: Java gold tooling was
// scaffolded but never wired into the build — gate called nonexistent tasks).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  injectGradleWiring,
  safeApplyFromSnippet,
  findRootBuildFile,
  type GradleWiringRequest,
} from '../../src/utils/gradle.js'

const WIRING: GradleWiringRequest = {
  plugins: [
    { id: 'checkstyle' },
    { id: 'pmd' },
    { id: 'com.github.spotbugs', version: '6.0.18' },
    { id: 'com.diffplug.spotless', version: '7.0.3' },
  ],
  snippets: [
    {
      signature: /(?:^|\n)[ \t]*checkstyle\s*\{/,
      kts: 'checkstyle {\n    configFile = file("config/checkstyle.xml")\n}',
      groovy: "checkstyle {\n    configFile = file('config/checkstyle.xml')\n}",
    },
  ],
  dependencies: [{ coordinate: 'org.assertj:assertj-core:3.26.3' }],
}

describe('injectGradleWiring', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-gradle-inject-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function ktsBuild(content: string): string {
    const p = join(dir, 'build.gradle.kts')
    writeFileSync(p, content)
    return p
  }

  it('wires plugins, config block, and deps into a kts build with an existing plugins block', () => {
    const p = ktsBuild('plugins {\n    java\n}\n\nrepositories {\n    mavenCentral()\n}\n')
    const res = injectGradleWiring(dir, false, WIRING)
    expect(res.changed).toBe(true)
    const out = readFileSync(p, 'utf-8')
    expect(out).toContain('id("checkstyle")')
    expect(out).toContain('id("pmd")')
    expect(out).toContain('id("com.github.spotbugs") version "6.0.18"')
    expect(out).toContain('id("com.diffplug.spotless") version "7.0.3"')
    // Config lands in the marker-delimited managed block at EOF.
    expect(out).toContain('>>> arbiter:java-tooling')
    expect(out).toContain('configFile = file("config/checkstyle.xml")')
    // kts deps use the string-invoke form (typed accessor may not exist).
    expect(out).toContain(
      'dependencies { "testImplementation"("org.assertj:assertj-core:3.26.3") }',
    )
    expect(out).toContain('<<< arbiter:java-tooling')
    // plugins remain BEFORE other build logic (Gradle requirement).
    expect(out.indexOf('id("checkstyle")')).toBeLessThan(out.indexOf('repositories'))
  })

  it('is idempotent — a second run leaves the file byte-identical', () => {
    const p = ktsBuild('plugins {\n    java\n}\n')
    injectGradleWiring(dir, false, WIRING)
    const first = readFileSync(p, 'utf-8')
    const res = injectGradleWiring(dir, false, WIRING)
    expect(res.changed).toBe(false)
    expect(readFileSync(p, 'utf-8')).toBe(first)
  })

  it('respects a pre-existing plugin declaration (brownfield — no duplicate)', () => {
    const p = ktsBuild('plugins {\n    java\n    id("com.diffplug.spotless") version "6.25.0"\n}\n')
    injectGradleWiring(dir, false, WIRING)
    const out = readFileSync(p, 'utf-8')
    expect(out.match(/com\.diffplug\.spotless/g)).toHaveLength(1)
    // The user's pinned version is untouched.
    expect(out).toContain('version "6.25.0"')
    expect(out).toContain('id("checkstyle")')
  })

  it('respects a pre-existing config block (brownfield — skips ours)', () => {
    const p = ktsBuild(
      'plugins {\n    java\n}\n\ncheckstyle {\n    configFile = file("cfg/own.xml")\n}\n',
    )
    injectGradleWiring(dir, false, WIRING)
    const out = readFileSync(p, 'utf-8')
    expect(out).toContain('cfg/own.xml')
    expect(out).not.toContain('config/checkstyle.xml')
  })

  it('creates a plugins block after imports/buildscript when none exists', () => {
    const p = ktsBuild(
      '// legacy build\nimport java.util.Locale\n\nbuildscript {\n    repositories { mavenCentral() }\n}\n\nrepositories {\n    mavenCentral()\n}\n',
    )
    injectGradleWiring(dir, false, WIRING)
    const out = readFileSync(p, 'utf-8')
    const pluginsIdx = out.indexOf('plugins {')
    expect(pluginsIdx).toBeGreaterThan(out.indexOf('buildscript'))
    expect(pluginsIdx).toBeLessThan(out.indexOf('repositories {\n    mavenCentral()\n}\n'))
  })

  it('wires a Groovy build.gradle with Groovy syntax', () => {
    const p = join(dir, 'build.gradle')
    writeFileSync(p, "plugins {\n    id 'java'\n}\n")
    injectGradleWiring(dir, false, WIRING)
    const out = readFileSync(p, 'utf-8')
    expect(out).toContain("id 'checkstyle'")
    expect(out).toContain("id 'com.diffplug.spotless' version '7.0.3'")
    expect(out).toContain("configFile = file('config/checkstyle.xml')")
    expect(out).toContain("dependencies { testImplementation 'org.assertj:assertj-core:3.26.3' }")
    expect(out).not.toContain('id("checkstyle")')
  })

  it('fills gaps inside an existing managed block instead of appending a second one', () => {
    const p = ktsBuild('plugins {\n    java\n}\n')
    injectGradleWiring(dir, false, { snippets: WIRING.snippets })
    injectGradleWiring(dir, false, { dependencies: WIRING.dependencies })
    const out = readFileSync(p, 'utf-8')
    expect(out.match(/>>> arbiter:java-tooling/g)).toHaveLength(1)
    expect(out.match(/<<< arbiter:java-tooling/g)).toHaveLength(1)
    expect(out).toContain('org.assertj:assertj-core')
    expect(out).toContain('config/checkstyle.xml')
  })

  it('no-ops (with warn) when no root build script exists', () => {
    const res = injectGradleWiring(dir, false, WIRING)
    expect(res).toEqual({ changed: false, buildFile: null })
  })

  it('no-ops on dryRun', () => {
    const p = ktsBuild('plugins {\n    java\n}\n')
    const before = readFileSync(p, 'utf-8')
    const res = injectGradleWiring(dir, true, WIRING)
    expect(res.changed).toBe(false)
    expect(readFileSync(p, 'utf-8')).toBe(before)
  })

  it('prefers build.gradle.kts when both DSL files exist', () => {
    ktsBuild('plugins {\n    java\n}\n')
    writeFileSync(join(dir, 'build.gradle'), "plugins { id 'java' }\n")
    expect(findRootBuildFile(dir)).toBe(join(dir, 'build.gradle.kts'))
  })
})

describe('safeApplyFromSnippet', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-gradle-apply-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an apply(from=...) snippet for a compatible script', () => {
    writeFileSync(join(dir, 'spotless.gradle'), 'spotless {\n    java { }\n}\n')
    const s = safeApplyFromSnippet(dir, 'spotless.gradle')
    expect(s).not.toBeNull()
    expect(s?.kts).toBe('apply(from = "spotless.gradle")')
    expect(s?.groovy).toBe("apply from: 'spotless.gradle'")
    expect(s?.signature.test('apply(from = "spotless.gradle")')).toBe(true)
    expect(s?.signature.test("apply from: 'spotless.gradle'")).toBe(true)
  })

  it('withholds wiring when the script still carries a plugins {} block (pre-fix shape)', () => {
    // Wiring such a file would turn a dormant scaffold into a hard build failure:
    // Gradle forbids the plugins DSL inside applied scripts.
    writeFileSync(
      join(dir, 'spotless.gradle'),
      "plugins {\n    id 'com.diffplug.spotless' version '7.0.3'\n}\n\nspotless { }\n",
    )
    expect(safeApplyFromSnippet(dir, 'spotless.gradle')).toBeNull()
  })

  it('withholds wiring when the script is absent', () => {
    expect(safeApplyFromSnippet(dir, 'spotless.gradle')).toBeNull()
  })

  it('supports nested paths', () => {
    mkdirSync(join(dir, 'gradle'), { recursive: true })
    writeFileSync(join(dir, 'gradle', 'pitest.gradle'), 'pitest { }\n')
    const s = safeApplyFromSnippet(dir, 'gradle/pitest.gradle')
    expect(s?.kts).toBe('apply(from = "gradle/pitest.gradle")')
  })

  // #1898: brownfield-inline idempotency — a project may already configure
  // spotless/spotbugs directly in its root build (its own authoring, or a
  // pre-#1890 arbiter run before config moved into the root managed block).
  it('withholds wiring when the root build already configures the tooling inline (#1898)', () => {
    writeFileSync(join(dir, 'build.gradle.kts'), 'spotless {\n    java { }\n}\n')
    writeFileSync(join(dir, 'spotless.gradle'), 'spotless {\n    java { }\n}\n')
    const s = safeApplyFromSnippet(dir, 'spotless.gradle', {
      rootBuildSignatures: [/(?:^|\n)[ \t]*spotless\s*\{/],
    })
    expect(s).toBeNull()
  })

  it('still wires the script when rootBuildSignatures are given but none match', () => {
    writeFileSync(join(dir, 'build.gradle.kts'), 'plugins {\n    java\n}\n')
    writeFileSync(join(dir, 'spotless.gradle'), 'spotless {\n    java { }\n}\n')
    const s = safeApplyFromSnippet(dir, 'spotless.gradle', {
      rootBuildSignatures: [/(?:^|\n)[ \t]*spotless\s*\{/],
    })
    expect(s).not.toBeNull()
  })

  it('withholds wiring when the script imports a plugin-provided class (pre-#1890 shape, #1898)', () => {
    // Verified empirically on a real brownfield repo: an applied Groovy script
    // cannot resolve com.github.spotbugs.snom.Effort — script-plugin classloader
    // isolation — so a relic file from before #1890 crashes the build the
    // instant it is applied: "unable to resolve class ...Effort".
    writeFileSync(
      join(dir, 'spotbugs.gradle'),
      'import com.github.spotbugs.snom.Effort\n\nspotbugs {\n    effort = Effort.MAX\n}\n',
    )
    expect(safeApplyFromSnippet(dir, 'spotbugs.gradle')).toBeNull()
  })

  it('withholds a com.diffplug import the same way', () => {
    writeFileSync(
      join(dir, 'spotless.gradle'),
      'import com.diffplug.spotless.FormatterStep\n\nspotless { }\n',
    )
    expect(safeApplyFromSnippet(dir, 'spotless.gradle')).toBeNull()
  })
})
