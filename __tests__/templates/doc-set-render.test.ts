// SPDX-License-Identifier: Apache-2.0
// CANON-04: render test for src/templates/scripts/check-doc-set.mjs.ejs (#1428, INV-135).
// This file satisfies the check-template-tests.mjs ratchet for scripts/check-doc-set.mjs.ejs.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('scripts/check-doc-set.mjs.ejs render (CANON-04, #1428)', () => {
  it('renders without error and delegates to `arbiter doc-set`', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-doc-set.mjs.ejs', config)
    expect(content.trim().length).toBeGreaterThan(0)
    expect(content).toContain('arbiter')
    expect(content).toContain('doc-set')
    expect(content).toContain('--no-install')
  })

  it('rendered output starts with shebang', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-doc-set.mjs.ejs', config)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env node')
  })

  it('rendered output contains SPDX header', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-doc-set.mjs.ejs', config)
    expect(content).toContain('SPDX-License-Identifier: Apache-2.0')
  })
})

// T4 (gold-doc-tranches-t3-t5.md §2.3): scripts/check-doc-freshness.mjs.ejs — the freshness
// thin runner, same shape as check-doc-set.mjs.ejs above (INV-135, check-template-tests.mjs ratchet).
describe('scripts/check-doc-freshness.mjs.ejs render (T4)', () => {
  it('renders without error and delegates to `arbiter doc-set --freshness`', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-doc-freshness.mjs.ejs', config)
    expect(content.trim().length).toBeGreaterThan(0)
    expect(content).toContain('arbiter')
    expect(content).toContain('doc-set')
    expect(content).toContain('--freshness')
    expect(content).toContain('--no-install')
  })

  it('rendered output starts with shebang', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-doc-freshness.mjs.ejs', config)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env node')
  })

  it('rendered output contains SPDX header', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-doc-freshness.mjs.ejs', config)
    expect(content).toContain('SPDX-License-Identifier: Apache-2.0')
  })

  it('rendered output passes node --check (syntax-valid JS)', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-doc-freshness.mjs.ejs', config)
    const dir = mkdtempSync(join(tmpdir(), 'doc-freshness-render-check-'))
    try {
      const scriptPath = join(dir, 'check-doc-freshness-render-check.mjs')
      writeFileSync(scriptPath, content)
      const r = spawnSync('node', ['--check', scriptPath], { encoding: 'utf-8' })
      expect(r.status, `node --check failed:\n${r.stderr}`).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
