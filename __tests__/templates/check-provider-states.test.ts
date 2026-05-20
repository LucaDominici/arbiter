// SPDX-License-Identifier: Apache-2.0
// Port #12 (#972): contract gate for the scaffolded provider-state checker.
//
// The template renders to a stand-alone Node script that walks Pact contracts
// under `contract-testing/pact-samples/contracts/` and asserts every declared
// providerState (v2 string or v3+ `providerStates[].name`) has a matching
// fixture under `contract-testing/pact-samples/states/<slug>.fixture.<ext>`.
//
// This suite renders the template, materialises it next to a temp-dir fixture
// (2 contracts × 1 matching + 1 orphan state), runs it, and asserts the
// non-zero exit + orphan slug surfacing on stderr.

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const TEMPLATE = 'contract-testing/scripts/check-provider-states.mjs.ejs'

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

function makeData(overrides: Record<string, unknown> = {}) {
  return makeConfig('/tmp/check-states-test', {
    language: 'typescript',
    projectName: 'my-service',
    governanceLevel: 'L2',
    contractType: 'rest-owned',
    hasPublicApi: true,
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
}

function setupTmpProject(): { root: string; scriptPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'provider-states-'))
  mkdirSync(join(root, 'contract-testing', 'pact-samples', 'contracts'), { recursive: true })
  mkdirSync(join(root, 'contract-testing', 'pact-samples', 'states'), { recursive: true })
  // Render and write the script — exercises the template, not a pre-baked copy.
  const rendered = renderTemplate(TEMPLATE, makeData())
  const scriptPath = join(root, 'contract-testing', 'scripts', 'check-provider-states.mjs')
  mkdirSync(join(root, 'contract-testing', 'scripts'), { recursive: true })
  writeFileSync(scriptPath, rendered, 'utf-8')
  return { root, scriptPath, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function runScript(scriptPath: string, root: string): RunResult {
  const result = spawnSync('node', [scriptPath], {
    encoding: 'utf-8',
    cwd: root,
    env: { ...process.env, PROVIDER_STATES_ROOT: root },
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('check-provider-states.mjs.ejs — scaffolded gate (Port #12, #972)', () => {
  it('renders without EJS errors and writes a #!/usr/bin/env node script', () => {
    const out = renderTemplate(TEMPLATE, makeData())
    expect(out.startsWith('#!/usr/bin/env node\n')).toBe(true)
    expect(out).toContain('providerState')
    expect(out).toContain('providerStates')
  })

  it('exits 0 when no contracts directory exists (skip path)', () => {
    const root = mkdtempSync(join(tmpdir(), 'provider-states-empty-'))
    try {
      const scriptPath = join(root, 'check.mjs')
      writeFileSync(scriptPath, renderTemplate(TEMPLATE, makeData()), 'utf-8')
      const r = runScript(scriptPath, root)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('no contracts directory')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('exits 0 when every declared state has a matching fixture', () => {
    const { root, scriptPath, cleanup } = setupTmpProject()
    try {
      writeFileSync(
        join(root, 'contract-testing', 'pact-samples', 'contracts', 'consumer-a.json'),
        JSON.stringify({
          interactions: [
            { providerState: 'user_has_active_trip', description: 'gets trip' },
            { providerStates: [{ name: 'inventory_is_empty' }], description: 'lists empty' },
          ],
        }),
      )
      writeFileSync(
        join(root, 'contract-testing', 'pact-samples', 'states', 'user_has_active_trip.fixture.ts'),
        '// fixture\n',
      )
      writeFileSync(
        join(root, 'contract-testing', 'pact-samples', 'states', 'inventory_is_empty.fixture.ts'),
        '// fixture\n',
      )
      const r = runScript(scriptPath, root)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('all have fixtures')
    } finally {
      cleanup()
    }
  })

  it('exits 1 and names the orphan state on stderr (2 contracts × 1 match + 1 orphan)', () => {
    const { root, scriptPath, cleanup } = setupTmpProject()
    try {
      // Contract A: declares user_has_active_trip (matched by fixture below)
      writeFileSync(
        join(root, 'contract-testing', 'pact-samples', 'contracts', 'consumer-a.json'),
        JSON.stringify({
          interactions: [{ providerState: 'user_has_active_trip', description: 'gets trip' }],
        }),
      )
      // Contract B: declares auth_token_expired (orphan — no fixture)
      writeFileSync(
        join(root, 'contract-testing', 'pact-samples', 'contracts', 'consumer-b.json'),
        JSON.stringify({
          interactions: [
            {
              providerStates: [{ name: 'auth_token_expired', params: { ttl: 0 } }],
              description: 'rejects expired',
            },
          ],
        }),
      )
      // Only the matching fixture is present.
      writeFileSync(
        join(root, 'contract-testing', 'pact-samples', 'states', 'user_has_active_trip.fixture.ts'),
        '// fixture\n',
      )
      const r = runScript(scriptPath, root)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('auth_token_expired')
      // The matched state must NOT be reported as orphan.
      expect(r.stderr).not.toContain('user_has_active_trip (expected')
    } finally {
      cleanup()
    }
  })

  it('accepts fixtures under any of the supported extensions (.py)', () => {
    const { root, scriptPath, cleanup } = setupTmpProject()
    try {
      writeFileSync(
        join(root, 'contract-testing', 'pact-samples', 'contracts', 'consumer.json'),
        JSON.stringify({
          interactions: [{ providerState: 'inventory_is_empty' }],
        }),
      )
      writeFileSync(
        join(root, 'contract-testing', 'pact-samples', 'states', 'inventory_is_empty.fixture.py'),
        '# fixture\n',
      )
      const r = runScript(scriptPath, root)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('flags slugs that violate the snake_case naming rule', () => {
    const { root, scriptPath, cleanup } = setupTmpProject()
    try {
      writeFileSync(
        join(root, 'contract-testing', 'pact-samples', 'contracts', 'consumer.json'),
        JSON.stringify({
          interactions: [{ providerState: 'UserHasActiveTrip' }],
        }),
      )
      // No fixture either — still triggers both checks; we only assert the slug-rule mention.
      const r = runScript(scriptPath, root)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('naming rule')
      expect(r.stderr).toContain('UserHasActiveTrip')
    } finally {
      cleanup()
    }
  })

  it('exits 2 on invalid JSON contract', () => {
    const { root, scriptPath, cleanup } = setupTmpProject()
    try {
      writeFileSync(
        join(root, 'contract-testing', 'pact-samples', 'contracts', 'broken.json'),
        '{ this is not json',
      )
      const r = runScript(scriptPath, root)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('invalid JSON')
    } finally {
      cleanup()
    }
  })
})
