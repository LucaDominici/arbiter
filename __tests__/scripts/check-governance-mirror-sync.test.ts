// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-governance-mirror-sync.mjs')

function run(dir: string) {
  const r = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf-8' })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'governance-mirror-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-governance-mirror-sync.mjs (governance mirror drift, #1805)', () => {
  it('exits 0 when mirror matches AGENTS.md byte-for-byte', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'website', 'governance'), { recursive: true })
      const content = '# AGENTS\n\n## Iron Laws\n\nsome content\n'
      writeFileSync(join(dir, 'AGENTS.md'), content)
      writeFileSync(join(dir, 'website', 'governance', 'AGENTS.md'), content)
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when mirror is stale vs AGENTS.md', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'website', 'governance'), { recursive: true })
      writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS\n\n## Iron Laws\n\nnew content\n')
      writeFileSync(join(dir, 'website', 'governance', 'AGENTS.md'), '# AGENTS\n\nold content\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('stale')
      expect(result.stderr).toContain('#1805')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when mirror file is missing entirely', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'website', 'governance'), { recursive: true })
      writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('missing')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when AGENTS.md does not exist (bootstrap SKIP)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })
})
