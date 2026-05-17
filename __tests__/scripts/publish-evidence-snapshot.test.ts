// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/publish-evidence-snapshot.mjs')
const CANARY = resolve('__tests__/fixtures/evidence-pii-canary.txt')

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: resolve('.') })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-snapshot-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('publish-evidence-snapshot (#653)', () => {
  it('exits 0 and produces output for clean input', () => {
    const { dir, cleanup } = makeDir()
    try {
      const inputDir = join(dir, 'evidence')
      mkdirSync(inputDir)
      writeFileSync(join(inputDir, 'report.md'), '# Gate result\n\nAll checks passed.\n')
      const outDir = join(dir, 'snapshot')
      const result = run(['--input', inputDir, '--output', outDir])
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('scrubs email addresses from output', () => {
    const { dir, cleanup } = makeDir()
    try {
      const inputDir = join(dir, 'evidence')
      mkdirSync(inputDir)
      writeFileSync(join(inputDir, 'log.txt'), 'contact: alice@example.com for support\n')
      const outDir = join(dir, 'snapshot')
      const result = run(['--input', inputDir, '--output', outDir])
      expect(result.status).toBe(0)
      const content = readFileSync(join(outDir, 'log.txt'), 'utf-8')
      expect(content).not.toContain('alice@example.com')
      expect(content).toContain('[EMAIL]')
    } finally {
      cleanup()
    }
  })

  it('scrubs GitHub personal access tokens', () => {
    const { dir, cleanup } = makeDir()
    try {
      const inputDir = join(dir, 'evidence')
      mkdirSync(inputDir)
      writeFileSync(join(inputDir, 'env.txt'), 'TOKEN=ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345678\n')
      const outDir = join(dir, 'snapshot')
      run(['--input', inputDir, '--output', outDir])
      const content = readFileSync(join(outDir, 'env.txt'), 'utf-8')
      expect(content).not.toContain('ghp_')
      expect(content).toContain('[GH_TOKEN]')
    } finally {
      cleanup()
    }
  })

  it('scrubs GitHub service tokens (ghs_)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const inputDir = join(dir, 'evidence')
      mkdirSync(inputDir)
      writeFileSync(join(inputDir, 'env.txt'), 'TOKEN=ghs_AbCdEfGhIjKlMnOpQrStUvWxYz012345\n')
      const outDir = join(dir, 'snapshot')
      run(['--input', inputDir, '--output', outDir])
      const content = readFileSync(join(outDir, 'env.txt'), 'utf-8')
      expect(content).not.toContain('ghs_')
      expect(content).toContain('[GH_TOKEN]')
    } finally {
      cleanup()
    }
  })

  it('scrubs AWS access key IDs', () => {
    const { dir, cleanup } = makeDir()
    try {
      const inputDir = join(dir, 'evidence')
      mkdirSync(inputDir)
      writeFileSync(join(inputDir, 'cfg.txt'), 'aws_access_key_id=AKIAIOSFODNN7EXAMPLE\n')
      const outDir = join(dir, 'snapshot')
      run(['--input', inputDir, '--output', outDir])
      const content = readFileSync(join(outDir, 'cfg.txt'), 'utf-8')
      expect(content).not.toContain('AKIAIOSFODNN7EXAMPLE')
      expect(content).toContain('[AWS_KEY]')
    } finally {
      cleanup()
    }
  })

  it('scrubs private IPv4 addresses', () => {
    const { dir, cleanup } = makeDir()
    try {
      const inputDir = join(dir, 'evidence')
      mkdirSync(inputDir)
      writeFileSync(join(inputDir, 'net.txt'), 'server at 192.168.1.100\n')
      const outDir = join(dir, 'snapshot')
      run(['--input', inputDir, '--output', outDir])
      const content = readFileSync(join(outDir, 'net.txt'), 'utf-8')
      expect(content).not.toContain('192.168.1.100')
      expect(content).toContain('[IPV4]')
    } finally {
      cleanup()
    }
  })

  it('scrubs internal hostnames (.internal/.local/.corp)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const inputDir = join(dir, 'evidence')
      mkdirSync(inputDir)
      writeFileSync(join(inputDir, 'hosts.txt'), 'host: myserver.internal\nother: build-01.corp\n')
      const outDir = join(dir, 'snapshot')
      run(['--input', inputDir, '--output', outDir])
      const content = readFileSync(join(outDir, 'hosts.txt'), 'utf-8')
      expect(content).not.toContain('myserver.internal')
      expect(content).not.toContain('build-01.corp')
      expect(content).toContain('[HOSTNAME]')
    } finally {
      cleanup()
    }
  })

  it('scrubs Bearer tokens', () => {
    const { dir, cleanup } = makeDir()
    try {
      const inputDir = join(dir, 'evidence')
      mkdirSync(inputDir)
      writeFileSync(join(inputDir, 'req.txt'), 'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9\n')
      const outDir = join(dir, 'snapshot')
      run(['--input', inputDir, '--output', outDir])
      const content = readFileSync(join(outDir, 'req.txt'), 'utf-8')
      expect(content).not.toContain('Bearer eyJhbGciOiJSUzI1NiJ9')
      expect(content).toContain('[BEARER_TOKEN]')
    } finally {
      cleanup()
    }
  })

  it('scrubs JWT triplets', () => {
    const { dir, cleanup } = makeDir()
    try {
      const inputDir = join(dir, 'evidence')
      mkdirSync(inputDir)
      const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIn0.signature'
      writeFileSync(join(inputDir, 'token.txt'), `token=${jwt}\n`)
      const outDir = join(dir, 'snapshot')
      run(['--input', inputDir, '--output', outDir])
      const content = readFileSync(join(outDir, 'token.txt'), 'utf-8')
      expect(content).not.toContain(jwt)
      expect(content).toContain('[JWT]')
    } finally {
      cleanup()
    }
  })

  it('fails if any PII pattern survives re-scan (canary file)', () => {
    const { dir, cleanup } = makeDir()
    try {
      // Simulate a scrubber that is broken (outputs raw PII)
      const inputDir = join(dir, 'evidence')
      mkdirSync(inputDir)
      // Copy the canary file unchanged as input
      const canary = readFileSync(CANARY, 'utf-8')
      writeFileSync(join(inputDir, 'canary.txt'), canary)
      const outDir = join(dir, 'snapshot')
      const result = run(['--input', inputDir, '--output', outDir])
      // Scrubber MUST exit 0 and the output must not contain any planted markers
      expect(result.status).toBe(0)
      const content = readFileSync(join(outDir, 'canary.txt'), 'utf-8')
      expect(content).not.toMatch(/alice@example\.com/)
      expect(content).not.toMatch(/ghp_[A-Za-z0-9]{36}/)
      expect(content).not.toMatch(/ghs_[A-Za-z0-9]{35}/)
      expect(content).not.toMatch(/gho_[A-Za-z0-9]{35}/)
      expect(content).not.toMatch(/ghr_[A-Za-z0-9]{35}/)
      expect(content).not.toMatch(/ghu_[A-Za-z0-9]{35}/)
      expect(content).not.toMatch(/AKIAIOSFODNN7EXAMPLE/)
      expect(content).not.toMatch(/10\.0\.0\.1/)
      expect(content).not.toMatch(/127\.0\.0\.1/)
      expect(content).not.toMatch(/172\.16\.0\.1/)
      expect(content).not.toMatch(/192\.168\.1\.100/)
      expect(content).not.toMatch(/myserver\.internal/)
      expect(content).not.toMatch(/mydevbox\.local/)
      expect(content).not.toMatch(/build-01\.corp/)
      expect(content).not.toMatch(/Bearer eyJ/)
      expect(content).not.toMatch(/ABCDEF1234567890ABCDEF1234567890ABCDEF12/)
    } finally {
      cleanup()
    }
  })
})
