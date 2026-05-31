import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-adr-index.mjs')

function run(adrDir: string, readmePath: string): { status: number; stdout: string } {
  const r = spawnSync('node', [SCRIPT, `--adr-dir=${adrDir}`, `--readme=${readmePath}`], {
    encoding: 'utf-8',
    cwd: resolve('.'),
  })
  return { status: r.status ?? 1, stdout: (r.stdout ?? '') + (r.stderr ?? '') }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'adr-index-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function makeAdr(dir: string, filename: string, canonicalId: string, title: string): void {
  writeFileSync(
    join(dir, filename),
    `---\ntitle: '${title}'\ndoc_version: '1.0.0'\nstatus: active\nlast_review: '2026-01-01'\nowner: ''\ncanonical_id: '${canonicalId}'\ntags: []\nrelated: []\n---\n\n# ${title}\n\nContent.\n`,
  )
}

function makeReadme(dir: string, filenames: string[]): string {
  const readmePath = join(dir, 'README.md')
  const rows = filenames.map((f) => `| [${f}](${f}) |`).join('\n')
  writeFileSync(readmePath, `# ADR Index\n\n${rows}\n`)
  return readmePath
}

describe('check-adr-index.mjs', () => {
  it('exits 0 when all ADRs have correct canonical_id and README lists them', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeAdr(dir, '001-agents-canonical.md', '001', 'ADR-001: Agents canonical')
      makeAdr(dir, '002-thin-pointer.md', '002', 'ADR-002: Thin pointer')
      const readme = makeReadme(dir, ['001-agents-canonical.md', '002-thin-pointer.md'])
      const { status } = run(dir, readme)
      expect(status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when canonical_id is empty', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeAdr(dir, '001-agents-canonical.md', '', 'ADR-001: Agents canonical')
      const readme = makeReadme(dir, ['001-agents-canonical.md'])
      const { status, stdout } = run(dir, readme)
      expect(status).toBe(1)
      expect(stdout).toContain('canonical_id')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when canonical_id mismatches filename number', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeAdr(dir, '007-some-decision.md', '042', 'ADR-007: Some decision')
      const readme = makeReadme(dir, ['007-some-decision.md'])
      const { status, stdout } = run(dir, readme)
      expect(status).toBe(1)
      expect(stdout).toContain('007')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when duplicate ADR numbers exist', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeAdr(dir, '005-first.md', '005', 'ADR-005: First')
      makeAdr(dir, '005-second.md', '005', 'ADR-005: Second')
      const readme = makeReadme(dir, ['005-first.md', '005-second.md'])
      const { status, stdout } = run(dir, readme)
      expect(status).toBe(1)
      expect(stdout).toContain('005')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an ADR file is missing from README', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeAdr(dir, '001-agents-canonical.md', '001', 'ADR-001: Agents canonical')
      makeAdr(dir, '002-thin-pointer.md', '002', 'ADR-002: Thin pointer')
      const readme = makeReadme(dir, ['001-agents-canonical.md'])
      const { status, stdout } = run(dir, readme)
      expect(status).toBe(1)
      expect(stdout).toContain('002-thin-pointer.md')
    } finally {
      cleanup()
    }
  })

  it('ignores non-numbered files (README.md, ADR-000_template.md, etc.)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeAdr(dir, '001-agents-canonical.md', '001', 'ADR-001: Agents canonical')
      writeFileSync(join(dir, 'README.md'), '# index\n')
      writeFileSync(join(dir, 'ADR-000_template.md'), '# template\n')
      writeFileSync(join(dir, 'ADR-TEMPLATE.md'), '# template2\n')
      const readme = makeReadme(dir, ['001-agents-canonical.md'])
      const { status } = run(dir, readme)
      expect(status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 on empty ADR dir with empty README', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const readme = makeReadme(dir, [])
      const { status } = run(dir, readme)
      expect(status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
