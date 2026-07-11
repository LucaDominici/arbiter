// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-kit-catalog-parity.mjs')

interface CatalogDim {
  id: string
  name: string
  tml: string
  gate: string
  [k: string]: unknown
}

interface MappingDim {
  id: number
  canonical_id?: string
  name: string
  tml_source?: string
  gate_type: string
  disposition?: string
  implementing_wave?: string | null
  invariant_id?: string | null
  framework_realization?: Record<string, unknown>
  [k: string]: unknown
}

interface LexEntry {
  token: string
  allowContext?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface UnmappedImportDim {
  import_id: number
  [k: string]: unknown
}

interface MappingExtras {
  unmapped_import_dims?: UnmappedImportDim[]
  import_total?: number
}

function makeTemp() {
  const dir = mkdtempSync(join(tmpdir(), 'inv86-'))
  mkdirSync(join(dir, 'src/kit'), { recursive: true })
  mkdirSync(join(dir, 'scripts/data'), { recursive: true })
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    writeAll(
      catalog: CatalogDim[],
      mapping: MappingDim[],
      lex: LexEntry[],
      extras: MappingExtras = {},
    ) {
      writeFileSync(join(dir, 'src/kit/catalog.json'), JSON.stringify(catalog))
      writeFileSync(
        join(dir, 'src/kit/canonical-mapping.json'),
        JSON.stringify({ dimensions: mapping, ...extras }),
      )
      writeFileSync(join(dir, 'scripts/data/redaction-lexicon.json'), JSON.stringify(lex))
    },
    touchFile(relPath: string) {
      const abs = join(dir, relPath)
      mkdirSync(resolve(abs, '..'), { recursive: true })
      writeFileSync(abs, '// fixture file\n')
    },
  }
}

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function catDim(o: Partial<CatalogDim> = {}): CatalogDim {
  return { id: 'N01', name: 'Dependency Review', tml: 'L1', gate: 'BLOCKING', ...o }
}

function mapDim(o: Partial<MappingDim> = {}): MappingDim {
  return {
    id: 1,
    canonical_id: 'N01',
    name: 'Dependency Review',
    tml_source: 'L1',
    gate_type: 'BLOCKING',
    disposition: 'done',
    implementing_wave: null,
    invariant_id: null,
    framework_realization: {},
    ...o,
  }
}

const emptyLex: LexEntry[] = []

// ─── Coverage ─────────────────────────────────────────────────────────────────

describe('coverage parity', () => {
  it('exits 0 when catalog and mapping are in sync', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll([catDim()], [mapDim()], emptyLex)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when catalog dim missing from mapping', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll([catDim(), catDim({ id: 'N02', name: 'Extra' })], [mapDim()], emptyLex)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('N02')
      expect(r.stdout).toContain('[coverage]')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when mapping has canonical_id not in catalog', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim()],
        [mapDim(), mapDim({ id: 2, canonical_id: 'N99', name: 'Ghost' })],
        emptyLex,
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('N99')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when mapping entry missing canonical_id', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      const dim = mapDim()
      delete (dim as Partial<MappingDim>).canonical_id
      writeAll([catDim()], [dim], emptyLex)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[coverage]')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when duplicate canonical_id in mapping', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll([catDim()], [mapDim(), mapDim({ id: 2 })], emptyLex)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('duplicate')
    } finally {
      cleanup()
    }
  })
})

// ─── Field parity ─────────────────────────────────────────────────────────────

describe('field parity', () => {
  it('exits 1 on name mismatch', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll([catDim()], [mapDim({ name: 'Wrong Name' })], emptyLex)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[field]')
      expect(r.stdout).toContain('N01 name')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when names match after NFC normalization', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      // NFC-identical strings should pass
      const name = 'Dependency Review'
      writeAll([catDim({ name })], [mapDim({ name: name.normalize('NFC') })], emptyLex)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 on tml mismatch', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll([catDim({ tml: 'L1' })], [mapDim({ tml_source: 'L2' })], emptyLex)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[field]')
      expect(r.stdout).toContain('tml')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when gate_type has suffix stripped to match catalog gate', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'BLOCKING' })],
        [mapDim({ gate_type: 'BLOCKING (nightly)' })],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 on gate mismatch after suffix strip', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll([catDim({ gate: 'ADVISORY' })], [mapDim({ gate_type: 'BLOCKING' })], emptyLex)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[field]')
    } finally {
      cleanup()
    }
  })
})

// ─── Enforcement coverage ─────────────────────────────────────────────────────

