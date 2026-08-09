// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../../../src/utils/render.js'
import { makeConfig } from '../../../helpers.js'

function render(template: string, overrides: Record<string, unknown>): string {
  return renderTemplate(
    template,
    makeConfig('/tmp/non-ts-node-tooling', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

function expectBareNodeSetup(output: string): void {
  expect(output).toContain("node-version: '22'")
  expect(output).toContain('package-manager-cache: false')
  expect(output).not.toContain('node-version-file: .nvmrc')
  expect(output).not.toContain("node-version-file: '.nvmrc'")
}

describe('non-TypeScript workflow Node tooling (#2259)', () => {
  it.each([
    ['github/actions/setup-node-pnpm/action.yml.ejs', { language: 'python', buildTool: 'pip' }],
    ['github/workflows/01-pr-fast.yml.ejs', { language: 'python', buildTool: 'pip' }],
    ['github/workflows/04-deploy-test.yml.ejs', { language: 'kotlin', buildTool: 'gradle' }],
    ['github/workflows/_contract-postman.yml.ejs', { language: 'java', buildTool: 'gradle' }],
    ['github/workflows/_monthly.yml.ejs', { language: 'python', buildTool: 'pip' }],
    ['github/workflows/_nightly.yml.ejs', { language: 'python', buildTool: 'pip' }],
    [
      'github/workflows/16-frontend-quality.yml.ejs',
      { language: 'python', archetype: 'frontend-spa', buildTool: 'pip' },
    ],
    [
      'github/workflows/18-frontend-lane.yml.ejs',
      { language: 'go', archetype: 'library', lanes: ['frontend'], buildTool: 'go' },
    ],
  ])('%s has a Node setup path independent of a root lockfile', (template, overrides) => {
    expectBareNodeSetup(render(template, overrides))
  })
})
