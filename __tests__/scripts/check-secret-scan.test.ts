// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-secret-scan.mjs')

// Detection fixtures are built at runtime so no scannable secret literal ever
// appears verbatim in committed source (gitleaks/secret-scan scan this file).
// The split boundary sits inside the minimal token each detector keys on.
const AWS_KEY = 'AK' + 'IA1234567890ABCDEF'
const GH_CLASSIC = 'ghp' + '_abcdefghijklmnopqrstuvwxyz0123456789'
const GH_PAT =
  'github_' +
  'pat_abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghij'

function run(dir: string) {
  const r = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-secret-scan.mjs (secret pattern drift checker, INV-89)', () => {
  it('exits 0 when no secret patterns are present', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'clean.ts'), 'export const apiKey = "safe-config"\n')
      writeFileSync(join(dir, 'good.js'), 'const token = "placeholder"\n')
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an AWS access key (AKIA) is detected', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.ts'), `const key = "${AWS_KEY}"\n`)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('potential AWS Access Key found')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a GitHub classic token (ghp_) is detected', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'token.ts'), `const token = "${GH_CLASSIC}"\n`)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('potential GitHub Token')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a GitHub fine-grained personal access token is detected', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'pat.json'), `{"token": "${GH_PAT}"}\n`)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('potential GitHub Token')
    } finally {
      cleanup()
    }
  })

  it('exits 0 with empty directory (no files to scan)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'sub'))
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores files in __tests__ directory', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '__tests__'))
      // Even though this contains a secret, it should be ignored
      writeFileSync(join(dir, '__tests__', 'fixture.ts'), `const key = "${AWS_KEY}"\n`)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores files in /fixtures/ directory', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'fixtures'))
      writeFileSync(join(dir, 'fixtures', 'dummy.ts'), `const key = "${AWS_KEY}"\n`)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('scans .yaml files and detects secrets', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'config.yaml'), `secret: ${GH_CLASSIC}\n`)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('GitHub Token')
    } finally {
      cleanup()
    }
  })

  it('ignores files not in SCANNED_EXTENSIONS', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'secrets.txt'), `const key = "${AWS_KEY}"\n`)
      writeFileSync(join(dir, 'README.md'), `AWS Key: ${AWS_KEY}`)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores .gitleaksignore and pii-allowlist.json files', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, '.gitleaksignore'), `${AWS_KEY}\n`)
      writeFileSync(join(dir, 'pii-allowlist.json'), `{"key": "${AWS_KEY}"}`)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores node_modules, .git, dist, build, coverage directories', () => {
    const { dir, cleanup } = makeDir()
    try {
      for (const ignored of ['node_modules', '.git', 'dist', 'build', 'coverage']) {
        mkdirSync(join(dir, ignored))
        writeFileSync(join(dir, ignored, 'secret.js'), `const token = "${GH_CLASSIC}"\n`)
      }
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
