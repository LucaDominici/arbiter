// Tests for #358 — ephemeral-server runner template (Phase 7F, CANON-02, CANON-15).
//
// Verifies that scripts/lib/ephemeral-server.mjs.ejs renders a self-contained
// Node CLI used by integration/e2e gate steps to start a server, wait for
// readiness, run a downstream test command, and tear the server down on exit.
// The runner's call shape (CLI flags) is the contract that #348 wires from
// check-all.mjs.ejs — keep this contract stable.

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('scripts/lib/ephemeral-server.mjs.ejs — runner contract (#358)', () => {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    archetype: 'frontend-spa',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>

  it('emits a node shebang and ESM imports for spawn/net', () => {
    const out = renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data)
    expect(out.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(out).toContain("from 'node:child_process'")
    expect(out).toContain("from 'node:net'")
  })

  it('parses --start / --test / --port / --ready-timeout flags', () => {
    const out = renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data)
    expect(out).toContain('--start')
    expect(out).toContain('--test')
    expect(out).toContain('--port')
    expect(out).toContain('--ready-timeout')
  })

  it('spawns the server command via shell and tracks the child pid', () => {
    const out = renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data)
    expect(out).toContain('spawn(')
    expect(out).toMatch(/shell:\s*true/)
    expect(out).toContain('serverProcess')
  })

  it('polls TCP readiness on the requested port before invoking the test command', () => {
    const out = renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data)
    expect(out).toContain('net.createConnection')
    expect(out).toMatch(/waitForPort|waitForReady/)
  })

  it('runs the downstream test command only after readiness succeeds', () => {
    const out = renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data)
    expect(out).toContain('spawnSync(')
    expect(out).toMatch(/testStatus|testExit|testResult/)
  })

  it('always tears down the server (SIGTERM) in a finally / exit handler', () => {
    const out = renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data)
    expect(out).toContain('SIGTERM')
    expect(out).toMatch(/finally|teardown|cleanup/)
  })

  it('propagates the test command exit code as its own exit code', () => {
    const out = renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data)
    expect(out).toMatch(/process\.exit\(/)
  })

  it('cites #358 and CANON-02 in the header comment', () => {
    const out = renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data)
    expect(out).toContain('#358')
    expect(out).toContain('CANON-02')
  })
})

describe('generateCheckAll — emits ephemeral-server runner alongside helpers (#358)', () => {
  it('TS frontend-spa L2 emits scripts/lib/ephemeral-server.mjs', async () => {
    const { generateCheckAll } = await import('../../src/generators/check-all.js')
    const cfg = makeConfig('/tmp/arbiter-ephemeral-test-tsfe', {
      language: 'typescript',
      archetype: 'frontend-spa',
      governanceLevel: 'L2',
    })
    const result = generateCheckAll(cfg)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/lib/ephemeral-server.mjs'))).toBe(true)
  })

  it('TS backend-web-db L2 emits scripts/lib/ephemeral-server.mjs', async () => {
    const { generateCheckAll } = await import('../../src/generators/check-all.js')
    const cfg = makeConfig('/tmp/arbiter-ephemeral-test-tsbe', {
      language: 'typescript',
      archetype: 'backend-web-db',
      governanceLevel: 'L2',
    })
    const result = generateCheckAll(cfg)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/lib/ephemeral-server.mjs'))).toBe(true)
  })

  it('Python backend-web L2 emits scripts/lib/ephemeral-server.mjs', async () => {
    const { generateCheckAll } = await import('../../src/generators/check-all.js')
    const cfg = makeConfig('/tmp/arbiter-ephemeral-test-py', {
      language: 'python',
      archetype: 'backend-web-db',
      governanceLevel: 'L2',
    })
    const result = generateCheckAll(cfg)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/lib/ephemeral-server.mjs'))).toBe(true)
  })

  it('TS library L2 does NOT emit scripts/lib/ephemeral-server.mjs', async () => {
    const { generateCheckAll } = await import('../../src/generators/check-all.js')
    const cfg = makeConfig('/tmp/arbiter-ephemeral-test-lib', {
      language: 'typescript',
      archetype: 'library',
      governanceLevel: 'L2',
    })
    const result = generateCheckAll(cfg)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/lib/ephemeral-server.mjs'))).toBe(false)
  })

  it('TS frontend-spa L1 does NOT emit scripts/lib/ephemeral-server.mjs (L1 skips e2e)', async () => {
    const { generateCheckAll } = await import('../../src/generators/check-all.js')
    const cfg = makeConfig('/tmp/arbiter-ephemeral-test-l1', {
      language: 'typescript',
      archetype: 'frontend-spa',
      governanceLevel: 'L1',
    })
    const result = generateCheckAll(cfg)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/lib/ephemeral-server.mjs'))).toBe(false)
  })
})
