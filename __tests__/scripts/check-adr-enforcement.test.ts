// SPDX-License-Identifier: Apache-2.0
// TDD: ADR → check enforcement linkage gate (epic #1469, Wave B #1473).
// `enforces: [GA-xx | INV-nn]` in an ADR frontmatter must resolve to a real gold-check id (the
// registry) or a real invariant (src/invariants/catalog.ts). A dangling ref ⇒ FAIL (else the ADR
// makes an unverifiable "we enforce X" claim — a fake-green).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-adr-enforcement.mjs')

const DEFAULT_REGISTRY =
  `version: '1.0.0'\nchecks:\n` +
  `  - id: GA-DOC-01\n    type: file_exists\n    args: { path: README.md }\n` +
  `  - id: TS-CFG-01\n    type: file_exists\n    args: { path: tsconfig.json }\n` // per-stack prefix

const DEFAULT_CATALOG = `export const INVARIANT_CATALOG = [\n  { id: 'INV-59', title: 'gate' },\n  { id: 'INV-127', title: 'render' },\n]\n`

/** Build a repo skeleton (registry + invariant catalog) and run the gate over the given ADRs. */
function runGate(
  adrs: Record<string, string>,
  opts: {
    registry?: string
    catalog?: string
    /** Coverage-ratchet pin. Omit for a permissive one; null omits the file entirely. */
    unclaimed?: number | null
    args?: string[]
  } = {},
): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'adr-enf-'))
  try {
    mkdirSync(join(dir, 'docs', 'internal', 'ADR'), { recursive: true })
    mkdirSync(join(dir, 'standards'), { recursive: true })
    mkdirSync(join(dir, 'src', 'invariants'), { recursive: true })
    // The coverage ratchet (#2480) reads a pinned count. Tests that do not care about it get a
    // permissive pin so they keep asserting only the linkage contract they were written for.
    if (opts.unclaimed !== null) {
      mkdirSync(join(dir, 'scripts', 'data'), { recursive: true })
      writeFileSync(
        join(dir, 'scripts', 'data', 'adr-enforcement-baseline.json'),
        JSON.stringify({ unclaimed: opts.unclaimed ?? 99 }),
      )
    }
    writeFileSync(join(dir, 'standards', 'gold-registry.yml'), opts.registry ?? DEFAULT_REGISTRY)
    writeFileSync(join(dir, 'src', 'invariants', 'catalog.ts'), opts.catalog ?? DEFAULT_CATALOG)
    for (const [name, body] of Object.entries(adrs)) {
      writeFileSync(join(dir, 'docs', 'internal', 'ADR', name), body)
    }
    const r = spawnSync('node', [SCRIPT, ...(opts.args ?? [])], { encoding: 'utf-8', cwd: dir })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function adr(id: string, enforces: string[] | null): string {
  const fm = enforces === null ? '' : `enforces: [${enforces.join(', ')}]\n`
  return `---\ntitle: 'ADR-${id}: test'\nstatus: active\ncanonical_id: '${id}'\n${fm}---\n\n# ADR-${id}\n`
}

describe('check-adr-enforcement gate (#1473)', () => {
  it('PASS when an ADR enforces a real gold-check id', () => {
    const r = runGate({ '001.md': adr('001', ['GA-DOC-01']) })
    expect(r.status).toBe(0)
  })

  it('PASS when an ADR enforces a real invariant id', () => {
    const r = runGate({ '002.md': adr('002', ['INV-59']) })
    expect(r.status).toBe(0)
  })

  it('PASS (vacuous) when no ADR declares an enforces key', () => {
    const r = runGate({ '003.md': adr('003', null) })
    expect(r.status).toBe(0)
  })

  it('FAIL on a dangling gold-check id', () => {
    const r = runGate({ '004.md': adr('004', ['GA-DOC-01', 'GA-NOPE-99']) })
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/GA-NOPE-99/)
  })

  it('FAIL on a dangling invariant id', () => {
    const r = runGate({ '005.md': adr('005', ['INV-999']) })
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/INV-999/)
  })

  it('FAIL on an unrecognized id shape (not GA-/INV-)', () => {
    const r = runGate({ '006.md': adr('006', ['REQ-001']) })
    expect(r.status).toBe(1)
  })

  it('PASS with multiple ADRs all enforcing real ids', () => {
    const r = runGate({
      '007.md': adr('007', ['GA-DOC-01']),
      '008.md': adr('008', ['INV-59', 'INV-127']),
    })
    expect(r.status).toBe(0)
  })

  // ── #1473 critic round 1 fixes ──────────────────────────────────────────────

  it('PASS on a real per-stack gold-check id (GO-/TS-/… prefix, not just GA-)', () => {
    const r = runGate({ '009.md': adr('009', ['TS-CFG-01']) })
    expect(r.status).toBe(0)
  })

  it('FAIL on a dangling per-stack gold-check id', () => {
    const r = runGate({ '010.md': adr('010', ['TS-NOPE-99']) })
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/TS-NOPE-99/)
  })

  it('FAIL (not silent skip) when an ADR declares enforces but the frontmatter is unparseable', () => {
    // Unbalanced YAML array — a dangling claim hidden behind broken frontmatter must NOT fake-green.
    const broken = `---\ntitle: 'x\nenforces: [GA-NOPE-99\n---\n\n# body\n`
    const r = runGate({ '011.md': broken })
    expect(r.status).toBe(1)
  })

  it('does NOT resolve an INV id that appears only in a catalog COMMENT (anti-fake-green)', () => {
    const r = runGate(
      { '012.md': adr('012', ['INV-200']) },
      {
        catalog: `// historical: removed entry had id: 'INV-200'\nexport const INVARIANT_CATALOG = []\n`,
      },
    )
    expect(r.status).toBe(1) // INV-200 lives only in a comment ⇒ dangling
  })

  it('PASS (vacuous) on a present-but-empty enforces: key', () => {
    const emptyEnforces = `---\ntitle: 'ADR-013: test'\ncanonical_id: '013'\nenforces:\n---\n\n# body\n`
    const r = runGate({ '013.md': emptyEnforces })
    expect(r.status).toBe(0)
  })

  it('FAIL on a CRLF-encoded ADR with a dangling ref (not silently dropped)', () => {
    const crlf = `---\r\ntitle: 'ADR-014: test'\r\nenforces: [GA-NOPE-99]\r\n---\r\n\r\n# body\r\n`
    const r = runGate({ '014.md': crlf })
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/GA-NOPE-99/)
  })

  // ── #1473 critic round 2 fixes ──────────────────────────────────────────────

  it('FAIL on a BOM-prefixed ADR with a dangling ref (BOM must not drop the fail-closed path)', () => {
    const bom = `\uFEFF---\nenforces: ['GA-NOPE-99']\n---\n\n# body\n`
    const r = runGate({ '015.md': bom })
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/GA-NOPE-99/)
  })

  it('FAIL on a leading-blank-line ADR with a dangling ref', () => {
    const blank = `\n\n---\nenforces: ['INV-999']\n---\n\n# body\n`
    const r = runGate({ '016.md': blank })
    expect(r.status).toBe(1)
  })

  it('does NOT resolve an INV id that exists only in a BLOCK comment (anti-fake-green)', () => {
    const r = runGate(
      { '017.md': adr('017', ['INV-200']) },
      { catalog: `export const C = [\n  /*\n  { id: 'INV-200' },\n  */\n  { id: 'INV-59' },\n]\n` },
    )
    expect(r.status).toBe(1) // INV-200 lives only in a block comment ⇒ dangling
  })

  it('does NOT resolve an INV id embedded in a multiline TEMPLATE literal (anti-fake-green)', () => {
    const r = runGate(
      { '019.md': adr('019', ['INV-9100']) },
      { catalog: "const EXAMPLE = `\n  id: 'INV-9100'\n`\nexport const C = [{ id: 'INV-59' }]\n" },
    )
    expect(r.status).toBe(1) // INV-9100 lives only inside a template literal ⇒ dangling
  })

  it('PASS when only the BODY (not the frontmatter) contains an enforces: line under broken FM', () => {
    // Unparseable frontmatter that declares NO enforces; a body line starts with "enforces:".
    const body = `---\ntitle: 'broken\nfoo: [unclosed\n---\n\nenforces: things we informally do\n`
    const r = runGate({ '018.md': body })
    // The broken FM declared no enforcement key — a body mention must not fabricate a FAIL.
    expect(r.status).toBe(0)
  })

  // #2480 — the coverage ratchet. The linkage contract above was OPT-IN: 115 of 118 numbered ADRs
  // declared nothing, so the gate passed while almost no decision named what keeps it true. These
  // cases pin the ratchet's real property — a fall is free, a rise is refused, and the refusal
  // cannot be laundered through --update-baseline.
  describe('coverage ratchet (#2480)', () => {
    const bare = (id: string) =>
      `---\ntitle: 'ADR-${id}'\nstatus: active\ncanonical_id: '${id}'\n---\n\n# ADR-${id}\n`
    const claiming = (id: string, ref: string) =>
      `---\ntitle: 'ADR-${id}'\nstatus: active\ncanonical_id: '${id}'\nenforces: ['${ref}']\n---\n\n# ADR-${id}\n`

    it('PASSES when the unclaimed count equals the pin', () => {
      const r = runGate({ '001-a.md': bare('001'), '002-b.md': bare('002') }, { unclaimed: 2 })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('2 ADR(s) declare none')
    })

    it('FAILS when a new ADR declares no enforcement', () => {
      const r = runGate(
        { '001-a.md': bare('001'), '002-b.md': bare('002'), '003-c.md': bare('003') },
        { unclaimed: 2 },
      )
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('baseline allows 2')
      expect(r.stderr).toContain('003-c.md')
    })

    it('PASSES freely when the count FALLS — paying the debt down needs no ceremony', () => {
      const r = runGate({ '001-a.md': claiming('001', 'INV-59') }, { unclaimed: 5 })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('0 ADR(s) declare none')
    })

    it('does not count templates or the generated README — they hold no decision', () => {
      const r = runGate(
        { 'ADR-000_template.md': bare('000'), 'README.md': bare('000'), '001-a.md': bare('001') },
        { unclaimed: 1 },
      )
      expect(r.status, r.stderr).toBe(0)
    })

    it('REFUSES --update-baseline when the count rose — the rise cannot be laundered', () => {
      const r = runGate(
        { '001-a.md': bare('001'), '002-b.md': bare('002') },
        {
          unclaimed: 1,
          args: ['--update-baseline'],
        },
      )
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('refusing --update-baseline')
    })

    it('accepts --update-baseline when the count fell', () => {
      const r = runGate({ '001-a.md': bare('001') }, { unclaimed: 9, args: ['--update-baseline'] })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('baseline updated')
    })

    it('FAILS when the baseline file is absent — a missing ratchet is not a vacuous pass', () => {
      const r = runGate({ '001-a.md': bare('001') }, { unclaimed: null })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('not found')
    })

    it('still FAILS a dangling ref before it ever reaches the ratchet', () => {
      const r = runGate({ '001-a.md': claiming('001', 'INV-999') }, { unclaimed: 0 })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('no such invariant id')
    })
  })
})
