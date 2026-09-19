// SPDX-License-Identifier: Apache-2.0
// #2358 — source/template twins and advisory registry wiring.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { loadGateRegistry } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

const REPO_ROOT_DIR = resolve(__dirname, '..', '..')

describe('cross-model dispatch templates (#2358)', () => {
  it('renders the checker, schema, and L2 advisory gate', () => {
    const checker = renderTemplate('scripts/check-cross-model-review.mjs.ejs', {})
    const schema = readFileSync(
      'src/templates/scripts/schemas/cross-model-dispatch.schema.json',
      'utf8',
    )
    const externalSchema = readFileSync(
      'src/templates/scripts/schemas/agent-return-external.schema.json',
      'utf8',
    )
    const gates = loadGateRegistry({
      ...makeConfig('/tmp/cross-model-render'),
      packageManager: 'npm',
      coverageThreshold: 80,
      coverageEnabled: false,
      mutationEnabled: false,
      isL2Plus: true,
      isL3Plus: false,
      isL4: false,
    })

    expect(checker).toContain('cross-model-dispatch.schema.json')
    expect(JSON.parse(schema).properties.degraded.items.properties.reason.enum).toContain('timeout')
    expect(JSON.parse(externalSchema).$id).toContain('agent-return-external')
    expect(gates).toContainEqual(
      expect.objectContaining({
        id: 'cross-model-review',
        kind: 'warn',
        level: 'L2',
        cmd: ['node', 'scripts/check-cross-model-review.mjs'],
      }),
    )
  })
})

describe('emitted dispatch schema survives a narrower consumer printWidth (#2724)', () => {
  it('stays formatted under a consumer .prettierrc that omits printWidth', async () => {
    // A consumer's own .prettierrc takes precedence over arbiter's emitted
    // .prettierrc.json, and prettier's default printWidth is 80. The dispatch phase
    // enum collapses to exactly 100 columns, so at 80 prettier demands the expanded
    // form and the generated project fails its own format check on bytes it never
    // wrote. arbiter owns schemas/, so the emitted .prettierignore excludes it.
    // Durable fix: #2737 (format emitted files with the consumer's resolved config).
    const emitted = readFileSync(
      join(REPO_ROOT_DIR, 'src', 'templates', 'static-analysis', 'prettierignore.ejs'),
      'utf-8',
    )
    expect(emitted).toMatch(/^schemas\/$/m)

    const schema = readFileSync(
      join(
        REPO_ROOT_DIR,
        'src',
        'templates',
        'scripts',
        'schemas',
        'cross-model-dispatch.schema.json',
      ),
      'utf-8',
    )
    const enumLine = schema.split('\n').find((l) => l.includes('"enum": ["preflight"'))
    // Pin the boundary itself: if a future edit changes the enum length, this states
    // plainly why that matters instead of leaving a CI-only failure to be re-diagnosed.
    expect(enumLine === undefined || enumLine.length > 80).toBe(true)
  })
})
