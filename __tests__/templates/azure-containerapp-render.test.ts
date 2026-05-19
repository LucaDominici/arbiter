// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for infra/azure/containerapp.tpl.yaml.ejs
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderContainerApp(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'infra/azure/containerapp.tpl.yaml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── Structural invariants (CANON-04) ─────────────────────────────────────────

describe('infra/azure/containerapp.tpl.yaml.ejs — structural invariants (CANON-04)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'maven' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: rendered output is non-empty YAML', ({ language, buildTool }) => {
    const rendered = renderContainerApp({ language, buildTool })
    expect(rendered.trim().length).toBeGreaterThan(0)
  })

  it.each(STACKS)(
    '$language: contains CONTAINER_APP_NAME placeholder',
    ({ language, buildTool }) => {
      const rendered = renderContainerApp({ language, buildTool })
      expect(rendered).toContain('CONTAINER_APP_NAME')
    },
  )

  it.each(STACKS)('$language: contains RESOURCE_GROUP placeholder', ({ language, buildTool }) => {
    const rendered = renderContainerApp({ language, buildTool })
    expect(rendered).toContain('RESOURCE_GROUP')
  })

  it.each(STACKS)('$language: contains image field', ({ language, buildTool }) => {
    const rendered = renderContainerApp({ language, buildTool })
    expect(rendered).toContain('image')
  })

  it.each(STACKS)('$language: contains environment field', ({ language, buildTool }) => {
    const rendered = renderContainerApp({ language, buildTool })
    expect(rendered).toContain('environment')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderContainerApp({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it.each(LEVELS)('governance %s: projectName interpolated', (level) => {
    const rendered = renderContainerApp({ governanceLevel: level, projectName: 'my-app' })
    expect(rendered).toContain('my-app')
  })
})

// ─── .tpl.yaml semantics: ${VAR} placeholders survive EJS render ──────────────

describe('infra/azure/containerapp.tpl.yaml.ejs — .tpl.yaml placeholder invariants', () => {
  it('rendered output preserves at least one ${...} envsubst placeholder', () => {
    const rendered = renderContainerApp({})
    // The .tpl.yaml convention means the file is an envsubst template at deploy time.
    // At least one ${VAR} placeholder must survive the EJS render pass.
    expect(rendered).toMatch(/\$\{[A-Z_]+\}/)
  })

  it('REGISTRY_IMAGE placeholder present for container image substitution', () => {
    const rendered = renderContainerApp({})
    expect(rendered).toContain('${REGISTRY_IMAGE}')
  })
})

// ─── SCAFFOLD guard ───────────────────────────────────────────────────────────

describe('infra/azure/containerapp.tpl.yaml.ejs — SCAFFOLD guard', () => {
  it('SCAFFOLD comment present so operators know the file is a starting point', () => {
    const rendered = renderContainerApp({})
    expect(rendered).toContain('SCAFFOLD')
  })
})
