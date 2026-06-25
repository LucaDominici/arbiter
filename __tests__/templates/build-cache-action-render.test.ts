// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { load as parseYaml } from 'js-yaml'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// C3 (#1497) — parametric build-cache composite action render test.
function render(overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    'github/actions/build-cache/action.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

const CASES = [
  {
    language: 'typescript',
    buildTool: 'npm',
    strategy: 'node-workspace',
    buildRe: /npm run build/,
  },
  {
    language: 'python',
    buildTool: 'pip',
    strategy: 'python-wheel',
    buildRe: /python -m build --wheel/,
  },
  {
    language: 'java',
    buildTool: 'maven',
    strategy: 'maven-reactor',
    buildRe: /mvn --batch-mode -DskipTests install/,
  },
  { language: 'java', buildTool: 'gradle', strategy: 'gradle', buildRe: /\.\/gradlew assemble/ },
] as const

describe('build-cache/action.yml.ejs — parametric strategy', () => {
  it.each(CASES)(
    '$language/$buildTool renders the $strategy strategy',
    ({ language, buildTool, strategy, buildRe }) => {
      const out = render({ language, buildTool })
      expect(out).toContain(`name: Build cache (${strategy})`)
      expect(out).toMatch(buildRe)
    },
  )

  it.each(CASES)(
    '$strategy uses an immutable run-id artifact key',
    ({ language, buildTool, strategy }) => {
      const out = render({ language, buildTool })
      expect(out).toContain(`build-cache-${strategy}-\${{ github.run_id }}`)
    },
  )

  it.each(CASES)(
    '$strategy has a non-blocking restore with a gated rebuild fallback',
    ({ language, buildTool }) => {
      const out = render({ language, buildTool })
      // download failure is swallowed → non-blocking
      expect(out).toContain('2>/dev/null')
      expect(out).toContain('restored=false')
      // rebuild fallback exists and is gated on the restore having missed
      expect(out).toContain('Rebuild fallback')
      expect(out).toMatch(/steps\.build-cache-restore\.outputs\.restored != 'true'/)
    },
  )

  it.each(CASES)('$strategy renders to valid composite-action YAML', ({ language, buildTool }) => {
    const out = render({ language, buildTool })
    const doc = parseYaml(out) as { runs?: { using?: string; steps?: unknown[] } }
    expect(doc.runs?.using).toBe('composite')
    expect(Array.isArray(doc.runs?.steps)).toBe(true)
    expect((doc.runs?.steps ?? []).length).toBeGreaterThanOrEqual(5)
  })
})
