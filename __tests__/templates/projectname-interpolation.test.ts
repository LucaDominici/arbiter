// SPDX-License-Identifier: Apache-2.0
// Wave-E #1550: projectName (= directory basename) is interpolated into generated
// JSON / .properties / TOML config files. Two defenses are exercised here:
//   1. Boundary slugify — slugifyProjectName() strips every metacharacter at the
//      config boundary (init/update/diff) so the value is structurally inert.
//   2. Defense-in-depth — even fed a hostile name directly, each template must emit
//      a STRUCTURALLY VALID and CONTENT-FAITHFUL file (JSON.parse / parseToml round-trip,
//      no HTML-entity corruption like `R&amp;D`).
import { describe, it, expect } from 'vitest'
import { parse as parseToml } from 'smol-toml'
import { renderTemplate } from '../../src/utils/render.js'
import { slugifyProjectName } from '../../src/commands/init.js'
import { makeConfig } from '../helpers.js'

// A name carrying JSON-structural (`"`, `\`), HTML-meta (`&`, `<`, `>`) and shell
// metacharacters — the exact class the audit flagged.
const HOSTILE = 'R&D "x" <y>'

function render(tpl: string, projectName: string): string {
  const cfg = makeConfig('/tmp/projname-render', { projectName }) as unknown as Record<
    string,
    unknown
  >
  return renderTemplate(tpl, cfg)
}

describe('#1550 slugifyProjectName — config-boundary normalization', () => {
  it('strips JSON/HTML/shell metacharacters down to a safe slug', () => {
    expect(slugifyProjectName(HOSTILE)).toBe('R-D-x-y')
  })

  it('collapses runs of disallowed chars and trims leading/trailing separators', () => {
    expect(slugifyProjectName('  @@my project!! ')).toBe('my-project')
  })

  it('preserves already-safe names (dot/underscore/dash allowed)', () => {
    expect(slugifyProjectName('my_service.v2-beta')).toBe('my_service.v2-beta')
  })

  it('falls back to "app" when nothing survives normalization', () => {
    expect(slugifyProjectName('@@@')).toBe('app')
    expect(slugifyProjectName('')).toBe('app')
  })

  it('a slugified name is inert through every emitter (round-trip property)', () => {
    const safe = slugifyProjectName(HOSTILE)
    expect(() => JSON.parse(render('claude/knowledge-map.json.ejs', safe))).not.toThrow()
    expect(JSON.parse(render('claude/knowledge-map.json.ejs', safe)).project).toBe(safe)
  })
})

describe('#1550 JSON config templates survive a hostile projectName', () => {
  it('knowledge-map.json.ejs emits valid JSON with the faithful name', () => {
    const out = render('claude/knowledge-map.json.ejs', HOSTILE)
    const parsed = JSON.parse(out)
    expect(parsed.project).toBe(HOSTILE)
  })

  it('postman.collection.json.ejs emits valid JSON', () => {
    const out = render('api-e2e/postman.collection.json.ejs', HOSTILE)
    const parsed = JSON.parse(out)
    expect(parsed.info.name).toBe(`${HOSTILE} live API e2e (INV-126)`)
  })

  it('openapi-baseline.json.ejs emits valid, uncorrupted JSON', () => {
    const out = render('contract-testing/api-snapshots/openapi-baseline.json.ejs', HOSTILE)
    const parsed = JSON.parse(out)
    expect(parsed.info.title).toBe(HOSTILE)
    expect(parsed.info.description).toBe(`${HOSTILE} API`)
  })

  it('bundle-budget.json.ejs emits valid, uncorrupted JSON', () => {
    const out = render('perf/bundle-budget.json.ejs', HOSTILE)
    const parsed = JSON.parse(out)
    expect(parsed.$description).toContain(HOSTILE)
  })

  it('design-tokens.json.ejs emits valid, uncorrupted JSON', () => {
    const out = render('frontend/design-tokens.json.ejs', HOSTILE)
    const parsed = JSON.parse(out)
    expect(parsed.$description).toContain(HOSTILE)
  })

  it('suppressions-schema.json.ejs emits valid, uncorrupted JSON', () => {
    const out = render('suppressions/suppressions-schema.json.ejs', HOSTILE)
    const parsed = JSON.parse(out)
    expect(parsed.title).toBe(`${HOSTILE} Suppression Entry`)
  })

  it('regulated/overlay.json.ejs emits valid, uncorrupted JSON', () => {
    const out = render('regulated/overlay.json.ejs', HOSTILE)
    const parsed = JSON.parse(out)
    expect(parsed.$comment).toContain(HOSTILE)
  })
})

describe('#1550 properties config template survives a hostile projectName', () => {
  it('sonar-project.properties.ejs emits the raw (un-HTML-escaped) name', () => {
    const out = render('sonar-project.properties.ejs', HOSTILE)
    expect(out).toContain(`sonar.projectName=${HOSTILE}`)
    expect(out).not.toContain('&amp;')
  })
})

describe('#1550 shell config templates survive a hostile projectName', () => {
  it('evidence-writer.sh.ejs banner comment is not HTML-corrupted', () => {
    const out = render('scripts/evidence-writer.sh.ejs', HOSTILE)
    expect(out).toContain(`# ${HOSTILE} — TDD evidence writer`)
    expect(out).not.toContain('&amp;')
  })

  it('run-postman-tests.sh.ejs slugifies the collection filename inline', () => {
    const out = render('scripts/run-postman-tests.sh.ejs', HOSTILE)
    // The inline slug collapses every metacharacter — no shell-meta survives.
    expect(out).toMatch(/postman\/[a-z0-9_-]+\.postman_collection\.json/)
    expect(out).not.toMatch(/postman\/[a-z0-9_-]*["&<> ]/)
  })
})

describe('#1550 TOML config templates survive a hostile projectName', () => {
  it.each(['static-analysis/ruff.toml.ejs', 'security/gitleaks.toml.ejs'])(
    '%s round-trips through a TOML parser with the faithful name',
    (tpl) => {
      const out = render(tpl, HOSTILE)
      expect(() => parseToml(out)).not.toThrow()
      expect(out).toContain(HOSTILE)
      expect(out).not.toContain('&amp;')
    },
  )
})