describe('enforcement coverage (BLOCKING dims)', () => {
  it('exits 0 when BLOCKING + adopt-framework + W4 wave (no other enforcement)', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'BLOCKING' })],
        [
          mapDim({
            gate_type: 'BLOCKING',
            disposition: 'adopt-framework',
            implementing_wave: 'W4',
          }),
        ],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when BLOCKING + stack-adapter + W5 wave', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'BLOCKING' })],
        [mapDim({ gate_type: 'BLOCKING', disposition: 'stack-adapter', implementing_wave: 'W5' })],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when BLOCKING + done disposition (no wave needed)', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'BLOCKING' })],
        [mapDim({ gate_type: 'BLOCKING', disposition: 'done', implementing_wave: null })],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when BLOCKING + invariant_id set', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'BLOCKING' })],
        [
          mapDim({
            gate_type: 'BLOCKING',
            disposition: 'adopt-self',
            implementing_wave: null,
            invariant_id: 'INV-01',
          }),
        ],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when BLOCKING + framework_realization.generator set', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'BLOCKING' })],
        [
          mapDim({
            gate_type: 'BLOCKING',
            disposition: 'adopt-self',
            implementing_wave: null,
            framework_realization: { generator: 'planned:kit.ts' },
          }),
        ],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when BLOCKING + adopt-framework + F2 wave (F-wave rejected)', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'BLOCKING' })],
        [
          mapDim({
            gate_type: 'BLOCKING',
            disposition: 'adopt-framework',
            implementing_wave: 'F2',
            invariant_id: null,
            framework_realization: {},
          }),
        ],
        emptyLex,
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[enforcement]')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when BLOCKING + adopt-framework + null wave', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'BLOCKING' })],
        [
          mapDim({
            gate_type: 'BLOCKING',
            disposition: 'adopt-framework',
            implementing_wave: null,
            invariant_id: null,
            framework_realization: {},
          }),
        ],
        emptyLex,
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[enforcement]')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when BLOCKING + adopt-self + no enforcement + no wave', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'BLOCKING' })],
        [
          mapDim({
            gate_type: 'BLOCKING',
            disposition: 'adopt-self',
            implementing_wave: null,
            invariant_id: null,
            framework_realization: {},
          }),
        ],
        emptyLex,
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[enforcement]')
    } finally {
      cleanup()
    }
  })

  it('exits 0 for ADVISORY dim with no enforcement (only BLOCKING gated)', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'ADVISORY' })],
        [
          mapDim({
            gate_type: 'ADVISORY',
            disposition: 'adopt-self',
            implementing_wave: null,
            invariant_id: null,
            framework_realization: {},
          }),
        ],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── Error handling (exit 2) ──────────────────────────────────────────────────

describe('error handling', () => {
  it('exits 2 on malformed catalog JSON', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeFileSync(join(dir, 'src/kit/catalog.json'), 'not json {{{')
      writeFileSync(join(dir, 'src/kit/canonical-mapping.json'), JSON.stringify({ dimensions: [] }))
      writeFileSync(join(dir, 'scripts/data/redaction-lexicon.json'), JSON.stringify([]))
      const r = run(dir)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('ERROR')
    } finally {
      cleanup()
    }
  })

  it('exits 2 on malformed mapping JSON', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeFileSync(join(dir, 'src/kit/catalog.json'), JSON.stringify([]))
      writeFileSync(join(dir, 'src/kit/canonical-mapping.json'), '{ broken')
      writeFileSync(join(dir, 'scripts/data/redaction-lexicon.json'), JSON.stringify([]))
      const r = run(dir)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('ERROR')
    } finally {
      cleanup()
    }
  })

  it('exits 2 when catalog file missing', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // catalog.json not written
      writeFileSync(join(dir, 'src/kit/canonical-mapping.json'), JSON.stringify({ dimensions: [] }))
      writeFileSync(join(dir, 'scripts/data/redaction-lexicon.json'), JSON.stringify([]))
      const r = run(dir)
      expect(r.status).toBe(2)
    } finally {
      cleanup()
    }
  })
})

// ─── Redaction ────────────────────────────────────────────────────────────────

