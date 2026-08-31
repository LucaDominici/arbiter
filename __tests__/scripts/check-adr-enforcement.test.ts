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
  opts: { registry?: string; catalog?: string; allowlist?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'adr-enf-'))
  try {
    mkdirSync(join(dir, 'docs', 'internal', 'ADR'), { recursive: true })
    mkdirSync(join(dir, 'standards'), { recursive: true })
    mkdirSync(join(dir, 'src', 'invariants'), { recursive: true })
    mkdirSync(join(dir, 'scripts', 'data'), { recursive: true })
    writeFileSync(join(dir, 'standards', 'gold-registry.yml'), opts.registry ?? DEFAULT_REGISTRY)
    writeFileSync(join(dir, 'src', 'invariants', 'catalog.ts'), opts.catalog ?? DEFAULT_CATALOG)
    if (opts.allowlist !== undefined) {
      writeFileSync(join(dir, 'scripts', 'data', 'adr-enforces-allowlist.json'), opts.allowlist)
    }
    for (const [name, body] of Object.entries(adrs)) {
      writeFileSync(join(dir, 'docs', 'internal', 'ADR', name), body)
    }
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: dir })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** ISO `YYYY-MM-DD`, `days` in the future (positive) or the past (negative). */
function isoDay(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** A numbered ADR file body — the shape the mandatory-`enforces:` rule is scoped to. */
function numberedAdr(
  num: string,
  status: string,
  enforces: string[] | null,
  slug = 'decision',
): { name: string; body: string } {
  const fm = enforces === null ? '' : `enforces: [${enforces.join(', ')}]\n`
  return {
    name: `${num}-${slug}.md`,
    body: `---\ntitle: 'ADR-${num}: t'\nstatus: ${status}\ncanonical_id: '${num}'\n${fm}---\n\n# ADR-${num}\n`,
  }
}

/** An allowlist document with one entry per `[file, expires, rationale]` triple. */
function allowlist(entries: [string, string, string][]): string {
  return JSON.stringify({
    schema: 'arbiter-adr-enforces-allowlist-v1',
    entries: entries.map(([adr, expires, rationale]) => ({ adr, expires, rationale })),
  })
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
})

// ─── #2419 AC-1: `enforces:` is MANDATORY for accepted/active ADRs ────────────
// Before #2419 the gate validated only the 3 of 120 ADRs that opted in with an `enforces:` key,
// so it could never fail: 111 active/accepted ADRs claimed nothing and were never asked to.
// The dated allowlist is the amnesty for the historical ones — and it expires.
describe('check-adr-enforcement — mandatory enforces (#2419 AC-1)', () => {
  it('FAILs an active NUMBERED ADR that declares no enforces and is not allowlisted', () => {
    const a = numberedAdr('021', 'active', null)
    const r = runGate({ [a.name]: a.body })
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/021-decision\.md/)
    expect(r.stderr + r.stdout).toMatch(/enforces/i)
  })

  it('FAILs an ACCEPTED numbered ADR that declares no enforces (accepted counts, not just active)', () => {
    const a = numberedAdr('022', 'accepted', null)
    expect(runGate({ [a.name]: a.body }).status).toBe(1)
  })

  it('FAILs a numbered ADR whose enforces: key is present but EMPTY (an empty claim is no claim)', () => {
    const body = `---\ntitle: 'ADR-023: t'\nstatus: active\ncanonical_id: '023'\nenforces:\n---\n\n# b\n`
    expect(runGate({ '023-empty.md': body }).status).toBe(1)
  })

  it('PASSes an active numbered ADR that declares a resolving enforces ref', () => {
    const a = numberedAdr('024', 'active', ['INV-59'])
    expect(runGate({ [a.name]: a.body }).status).toBe(0)
  })

  it('PASSes an allowlisted historical ADR with a FUTURE expires and a rationale', () => {
    const a = numberedAdr('025', 'active', null)
    const r = runGate(
      { [a.name]: a.body },
      { allowlist: allowlist([[a.name, isoDay(90), 'historical: predates the enforces contract']]) },
    )
    expect(r.status).toBe(0)
  })

  it('FAILs when the allowlist entry has EXPIRED (dated amnesty, not permanent)', () => {
    const a = numberedAdr('026', 'active', null)
    const r = runGate(
      { [a.name]: a.body },
      { allowlist: allowlist([[a.name, isoDay(-1), 'historical']]) },
    )
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/expire/i)
  })

  it('FAILs when the allowlist entry has no valid expires date at all', () => {
    const a = numberedAdr('027', 'active', null)
    const r = runGate(
      { [a.name]: a.body },
      { allowlist: allowlist([[a.name, 'someday', 'historical']]) },
    )
    expect(r.status).toBe(1)
  })

  it('FAILs when an allowlist entry carries no rationale', () => {
    const a = numberedAdr('028', 'active', null)
    const r = runGate({ [a.name]: a.body }, { allowlist: allowlist([[a.name, isoDay(90), '  ']]) })
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/rationale/i)
  })

  it('FAILs a STALE allowlist entry whose ADR now declares enforces (the list can only shrink)', () => {
    const a = numberedAdr('029', 'active', ['INV-59'])
    const r = runGate(
      { [a.name]: a.body },
      { allowlist: allowlist([[a.name, isoDay(90), 'historical']]) },
    )
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/stale|prune/i)
  })

  it('FAILs a STALE allowlist entry naming an ADR file that does not exist', () => {
    const a = numberedAdr('030', 'active', ['INV-59'])
    const r = runGate(
      { [a.name]: a.body },
      { allowlist: allowlist([['999-ghost.md', isoDay(90), 'historical']]) },
    )
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/999-ghost\.md/)
  })

  it('does NOT require enforces for superseded / deprecated / proposed / draft ADRs', () => {
    const files: Record<string, string> = {}
    for (const [i, status] of ['superseded', 'deprecated', 'proposed', 'draft'].entries()) {
      const a = numberedAdr(String(31 + i).padStart(3, '0'), status, null)
      files[a.name] = a.body
    }
    expect(runGate(files).status).toBe(0)
  })

  it('does NOT require enforces from non-ADR files in the directory (README / templates)', () => {
    const readme = `---\ntitle: 'ADRs'\nstatus: active\ncanonical_id: ''\n---\n\n# index\n`
    const tpl = `---\ntitle: 'template'\nstatus: active\ncanonical_id: ''\n---\n\n# tpl\n`
    const r = runGate({ 'README.md': readme, 'ADR-TEMPLATE.md': tpl, 'ADR-000_template.md': tpl })
    expect(r.status).toBe(0)
  })

  it('FAILs a numbered ADR whose frontmatter is unparseable — status is unverifiable (INV-96)', () => {
    const broken = `---\ntitle: 'x\nfoo: [unclosed\n---\n\n# body\n`
    const r = runGate({ '035-broken.md': broken })
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/unverifiable|unparseable/i)
  })

  it('names the unreadable allowlist as the cause rather than burying it under N missing lines', () => {
    const a = numberedAdr('036', 'active', null)
    const r = runGate({ [a.name]: a.body }, { allowlist: '{ not json' })
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/allowlist/i)
    expect(r.stderr + r.stdout).toMatch(/unreadable|unparseable|malformed/i)
  })
})
