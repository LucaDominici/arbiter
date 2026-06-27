// SPDX-License-Identifier: Apache-2.0
// TDD guard for #902 / #886 — SHA-pin self-check (INV-76, enforced).
// A non-SHA action reference now fails the gate (exit 1); clean repos exit 0.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-action-pins.mjs')

function run(dir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: dir })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'check-action-pins-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-action-pins.mjs (#902/#886, INV-76 enforced)', () => {
  it('rejects a tag-pinned ref with exit 1 (no transition)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).not.toContain('[TRANSITION-WARN]')
      expect(result.stderr).toContain('non-SHA action reference')
      expect(result.stderr).toContain('actions/checkout@v4')
    } finally {
      cleanup()
    }
  })

  it('reports clean when all refs are SHA-pinned (lowercase)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })

  it('reports clean when all refs are SHA-pinned (uppercase — case-insensitive)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@11BD71901BBE5B1630CEEA73D27597364C9AF683\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })

  it('ignores local composite actions and docker refs', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: ./.github/actions/setup\n      - uses: docker://alpine:3.19\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })

  it('exits 0 silently when no .github/ directory exists', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
      expect(result.stderr).not.toContain('[TRANSITION-WARN]')
    } finally {
      cleanup()
    }
  })

  it('scans .github/actions/ dir (composite action yamls)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'actions', 'my-action'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'actions', 'my-action', 'action.yml'),
        'runs:\n  using: composite\n  steps:\n    - uses: actions/setup-node@v4\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).not.toContain('[TRANSITION-WARN]')
      expect(result.stderr).toContain('actions/setup-node@v4')
    } finally {
      cleanup()
    }
  })

  // #1491 (security-privacy MAJOR-3): a fabricated/short/tag SHA pin in a workflow TEMPLATE
  // (src/templates/**/workflows/*.ejs) is emitted verbatim into every generated project. The pin
  // gate must vet the emitted source, not only arbiter's own .github/.
  function writeTemplate(dir: string, name: string, body: string): void {
    const wfDir = join(dir, 'src', 'templates', 'github', 'workflows')
    mkdirSync(wfDir, { recursive: true })
    writeFileSync(join(wfDir, name), body)
  }

  it('rejects a fabricated/short SHA pin in a workflow template (.ejs)', () => {
    const { dir, cleanup } = makeDir()
    try {
      // 39-char SHA (one short) — the exact MAJOR-3 defect; not a valid commit object.
      writeTemplate(
        dir,
        'deploy.yml.ejs',
        'jobs:\n  go:\n    steps:\n      - uses: google-github-actions/auth@71f986410dfbc7ef6f5e4d50c57a2b159b3e3ec  # v2\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('non-SHA action reference')
      expect(result.stderr).toContain('71f986410dfbc7ef6f5e4d50c57a2b159b3e3ec')
      expect(result.stderr).toContain('deploy.yml.ejs')
    } finally {
      cleanup()
    }
  })

  it('rejects a tag-pinned ref in a workflow template (.ejs)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeTemplate(
        dir,
        'ci.yml.ejs',
        'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('actions/checkout@v4')
    } finally {
      cleanup()
    }
  })

  it('accepts a real 40-hex SHA and skips templated/local refs in a workflow template', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeTemplate(
        dir,
        'mixed.yml.ejs',
        'jobs:\n  build:\n    steps:\n' +
          '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n' +
          '      - uses: actions/setup-node@<%= setupNodeSha %>\n' +
          '      - uses: foo/bar@${{ env.PIN }}\n' +
          '      - uses: ./.github/actions/local\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })

  // #1614: INV-76 verifies the sha is 40-hex but never that the trailing `# vN` comment is
  // truthful. A single immutable sha resolves to ONE upstream release, so two pins of the same
  // sha advertising different MAJOR versions means one comment lies — a supply-chain-hygiene
  // defect that misleads any maintainer rotating pins by reading the labels.
  it('rejects one sha labelled with contradictory major versions (e.g. # v9 vs # v7)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const wfDir = join(dir, '.github', 'workflows')
      mkdirSync(wfDir, { recursive: true })
      // Same 40-hex sha, two different MAJOR labels across two files.
      writeFileSync(
        join(wfDir, 'a.yml'),
        'jobs:\n  a:\n    steps:\n      - uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b  # v9\n',
      )
      writeFileSync(
        join(wfDir, 'b.yml'),
        'jobs:\n  b:\n    steps:\n      - uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b  # v7\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('contradictory version comments')
      expect(result.stderr).toContain(
        'actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b',
      )
    } finally {
      cleanup()
    }
  })

  it('tolerates differing precision on the same major (# v6 vs # v6.0.3)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const wfDir = join(dir, '.github', 'workflows')
      mkdirSync(wfDir, { recursive: true })
      writeFileSync(
        join(wfDir, 'a.yml'),
        'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10  # v6\n',
      )
      writeFileSync(
        join(wfDir, 'b.yml'),
        'jobs:\n  b:\n    steps:\n      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10  # v6.0.3\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('truthful version comments')
    } finally {
      cleanup()
    }
  })

  it('only scans .ejs files under a workflows/ template dir (ignores other templates)', () => {
    const { dir, cleanup } = makeDir()
    try {
      // A non-workflows template with a tag ref must NOT trip the gate.
      const otherDir = join(dir, 'src', 'templates', 'docs')
      mkdirSync(otherDir, { recursive: true })
      writeFileSync(
        join(otherDir, 'example.md.ejs'),
        'Example doc snippet: uses: actions/checkout@v4\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })
})

// #1666: divergent-sha gate (major-bucketed). One immutable sha is ONE upstream release,
// so pinning an action to >1 distinct sha within a single MAJOR is a dup-sha bug that is
// NEVER allowlistable; a split ACROSS majors is allowed only when explicitly declared.
describe('check-action-pins.mjs (#1666, divergent-sha major-bucketed)', () => {
  function writeWorkflow(dir: string, name: string, body: string): void {
    const wfDir = join(dir, '.github', 'workflows')
    mkdirSync(wfDir, { recursive: true })
    writeFileSync(join(wfDir, name), body)
  }

  // (a) reproduce-RED: a WITHIN-major patch divergence fails even on an allowlisted action.
  // upload-artifact is allowlisted for a v4/v7 cross-major split, but two DIFFERENT v4 shas
  // is a dup-sha bug — the allowlist does not (and must not) excuse it.
  it('fails a within-major dup even when the action is on the cross-major allowlist', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeWorkflow(
        dir,
        'a.yml',
        'jobs:\n  j:\n    steps:\n' +
          '      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02  # v4.6.2\n' +
          '      - uses: actions/upload-artifact@65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08  # v4.6.0\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('divergent SHAs within one major')
      expect(result.stderr).toContain('actions/upload-artifact')
    } finally {
      cleanup()
    }
  })

  // (b) reproduce-RED: a DECLARED cross-major split passes (each major → its exact allowlisted sha).
  it('passes a declared cross-major split (download-artifact v4 + v8)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeWorkflow(
        dir,
        'a.yml',
        'jobs:\n  j:\n    steps:\n' +
          '      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093  # v4.3.0\n' +
          '      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c  # v8.0.1\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })

  // The core bug class: a within-major dup on a NON-allowlisted action is a hard fail.
  it('fails two distinct shas of one action within the same major (non-allowlisted)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeWorkflow(
        dir,
        'a.yml',
        'jobs:\n  j:\n    steps:\n' +
          `      - uses: actions/setup-go@${'a'.repeat(40)}  # v5\n` +
          `      - uses: actions/setup-go@${'b'.repeat(40)}  # v5\n`,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('divergent SHAs within one major')
      expect(result.stderr).toContain('actions/setup-go')
    } finally {
      cleanup()
    }
  })

  // An UNDECLARED cross-major split (action not in the allowlist) is a hard fail.
  it('fails an undeclared cross-major split (action absent from the allowlist)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeWorkflow(
        dir,
        'a.yml',
        'jobs:\n  j:\n    steps:\n' +
          `      - uses: actions/cache@${'a'.repeat(40)}  # v3\n` +
          `      - uses: actions/cache@${'b'.repeat(40)}  # v4\n`,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('undeclared cross-major')
      expect(result.stderr).toContain('actions/cache')
    } finally {
      cleanup()
    }
  })

  // 0ver: the effective major is `0.<minor>`. v0.9 vs v0.24 are DIFFERENT effective majors
  // (cross-major, allowlisted for anchore); two v0.24.x shas would be a within-major dup.
  it('passes a declared 0ver cross-major split (anchore v0.9 + v0.24)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeWorkflow(
        dir,
        'a.yml',
        'jobs:\n  j:\n    steps:\n' +
          '      - uses: anchore/sbom-action@f6c3d0fe42c3cf876e3462574e4c9416b5e0f07a  # v0.9.0\n' +
          '      - uses: anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610  # v0.24.0\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })
})