describe('redaction scan', () => {
  it('exits 0 when lexicon is empty (no tokens to match)', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll([catDim()], [mapDim()], [])
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when catalog contains a redacted token', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // Embed token directly in a catalog field
      const badCatalog = [catDim({ name: 'Uses @Component annotation' })]
      writeFileSync(join(dir, 'src/kit/catalog.json'), JSON.stringify(badCatalog))
      writeFileSync(
        join(dir, 'src/kit/canonical-mapping.json'),
        JSON.stringify({ dimensions: [mapDim({ name: 'Uses @Component annotation' })] }),
      )
      writeFileSync(
        join(dir, 'scripts/data/redaction-lexicon.json'),
        JSON.stringify([{ token: '@Component' }]),
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[redaction]')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when token appears only in allowContext line', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // The $schema line has "@Component" but allowContext = "$schema"
      const catalogWithSchema = [catDim()]
      writeFileSync(join(dir, 'src/kit/catalog.json'), JSON.stringify(catalogWithSchema))
      // mapping has $schema line containing the token
      const mappingContent = `{"$schema": "path/@Component.json", "dimensions": [${JSON.stringify(mapDim())}]}`
      writeFileSync(join(dir, 'src/kit/canonical-mapping.json'), mappingContent)
      writeFileSync(
        join(dir, 'scripts/data/redaction-lexicon.json'),
        JSON.stringify([{ token: '@Component', allowContext: '$schema' }]),
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── Rule 5: provenance integrity (R-08) ──────────────────────────────────────

describe('provenance integrity (import_source vs framework_realization.docs)', () => {
  it('exits 0 when no row carries import_source (rule inapplicable)', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll([catDim()], [mapDim()], emptyLex)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when import_name slug matches the docs pointer', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim()],
        [
          mapDim({
            import_source: { import_id: 1, import_name: 'OWASP dependency-check' },
            framework_realization: { docs: 'docs/REFERENCE/dim-015-owasp-dependency-check.md' },
          }),
        ],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the docs slug is a truncated prefix of the full name slug', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim()],
        [
          mapDim({
            import_source: {
              import_id: 1,
              import_name: 'Ship stage (Docker+Trivy+deploy)',
            },
            framework_realization: { docs: 'docs/REFERENCE/dim-037-ship-stage-docker-tri.md' },
          }),
        ],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when import_name does not match the docs pointer (positional-join regression)', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim()],
        [
          mapDim({
            import_source: { import_id: 1, import_name: 'SecurityConfig hardening' },
            framework_realization: { docs: 'docs/REFERENCE/dim-015-owasp-dependency-check.md' },
          }),
        ],
        emptyLex,
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[provenance]')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when framework_realization.docs is null (rule inapplicable)', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim()],
        [
          mapDim({
            import_source: { import_id: 1, import_name: 'Anything at all' },
            framework_realization: { docs: null },
          }),
        ],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── Rule 6: phantom-path existence (R-13) ────────────────────────────────────

describe('phantom-path existence (framework_realization template/generator/validator)', () => {
  it('exits 0 when template is null', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'ADVISORY' })],
        [mapDim({ gate_type: 'ADVISORY', framework_realization: {} })],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when template is "planned:"-prefixed even though the path does not exist', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'ADVISORY' })],
        [
          mapDim({
            gate_type: 'ADVISORY',
            framework_realization: { template: 'planned:src/templates/ghost.ejs' },
          }),
        ],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when template path has no "planned:" prefix and does not exist on disk', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim({ gate: 'ADVISORY' })],
        [
          mapDim({
            gate_type: 'ADVISORY',
            framework_realization: { template: 'src/templates/ghost.ejs' },
          }),
        ],
        emptyLex,
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[phantom]')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when template path exists on disk relative to the run root', () => {
    const { dir, cleanup, writeAll, touchFile } = makeTemp()
    try {
      touchFile('src/templates/real.ejs')
      writeAll(
        [catDim({ gate: 'ADVISORY' })],
        [
          mapDim({
            gate_type: 'ADVISORY',
            framework_realization: { template: 'src/templates/real.ejs' },
          }),
        ],
        emptyLex,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── Rule 7: crosswalk referential integrity ─────────────────────────────────

describe('crosswalk referential integrity (import_total-gated)', () => {
  it('exits 0 (rule skipped) when import_total is absent, even with gaps', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll([catDim()], [mapDim({ import_source: { import_id: 1, import_name: 'x' } })], emptyLex)
      // import_id 2 is never mentioned anywhere — would fail Rule 7 if it ran.
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when every import_id 1..N is covered via import_source + unmapped_import_dims', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim()],
        [mapDim({ import_source: { import_id: 1, import_name: 'x' } })],
        emptyLex,
        { unmapped_import_dims: [{ import_id: 2 }, { import_id: 3 }], import_total: 3 },
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an import_id is missing from both import_source and unmapped_import_dims', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim()],
        [mapDim({ import_source: { import_id: 1, import_name: 'x' } })],
        emptyLex,
        { unmapped_import_dims: [{ import_id: 2 }], import_total: 3 },
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[crosswalk]')
      expect(r.stdout).toContain('import_id 3 missing')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an import_id is attached to two different canonical rows', () => {
    const { dir, cleanup, writeAll } = makeTemp()
    try {
      writeAll(
        [catDim(), catDim({ id: 'N02', name: 'Extra' })],
        [
          mapDim({ import_source: { import_id: 1, import_name: 'x' } }),
          mapDim({
            id: 2,
            canonical_id: 'N02',
            name: 'Extra',
            import_source: { import_id: 1, import_name: 'x' },
          }),
        ],
        emptyLex,
        { import_total: 1 },
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[crosswalk]')
      expect(r.stdout).toContain('attached to both')
    } finally {
      cleanup()
    }
  })
})

// ─── Live regression guard ────────────────────────────────────────────────────

describe('live regression (committed files)', () => {
  it('exits 0 against committed catalog + mapping + lexicon', () => {
    // Run from project root — tests the real data
    const r = spawnSync('node', [SCRIPT], {
      encoding: 'utf-8',
      cwd: resolve('.'),
    })
    expect(r.status, r.stdout + r.stderr).toBe(0)
  })
})
