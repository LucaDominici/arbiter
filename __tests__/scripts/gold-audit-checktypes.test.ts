// SPDX-License-Identifier: Apache-2.0
// TDD: new deterministic gold-audit check types (epic #1469, Wave A #1470).
// Exercises the .mjs engine end-to-end via the CLI (spawn), mirroring gold-audit.test.ts.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/gold-audit.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Materialize a repo with a registry + arbitrary files, return its dir + verdict map. */
function audit(
  registry: string,
  files: Record<string, string> = {},
): {
  byId: Record<string, { verdict: string; evidence: { file?: string; detail?: string } | null }>
  raw: string
} {
  const dir = mkdtempSync(join(tmpdir(), 'gold-ct-'))
  try {
    mkdirSync(join(dir, 'standards'), { recursive: true })
    writeFileSync(join(dir, 'standards', 'gold-registry.yml'), registry)
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel)
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, content)
    }
    const r = run(dir, ['--json'])
    const j = JSON.parse(r.stdout)
    const byId = Object.fromEntries(j.checks.map((c: { id: string }) => [c.id, c]))
    return { byId, raw: r.stdout }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── version_consistency: VERSION file ↔ CHANGELOG latest entry ──────────────────

const VC_REGISTRY = `version: '1.0.0'
dimensions:
  - id: D-RELEASE
    title: Release hygiene
checks:
  - id: GA-REL-01
    dimension: D-RELEASE
    title: VERSION matches CHANGELOG latest
    type: version_consistency
    args:
      version_file: VERSION
      changelog_file: CHANGELOG.md
      changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)'
    weight: 1
    risk: SAFE
`

