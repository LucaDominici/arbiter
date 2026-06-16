import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'

const SCRIPT = resolve('scripts/check-doc-set.mjs')
const SHIPPED_MANIFEST = resolve('standards/gold-doc-set.yml')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(manifest: string, profile?: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'doc-set-test-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), manifest)
  if (profile) {
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, 'standards', 'doc-profile'), profile)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const MANIFEST = `version: '1.0.0'
profile: tooling
checks:
  - path: README.md
    tier: mandatory
    applies: always
  - path: docs/coding-standards.md
    tier: mandatory
    applies: always
    accept_any: ['docs/coding-standards.md', 'CONTRIBUTING.md']
  - path: docs/GLOSSARY.md
    tier: recommended
    applies: always
  - path: docs/api
    tier: conditional
    applies: has-api
    glob: 'docs/api/*'
`

describe('check-doc-set (#1374)', () => {
  it('--help exits 0', () => {
    const { dir, cleanup } = makeRepo(MANIFEST)
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('reports a mandatory gap and --strict exits 1', () => {
    const { dir, cleanup } = makeRepo(MANIFEST)
    try {
      // README.md missing → mandatory gap.
      const advisory = run(dir)
      expect(advisory.status).toBe(0) // advisory by default
      expect(advisory.stdout).toMatch(/MISSING \[mandatory\] README\.md/)
      const strict = run(dir, ['--strict'])
      expect(strict.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('accept_any: an equivalent path satisfies the check', () => {
    const { dir, cleanup } = makeRepo(MANIFEST)
    try {
      writeFileSync(join(dir, 'README.md'), '# r')
      writeFileSync(join(dir, 'CONTRIBUTING.md'), '# c') // satisfies docs/coding-standards via accept_any
      const r = run(dir, ['--strict'])
      expect(r.status).toBe(0)
      expect(r.stdout).not.toMatch(/MISSING \[mandatory\]/)
    } finally {
      cleanup()
    }
  })

  it('conditional checks are n/a unless their overlay is enabled', () => {
    const off = makeRepo(MANIFEST)
    try {
      writeFileSync(join(off.dir, 'README.md'), '# r')
      writeFileSync(join(off.dir, 'CONTRIBUTING.md'), '# c')
      const r = run(off.dir, ['--json'])
      const j = JSON.parse(r.stdout)
      expect(j.totals.na).toBe(1) // docs/api conditional, overlay off
    } finally {
      off.cleanup()
    }
    const on = makeRepo(MANIFEST, 'overlays:\n  - has-api\n')
    try {
      writeFileSync(join(on.dir, 'README.md'), '# r')
      writeFileSync(join(on.dir, 'CONTRIBUTING.md'), '# c')
      const r = run(on.dir, ['--strict']) // docs/api now applies and is missing (conditional, not mandatory)
      const j = JSON.parse(run(on.dir, ['--json']).stdout)
      expect(j.totals.na).toBe(0)
      expect(r.status).toBe(0) // conditional gap is not a mandatory failure
    } finally {
      on.cleanup()
    }
  })

  it('--generate scaffolds a stub for a missing docs/*.md', () => {
    const { dir, cleanup } = makeRepo(MANIFEST)
    try {
      writeFileSync(join(dir, 'README.md'), '# r')
      writeFileSync(join(dir, 'CONTRIBUTING.md'), '# c')
      const r = run(dir, ['--generate'])
      expect(r.status).toBe(0)
      expect(existsSync(join(dir, 'docs', 'GLOSSARY.md'))).toBe(true)
      expect(r.stdout).toMatch(/scaffolded stub: docs\/GLOSSARY\.md/)
    } finally {
      cleanup()
    }
  })

  it('is deterministic — identical output for identical inputs', () => {
    const { dir, cleanup } = makeRepo(MANIFEST)
    try {
      writeFileSync(join(dir, 'README.md'), '# r')
      const a = run(dir, ['--json']).stdout
      const b = run(dir, ['--json']).stdout
      expect(a).toBe(b)
    } finally {
      cleanup()
    }
  })
})

// ---- #1415 doc-kit evolution ----

describe('check-doc-set: shipped manifest enrichment (#1415)', () => {
  const manifest = parseYaml(readFileSync(SHIPPED_MANIFEST, 'utf-8')) as {
    version: string
    checks: Array<{
      path: string
      tier: string
      applies: string
      phase?: string
      drivers?: string[]
    }>
  }

  it('manifest version is bumped past 1.0.0', () => {
    expect(manifest.version).not.toBe('1.0.0')
  })

  it('every check carries a valid 12207 phase', () => {
    const phases = new Set(['inception', 'design', 'build', 'release', 'operate'])
    for (const c of manifest.checks) {
      expect(c.phase, `check ${c.path} missing phase`).toBeTruthy()
      expect(phases.has(c.phase as string), `check ${c.path} phase=${c.phase}`).toBe(true)
    }
  })

  it('every check carries a non-empty drivers[] from the known driver vocabulary', () => {
    const drivers = new Set([
      'diataxis',
      'iso29148',
      'gamp5',
      'part11',
      'iso27001',
      'gdpr',
      'nis2',
      'dd-impresoft',
      'iso12207',
      'iso9001',
      'owasp',
    ])
    for (const c of manifest.checks) {
      expect(Array.isArray(c.drivers), `check ${c.path} drivers not array`).toBe(true)
      expect((c.drivers as string[]).length, `check ${c.path} drivers empty`).toBeGreaterThan(0)
      for (const d of c.drivers as string[]) {
        expect(drivers.has(d), `check ${c.path} unknown driver ${d}`).toBe(true)
      }
    }
  })

  it('declares the new overlays via conditional checks', () => {
    const overlays = new Set(
      manifest.checks.filter((c) => c.tier === 'conditional').map((c) => c.applies),
    )
    for (const ov of ['deploys', 'customer-data', 'gxp', 'has-ai', 'has-mobile']) {
      expect(overlays.has(ov), `no conditional check gated on overlay ${ov}`).toBe(true)
    }
  })

  it('ships the new doc families (data / security / operations / supply-chain / delivery / debt)', () => {
    const paths = manifest.checks.map((c) => c.path)
    const wanted = [
      'docs/data/', // ER / classification / retention / PII inventory
      'docs/security/', // threat-model / encryption / vuln-mgmt / risk-register
      'docs/operations/', // observability / SLO / DR-BCP / backup / incidents
      'sbom', // SBOM CycloneDX/SPDX (legal & supply-chain)
      'docs/delivery/', // user-manual / admin-guide / release-notes
      'technical-debt', // technical-debt register
    ]
    for (const w of wanted) {
      expect(
        paths.some((p) => p.toLowerCase().includes(w.toLowerCase())),
        `no check path contains ${w}`,
      ).toBe(true)
    }
  })

  it('ships the anti-falso-green doc dimensions', () => {
    const paths = manifest.checks.map((c) => c.path)
    for (const w of [
      'docs/testing/anti-falso-green.md',
      'docs/testing/e2e-strategy.md',
      'docs/testing/playwright-coverage.md',
      'docs/governance/branch-protection-audit.md',
      'docs/governance/raci-matrix.md',
    ]) {
      expect(paths, `missing anti-falso-green dim ${w}`).toContain(w)
    }
  })
})

describe('check-doc-set: new overlays gate conditional families (#1415)', () => {
  const FAMILY_MANIFEST = `version: '1.1.0'
profile: tooling
checks:
  - path: README.md
    tier: mandatory
    applies: always
    phase: inception
    drivers: ['diataxis']
  - path: docs/data/pii-inventory.md
    tier: conditional
    applies: customer-data
    phase: design
    drivers: ['gdpr']
  - path: docs/operations/dr-bcp.md
    tier: conditional
    applies: deploys
    phase: operate
    drivers: ['nis2']
`

  it('conditional family is NA when its overlay is off', () => {
    const { dir, cleanup } = makeRepo(FAMILY_MANIFEST)
    try {
      writeFileSync(join(dir, 'README.md'), '# r')
      const j = JSON.parse(run(dir, ['--json']).stdout)
      expect(j.totals.na).toBe(2) // both conditional families off
      expect(j.totals.missingMandatory).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('conditional family applies (and is counted) when its overlay is on', () => {
    const { dir, cleanup } = makeRepo(FAMILY_MANIFEST, 'overlays:\n  - customer-data\n')
    try {
      writeFileSync(join(dir, 'README.md'), '# r')
      const j = JSON.parse(run(dir, ['--json']).stdout)
      expect(j.totals.na).toBe(1) // only `deploys` still off
      // customer-data doc missing → conditional gap, not mandatory failure
      expect(j.totals.missingMandatory).toBe(0)
      expect(run(dir, ['--strict']).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

describe('check-doc-set: ADR dual recognition (#1415)', () => {
  const ADR_MANIFEST = `version: '1.1.0'
profile: tooling
checks:
  - path: docs/ADR
    tier: mandatory
    applies: always
    phase: design
    drivers: ['iso12207']
    glob: 'docs/ADR/[0-9]*.md'
    adr: true
    accept_any: ['docs/ADR/[0-9]*.md', 'docs/adr/[0-9]*.md', 'docs/ADR/README.md']
`

  it('recognizes legacy ADR-NNN files', () => {
    const { dir, cleanup } = makeRepo(ADR_MANIFEST)
    try {
      mkdirSync(join(dir, 'docs', 'ADR'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'ADR', 'ADR-001-foo.md'), '# adr')
      expect(run(dir, ['--strict']).status).toBe(0)
      expect(run(dir).stdout).not.toMatch(/MISSING \[mandatory\] docs\/ADR/)
    } finally {
      cleanup()
    }
  })

  it('recognizes repo-prefixed <PREFIX>-NNN_slug.md files', () => {
    const { dir, cleanup } = makeRepo(ADR_MANIFEST)
    try {
      mkdirSync(join(dir, 'docs', 'ADR'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'ADR', 'ARB-001_thin-pointer.md'), '# adr')
      expect(run(dir, ['--strict']).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('recognizes the bare-numeric legacy form too', () => {
    const { dir, cleanup } = makeRepo(ADR_MANIFEST)
    try {
      mkdirSync(join(dir, 'docs', 'ADR'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'ADR', '001-agents.md'), '# adr')
      expect(run(dir, ['--strict']).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('still flags an ADR dir with no decision records', () => {
    const { dir, cleanup } = makeRepo(ADR_MANIFEST)
    try {
      mkdirSync(join(dir, 'docs', 'ADR'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'ADR', 'notes.txt'), 'not an adr')
      expect(run(dir, ['--strict']).status).toBe(1)
    } finally {
      cleanup()
    }
  })
})

describe('check-doc-set: --generate write-safety (#1415)', () => {
  const GEN_MANIFEST = `version: '1.1.0'
profile: tooling
checks:
  - path: README.md
    tier: mandatory
    applies: always
    phase: inception
    drivers: ['diataxis']
  - path: docs/GLOSSARY.md
    tier: recommended
    applies: always
    phase: build
    drivers: ['diataxis']
`

  it('--generate never overwrites a non-stub doc (default behavior)', () => {
    const { dir, cleanup } = makeRepo(GEN_MANIFEST)
    try {
      writeFileSync(join(dir, 'README.md'), '# real readme')
      // Pre-existing real content where a stub would be scaffolded.
      mkdirSync(join(dir, 'docs'), { recursive: true })
      const real = '# Glossary\n\nReal hand-written content, not a stub.\n'
      writeFileSync(join(dir, 'docs', 'GLOSSARY.md'), real)
      const r = run(dir, ['--generate'])
      expect(r.status).toBe(0)
      expect(readFileSync(join(dir, 'docs', 'GLOSSARY.md'), 'utf-8')).toBe(real)
      expect(r.stdout).not.toMatch(/scaffolded stub: docs\/GLOSSARY\.md/)
    } finally {
      cleanup()
    }
  })

  it('--refresh-stubs is a no-op on a real (non-stub) doc', () => {
    const { dir, cleanup } = makeRepo(GEN_MANIFEST)
    try {
      writeFileSync(join(dir, 'README.md'), '# real readme')
      mkdirSync(join(dir, 'docs'), { recursive: true })
      const real = '# Glossary\n\nReal hand-written content, not a stub.\n'
      writeFileSync(join(dir, 'docs', 'GLOSSARY.md'), real)
      const r = run(dir, ['--generate', '--refresh-stubs'])
      expect(r.status).toBe(0)
      // Real content is byte-preserved — only byte-equal stubs may be refreshed.
      expect(readFileSync(join(dir, 'docs', 'GLOSSARY.md'), 'utf-8')).toBe(real)
    } finally {
      cleanup()
    }
  })

  it('--refresh-stubs overwrites only a byte-equal stub', () => {
    const { dir, cleanup } = makeRepo(GEN_MANIFEST)
    try {
      writeFileSync(join(dir, 'README.md'), '# real readme')
      // First scaffold the stub.
      run(dir, ['--generate'])
      const stub = readFileSync(join(dir, 'docs', 'GLOSSARY.md'), 'utf-8')
      expect(stub).toMatch(/STUB — fill me in/)
      // A byte-equal stub IS refreshable (idempotent rewrite).
      const r = run(dir, ['--generate', '--refresh-stubs'])
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/refreshed stub: docs\/GLOSSARY\.md/)
      expect(readFileSync(join(dir, 'docs', 'GLOSSARY.md'), 'utf-8')).toBe(stub)
    } finally {
      cleanup()
    }
  })
})
