// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-no-raw-strings.mjs')

function runScanner(
  srcDir: string,
  inventoryPath?: string,
): { status: number; stdout: string; stderr: string } {
  const args = inventoryPath ? [SCRIPT, srcDir, '--inventory', inventoryPath] : [SCRIPT, srcDir]
  const result = spawnSync('node', args, { encoding: 'utf-8', cwd: resolve('.') })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'raw-strings-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-no-raw-strings scanner (#656)', () => {
  it('exits 0 when no raw strings found', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'clean.ts'),
        [
          'import { t } from "../i18n/index.js"',
          'export function greet() { console.log(t("cli.shared.done")) }',
        ].join('\n'),
      )
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when raw console.log literal found', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.ts'), 'console.log("raw string here")\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('bad.ts')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when raw console.error literal found', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.ts'), 'console.error("something went wrong")\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when raw throw new ArbiterError found', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.ts'), 'throw new ArbiterError("E_BAD", "raw message here")\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('accepts a UserFacingError message resolved through t()', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'ok.ts'),
        'throw new UserFacingError(t("cli.doctor.recover_lock.refused"))\n',
      )
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when call-site is in inventory allowlist', () => {
    const { dir, cleanup } = makeDir()
    try {
      const file = join(dir, 'allowed.ts')
      writeFileSync(file, 'console.log("intentional dev-only output")\n')
      const inventoryPath = join(dir, 'inventory.json')
      writeFileSync(
        inventoryPath,
        JSON.stringify([{ file: 'allowed.ts', line: 1, justification: 'dev-only debug output' }]),
      )
      const result = runScanner(dir, inventoryPath)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when some call-sites are allowlisted but others are not', () => {
    const { dir, cleanup } = makeDir()
    try {
      const file = join(dir, 'mixed.ts')
      writeFileSync(
        file,
        ['console.log("allowed")', 'console.warn("not allowed")'].join('\n') + '\n',
      )
      const inventoryPath = join(dir, 'inventory.json')
      writeFileSync(
        inventoryPath,
        JSON.stringify([{ file: 'mixed.ts', line: 1, justification: 'allowed' }]),
      )
      const result = runScanner(dir, inventoryPath)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('ignores template literal passed to t()', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'ok.ts'),
        'import { t } from "../i18n/index.js"\nconsole.log(t(`cli.shared.done`))\n',
      )
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores .d.ts files', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'types.d.ts'), 'console.log("should be ignored")\n')
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