describe('version_consistency check type (#1470)', () => {
  it('Y when VERSION equals the CHANGELOG latest entry', () => {
    const { byId } = audit(VC_REGISTRY, {
      VERSION: '1.4.0\n',
      'CHANGELOG.md': '# Changelog\n\n## [1.4.0] - 2026-06-20\n- thing\n\n## [1.3.0]\n- old\n',
    })
    expect(byId['GA-REL-01'].verdict).toBe('Y')
  })

  it('P when both files exist but the versions diverge', () => {
    const { byId } = audit(VC_REGISTRY, {
      VERSION: '1.4.0\n',
      'CHANGELOG.md': '# Changelog\n\n## [1.3.0] - 2026-06-01\n- old top\n',
    })
    expect(byId['GA-REL-01'].verdict).toBe('P')
  })

  it('P when the CHANGELOG has no entry matching the pattern (indeterminate, not a false Y)', () => {
    const { byId } = audit(VC_REGISTRY, {
      VERSION: '1.4.0\n',
      'CHANGELOG.md': '# Changelog\n\n(no released versions yet)\n',
    })
    expect(byId['GA-REL-01'].verdict).toBe('P')
  })

  it('N when the VERSION file is missing', () => {
    const { byId } = audit(VC_REGISTRY, {
      'CHANGELOG.md': '# Changelog\n\n## [1.4.0]\n',
    })
    expect(byId['GA-REL-01'].verdict).toBe('N')
  })

  it('N when the CHANGELOG file is missing', () => {
    const { byId } = audit(VC_REGISTRY, { VERSION: '1.4.0\n' })
    expect(byId['GA-REL-01'].verdict).toBe('N')
  })

  it('carries evidence detail on a divergence', () => {
    const { byId } = audit(VC_REGISTRY, {
      VERSION: '2.0.0\n',
      'CHANGELOG.md': '## [1.9.0]\n',
    })
    expect(byId['GA-REL-01'].evidence?.detail).toMatch(/2\.0\.0/)
    expect(byId['GA-REL-01'].evidence?.detail).toMatch(/1\.9\.0/)
  })

  it('is deterministic — byte-identical JSON across two runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-ct-det-'))
    try {
      mkdirSync(join(dir, 'standards'), { recursive: true })
      writeFileSync(join(dir, 'standards', 'gold-registry.yml'), VC_REGISTRY)
      writeFileSync(join(dir, 'VERSION'), '1.4.0\n')
      writeFileSync(join(dir, 'CHANGELOG.md'), '## [1.4.0]\n')
      const a = run(dir, ['--json']).stdout
      const b = run(dir, ['--json']).stdout
      expect(a).toBe(b)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('empty/whitespace VERSION is P, never a false Y (anti-fake-green regression)', () => {
    const { byId } = audit(VC_REGISTRY, { VERSION: '   \n', 'CHANGELOG.md': '## [1.4.0]\n' })
    expect(byId['GA-REL-01'].verdict).toBe('P')
  })

  it('a v-prefixed VERSION diverges from a bare-numeric capture → P (not a false Y)', () => {
    const { byId } = audit(VC_REGISTRY, { VERSION: 'v1.4.0\n', 'CHANGELOG.md': '## [1.4.0]\n' })
    expect(byId['GA-REL-01'].verdict).toBe('P')
  })

  it('CRLF line endings in the CHANGELOG still match → Y', () => {
    const { byId } = audit(VC_REGISTRY, {
      VERSION: '1.4.0\n',
      'CHANGELOG.md': '# Changelog\r\n\r\n## [1.4.0] - 2026-06-20\r\n',
    })
    expect(byId['GA-REL-01'].verdict).toBe('Y')
  })

  it('a directory at version_file resolves to N (no crash, no false verdict)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-ct-dir-'))
    try {
      mkdirSync(join(dir, 'standards'), { recursive: true })
      writeFileSync(join(dir, 'standards', 'gold-registry.yml'), VC_REGISTRY)
      mkdirSync(join(dir, 'VERSION'))
      writeFileSync(join(dir, 'CHANGELOG.md'), '## [1.4.0]\n')
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId = Object.fromEntries(j.checks.map((c: { id: string }) => [c.id, c]))
      expect(byId['GA-REL-01'].verdict).toBe('N')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── version_consistency with a JSON version source (version_select: package.json) ──

const VC_JSON_REGISTRY = `version: '1.0.0'
dimensions:
  - id: D-RELEASE
    title: Release hygiene
checks:
  - id: GA-REL-01
    dimension: D-RELEASE
    title: package.json version matches CHANGELOG latest
    type: version_consistency
    args:
      version_file: package.json
      version_select: version
      changelog_file: CHANGELOG.md
      changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)'
    weight: 1
    risk: SAFE
`

describe('version_consistency with a JSON version source (G2)', () => {
  it('Y when package.json version equals the CHANGELOG latest entry', () => {
    const { byId } = audit(VC_JSON_REGISTRY, {
      'package.json': '{\n  "name": "demo",\n  "version": "1.4.0"\n}\n',
      'CHANGELOG.md': '# Changelog\n\n## [1.4.0] - 2026-06-20\n- thing\n\n## [1.3.0]\n- old\n',
    })
    expect(byId['GA-REL-01'].verdict).toBe('Y')
  })

  it('P when package.json version diverges from the CHANGELOG latest entry', () => {
    const { byId } = audit(VC_JSON_REGISTRY, {
      'package.json': '{ "version": "2.0.0" }\n',
      'CHANGELOG.md': '# Changelog\n\n## [1.4.0] - 2026-06-01\n- old top\n',
    })
    expect(byId['GA-REL-01'].verdict).toBe('P')
    expect(byId['GA-REL-01'].evidence?.detail).toMatch(/2\.0\.0/)
  })

  it('P when the selected JSON field is absent (indeterminate, never a false Y)', () => {
    const { byId } = audit(VC_JSON_REGISTRY, {
      'package.json': '{ "name": "demo" }\n',
      'CHANGELOG.md': '## [1.4.0]\n',
    })
    expect(byId['GA-REL-01'].verdict).toBe('P')
  })

  it('P when package.json is not valid JSON (parse failure is not a false Y)', () => {
    const { byId } = audit(VC_JSON_REGISTRY, {
      'package.json': 'not json at all\n',
      'CHANGELOG.md': '## [1.4.0]\n',
    })
    expect(byId['GA-REL-01'].verdict).toBe('P')
  })

  it('N when the CHANGELOG file is missing', () => {
    const { byId } = audit(VC_JSON_REGISTRY, {
      'package.json': '{ "version": "1.4.0" }\n',
    })
    expect(byId['GA-REL-01'].verdict).toBe('N')
  })
})

// ── forbidden_pattern: a regex that must NOT appear under a glob ─────────────────

const FP_REGISTRY = `version: '1.0.0'
dimensions:
  - id: D-HYGIENE
    title: Source hygiene
checks:
  - id: GA-HYG-01
    dimension: D-HYGIENE
    title: No forbidden marker in sources
    type: forbidden_pattern
    args:
      glob: 'src/**/*.ts'
      pattern: 'FORBIDDEN_MARKER'
    weight: 1
    risk: SAFE
`

describe('forbidden_pattern check type (#1470)', () => {
  it('Y when the pattern is absent across all matched files', () => {
    const { byId } = audit(FP_REGISTRY, {
      'src/a.ts': 'const a = 1\n',
      'src/nested/b.ts': 'const b = 2\n',
    })
    expect(byId['GA-HYG-01'].verdict).toBe('Y')
  })

  it('N (with first sorted offending file) when the pattern is present', () => {
    const { byId } = audit(FP_REGISTRY, {
      'src/a.ts': 'clean\n',
      'src/z.ts': 'has FORBIDDEN_MARKER here\n',
    })
    expect(byId['GA-HYG-01'].verdict).toBe('N')
    expect(byId['GA-HYG-01'].evidence?.file ?? '').toBe('src/z.ts')
  })

  it('NA when the glob matches no files (nothing of this kind exists — not a false Y)', () => {
    const { byId } = audit(FP_REGISTRY, { 'docs/readme.md': 'no ts here\n' })
    expect(byId['GA-HYG-01'].verdict).toBe('NA')
  })

  it('N when excludes remove every matched file (refuses to fake-green an emptied scan)', () => {
    const reg = `version: '1.0.0'
checks:
  - id: GA-HYG-01
    type: forbidden_pattern
    args:
      glob: 'src/*.ts'
      pattern: 'FORBIDDEN_MARKER'
      exclude_paths: ['src/a.ts']
      rationale: 'a.ts is generated'
    weight: 1
`
    const { byId } = audit(reg, { 'src/a.ts': 'has FORBIDDEN_MARKER\n' })
    expect(byId['GA-HYG-01'].verdict).toBe('N')
  })

  it('N when exclude_paths is present without a rationale', () => {
    const reg = `version: '1.0.0'
checks:
  - id: GA-HYG-01
    type: forbidden_pattern
    args:
      glob: 'src/*.ts'
      pattern: 'FORBIDDEN_MARKER'
      exclude_paths: ['src/a.ts']
    weight: 1
`
    const { byId } = audit(reg, { 'src/a.ts': 'clean\n', 'src/b.ts': 'clean\n' })
    expect(byId['GA-HYG-01'].verdict).toBe('N')
  })

  it('N on an empty pattern and on an invalid regex (fail-closed)', () => {
    const emptyReg = `version: '1.0.0'
checks:
  - id: GA-HYG-01
    type: forbidden_pattern
    args: { glob: 'src/*.ts', pattern: '' }
    weight: 1
`
    expect(audit(emptyReg, { 'src/a.ts': 'x\n' }).byId['GA-HYG-01'].verdict).toBe('N')
    const badReg = `version: '1.0.0'
checks:
  - id: GA-HYG-01
    type: forbidden_pattern
    args: { glob: 'src/*.ts', pattern: '(' }
    weight: 1
`
    expect(audit(badReg, { 'src/a.ts': 'x\n' }).byId['GA-HYG-01'].verdict).toBe('N')
  })

  it('N on a catastrophic-backtracking pattern WITHOUT hanging the audit (#1525)', () => {
    const redosReg = `version: '1.0.0'
checks:
  - id: GA-HYG-01
    type: forbidden_pattern
    args: { glob: 'src/*.ts', pattern: '(a+)+$' }
    weight: 1
`
    const t0 = Date.now()
    // 40k "a" + "!" would wedge an unguarded (a+)+$ scan; the guard rejects it before scanning.
    const { byId } = audit(redosReg, { 'src/a.ts': 'a'.repeat(40_000) + '!' })
    expect(byId['GA-HYG-01'].verdict).toBe('N')
    expect(byId['GA-HYG-01'].evidence?.detail).toContain('unsafe regex (ReDoS risk)')
    expect(Date.now() - t0).toBeLessThan(8000) // a re-enabled hang would never return in time
  })

  it('is deterministic — byte-identical JSON across two runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-fp-det-'))
    try {
      mkdirSync(join(dir, 'standards'), { recursive: true })
      mkdirSync(join(dir, 'src', 'nested'), { recursive: true })
      writeFileSync(join(dir, 'standards', 'gold-registry.yml'), FP_REGISTRY)
      writeFileSync(join(dir, 'src', 'a.ts'), 'const a = 1\n')
      writeFileSync(join(dir, 'src', 'nested', 'b.ts'), 'const b = 2\n')
      const a = run(dir, ['--json']).stdout
      const b = run(dir, ['--json']).stdout
      expect(a).toBe(b)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── file_stat: the executable bit on a glob ─────────────────────────────────────

const FS_REGISTRY = `version: '1.0.0'
dimensions:
  - id: D-PERMS
    title: File permissions
checks:
  - id: GA-PERM-01
    dimension: D-PERMS
    title: Shell scripts are executable
    type: file_stat
    args:
      glob: 'bin/*.sh'
      bit: executable
    weight: 1
    risk: SAFE
`

/** Materialize a repo, chmod selected files, run the CLI, return the verdict map. */
function auditWithModes(
  registry: string,
  files: Record<string, { content: string; mode: number }>,
): Record<string, { verdict: string; evidence: { file?: string; detail?: string } | null }> {
  const dir = mkdtempSync(join(tmpdir(), 'gold-fs-'))
  try {
    mkdirSync(join(dir, 'standards'), { recursive: true })
    writeFileSync(join(dir, 'standards', 'gold-registry.yml'), registry)
    for (const [rel, { content, mode }] of Object.entries(files)) {
      const abs = join(dir, rel)
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, content)
      chmodSync(abs, mode)
    }
    const j = JSON.parse(run(dir, ['--json']).stdout)
    return Object.fromEntries(j.checks.map((c: { id: string }) => [c.id, c]))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('file_stat check type (#1470)', () => {
  it('Y when every matched file has the executable bit', () => {
    const byId = auditWithModes(FS_REGISTRY, {
      'bin/run.sh': { content: '#!/bin/sh\n', mode: 0o755 },
      'bin/build.sh': { content: '#!/bin/sh\n', mode: 0o755 },
    })
    expect(byId['GA-PERM-01'].verdict).toBe('Y')
  })

  it('N when no matched file is executable (first sorted offender in evidence)', () => {
    const byId = auditWithModes(FS_REGISTRY, {
      'bin/run.sh': { content: '#!/bin/sh\n', mode: 0o644 },
    })
    expect(byId['GA-PERM-01'].verdict).toBe('N')
    expect(byId['GA-PERM-01'].evidence?.file ?? '').toBe('bin/run.sh')
  })

  it('P when only some matched files are executable', () => {
    const byId = auditWithModes(FS_REGISTRY, {
      'bin/run.sh': { content: '#!/bin/sh\n', mode: 0o755 },
      'bin/other.sh': { content: '#!/bin/sh\n', mode: 0o644 },
    })
    expect(byId['GA-PERM-01'].verdict).toBe('P')
  })

  it('NA when the glob matches no files (valid empty glob)', () => {
    const byId = auditWithModes(FS_REGISTRY, {
      'src/a.ts': { content: 'x\n', mode: 0o644 },
    })
    expect(byId['GA-PERM-01'].verdict).toBe('NA')
  })

  it('N when a non-executable bit is requested (only the exec bit is deterministic)', () => {
    const reg = `version: '1.0.0'
checks:
  - id: GA-PERM-01
    type: file_stat
    args: { glob: 'bin/*.sh', bit: writable }
    weight: 1
`
    const byId = auditWithModes(reg, { 'bin/run.sh': { content: '#!/bin/sh\n', mode: 0o755 } })
    expect(byId['GA-PERM-01'].verdict).toBe('N')
  })

  it('NA when git core.fileMode is disabled (exec bit unmeasurable)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-fs-nofm-'))
    try {
      mkdirSync(join(dir, 'standards'), { recursive: true })
      mkdirSync(join(dir, '.git'), { recursive: true })
      mkdirSync(join(dir, 'bin'), { recursive: true })
      writeFileSync(join(dir, 'standards', 'gold-registry.yml'), FS_REGISTRY)
      writeFileSync(join(dir, '.git', 'config'), '[core]\n\tfilemode = false\n')
      const sh = join(dir, 'bin', 'run.sh')
      writeFileSync(sh, '#!/bin/sh\n')
      chmodSync(sh, 0o644)
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId = Object.fromEntries(j.checks.map((c: { id: string }) => [c.id, c]))
      expect(byId['GA-PERM-01'].verdict).toBe('NA')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
