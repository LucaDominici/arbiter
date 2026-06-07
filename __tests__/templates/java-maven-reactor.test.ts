// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #1226: Java Maven reactor handoff + setup-java-maven composite action
// CANON-04 render test, CANON-18 L1-L4 cross, CANON-19 archetype buckets

const SETUP_JAVA_SHA_PR_FAST = 'actions/setup-java@c1e323688fd81a25caa38c78aa6df2d33d3e20d9'
const SETUP_JAVA_SHA_RELEASE = 'actions/setup-java@c1e32368a7ca79e19b34aa7e28d3de3a8b47c8ea'

function renderAction(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/actions/setup-java-maven/action.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

function renderPrFast(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/01-pr-fast.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

function renderPrExtended(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/02-pr-extended.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

function renderRelease(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/05-release.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const

// ─── Phase 1: setup-java-maven composite action ───────────────────────────────

describe('setup-java-maven/action.yml.ejs — structural invariants (CANON-04, #1226)', () => {
  it('is a composite action', () => {
    expect(renderAction()).toContain('using: composite')
  })

  it('uses actions/setup-java (SHA-pinned)', () => {
    const rendered = renderAction()
    expect(rendered).toContain('actions/setup-java@')
  })

  it('sets distribution to temurin', () => {
    expect(renderAction()).toContain('temurin')
  })

  it('exposes a java-version input with default of 21', () => {
    const rendered = renderAction()
    expect(rendered).toMatch(/java-version/)
    expect(rendered).toContain("default: '21'")
  })
})

// ─── Phase 2: 01-pr-fast reactor job (CANON-18 L1-L4) ────────────────────────

describe('01-pr-fast.yml.ejs — Java Maven build-reactor job (CANON-18, #1226)', () => {
  it.each(LEVELS)('java/maven %s: build-reactor job is emitted', (governanceLevel) => {
    const rendered = renderPrFast({ language: 'java', buildTool: 'maven', governanceLevel })
    expect(rendered).toContain('build-reactor:')
  })

  it.each(LEVELS)(
    'java/maven %s: jobs use setup-java-maven composite (not inline setup-java)',
    (governanceLevel) => {
      const rendered = renderPrFast({ language: 'java', buildTool: 'maven', governanceLevel })
      expect(rendered).toContain('uses: ./.github/actions/setup-java-maven')
      expect(rendered).not.toContain(SETUP_JAVA_SHA_PR_FAST)
    },
  )

  it.each(LEVELS)('java/maven %s: downstream unit-tests needs build-reactor', (governanceLevel) => {
    const rendered = renderPrFast({ language: 'java', buildTool: 'maven', governanceLevel })
    expect(rendered).toMatch(/needs:.*build-reactor|build-reactor.*needs:/)
  })

  it.each(LEVELS)(
    'java/maven %s: build-reactor uploads reactor-m2 artifact with SHA-pinned upload-artifact',
    (governanceLevel) => {
      const rendered = renderPrFast({ language: 'java', buildTool: 'maven', governanceLevel })
      expect(rendered).toContain('reactor-m2-')
      expect(rendered).toContain('upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a')
    },
  )

  it.each(LEVELS)(
    'java/maven %s: downstream jobs restore reactor from job-isolated runner.temp path',
    (governanceLevel) => {
      const rendered = renderPrFast({ language: 'java', buildTool: 'maven', governanceLevel })
      expect(rendered).toContain('runner.temp')
      expect(rendered).toContain('.m2-reactor')
    },
  )

  it.each(LEVELS)(
    'java/maven %s: build-reactor uses dependency:go-offline for plugin pre-fetch (RT-03)',
    (governanceLevel) => {
      const rendered = renderPrFast({ language: 'java', buildTool: 'maven', governanceLevel })
      expect(rendered).toContain('dependency:go-offline')
    },
  )

  it.each(LEVELS)(
    'java/maven %s: retention-days is 7, overwrite true (RT-05)',
    (governanceLevel) => {
      const rendered = renderPrFast({ language: 'java', buildTool: 'maven', governanceLevel })
      expect(rendered).toContain('retention-days: 7')
      expect(rendered).toContain('overwrite: true')
    },
  )

  it.each(LEVELS)(
    'java/maven %s: build-reactor is in ci-required _ciNeeds (RT-06)',
    (governanceLevel) => {
      const rendered = renderPrFast({ language: 'java', buildTool: 'maven', governanceLevel })
      expect(rendered).toMatch(/needs:.*\bbuild-reactor\b/)
    },
  )

  it.each(LEVELS)('java/gradle %s: no build-reactor job', (governanceLevel) => {
    const rendered = renderPrFast({ language: 'java', buildTool: 'gradle', governanceLevel })
    expect(rendered).not.toContain('build-reactor:')
  })

  it.each(LEVELS)(
    'java/gradle %s: still uses setup-java-maven composite (not inline setup-java)',
    (governanceLevel) => {
      const rendered = renderPrFast({ language: 'java', buildTool: 'gradle', governanceLevel })
      expect(rendered).toContain('uses: ./.github/actions/setup-java-maven')
      expect(rendered).not.toContain(SETUP_JAVA_SHA_PR_FAST)
    },
  )
})

// ─── Phase 3: 02-pr-extended reactor job (CANON-18 L1-L4) ────────────────────

describe('02-pr-extended.yml.ejs — Java Maven reactor (CANON-18, #1226)', () => {
  it.each(LEVELS)('java/maven %s: build-reactor job present', (governanceLevel) => {
    const rendered = renderPrExtended({ language: 'java', buildTool: 'maven', governanceLevel })
    expect(rendered).toContain('build-reactor:')
  })

  it.each(LEVELS)(
    'java/maven %s: uses setup-java-maven composite (not inline setup-java)',
    (governanceLevel) => {
      const rendered = renderPrExtended({ language: 'java', buildTool: 'maven', governanceLevel })
      expect(rendered).toContain('uses: ./.github/actions/setup-java-maven')
      expect(rendered).not.toContain(SETUP_JAVA_SHA_PR_FAST)
    },
  )

  it.each(LEVELS)('java/gradle %s: no build-reactor in extended', (governanceLevel) => {
    const rendered = renderPrExtended({ language: 'java', buildTool: 'gradle', governanceLevel })
    expect(rendered).not.toContain('build-reactor:')
  })
})

// ─── Phase 3: 05-release reactor (CANON-18 L1-L4 + CANON-19 archetypes) ──────

describe('05-release.yml.ejs — Java Maven reactor (CANON-18/19, #1226)', () => {
  it.each(LEVELS)(
    'java/maven %s: uses setup-java-maven composite (not inline setup-java)',
    (governanceLevel) => {
      const rendered = renderRelease({ language: 'java', buildTool: 'maven', governanceLevel })
      expect(rendered).toContain('uses: ./.github/actions/setup-java-maven')
      expect(rendered).not.toContain(SETUP_JAVA_SHA_RELEASE)
    },
  )

  it.each(['library', 'backend-web-db', 'cli', 'data-pipeline'] as const)(
    'java/maven %s archetype: 05-release uses setup-java-maven composite (CANON-19)',
    (archetype) => {
      const rendered = renderRelease({ language: 'java', buildTool: 'maven', archetype })
      expect(rendered).toContain('uses: ./.github/actions/setup-java-maven')
      expect(rendered).not.toContain(SETUP_JAVA_SHA_RELEASE)
    },
  )
})
