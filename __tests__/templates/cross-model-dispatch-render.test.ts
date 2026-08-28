// SPDX-License-Identifier: Apache-2.0
// #2358 — source/template twins and advisory registry wiring.
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { loadGateRegistry } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

describe('cross-model dispatch templates (#2358)', () => {
  it('renders the checker, schema, and L2 advisory gate', () => {
    const checker = renderTemplate('scripts/check-cross-model-review.mjs.ejs', {})
    const schema = renderTemplate('scripts/schemas/cross-model-dispatch.schema.json.ejs', {})
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
