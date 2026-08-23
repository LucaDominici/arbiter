// SPDX-License-Identifier: Apache-2.0
// #2330: ADR-103 was cited by number as the formal basis for every parallel-worktree
// write-agent — in `src/cli.ts`, `gate-exec.ts`, `worktree-prune.ts`, rule-50, the
// wave-drain skill and three `related:` blocks — while the file itself never existed
// (confirmed: no add/delete of `docs/internal/ADR/103*` anywhere in git history).
//
// This suite pins the reconstruction so it cannot silently rot back:
//   1. the ADR exists and carries the load-bearing clauses verbatim;
//   2. its `§N` headings still satisfy the `ADR-103 §2` / `§3` / `§4` citations that
//      live in shipped code and in issue #1896 — a renumbering here dangles them again;
//   3. rule-50 no longer states the two mechanisms the code contradicts;
//   4. no tracked doc still advertises the ADR as missing.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const ADR_PATH = join(repoRoot, 'docs', 'internal', 'ADR', '103-worktree-parallel-carveout.md')
const RULE_TEMPLATE = join(
  repoRoot,
  'src',
  'templates',
  'claude',
  'rules',
  '50-batch-execution.md',
)
const RULE_SELF = join(repoRoot, '.claude', 'rules', '50-batch-execution.md')
const WAVE_PRIMITIVES = join(repoRoot, 'docs', 'REFERENCE', 'wave-primitives.md')

const adr = (): string => readFileSync(ADR_PATH, 'utf-8')

describe('ADR-103 exists and matches the implemented primitives (#2330)', () => {
  it('the file the citations point at is present', () => {
    expect(
      existsSync(ADR_PATH),
      'every parallel dispatch in this repo is authorised by this document',
    ).toBe(true)
  })

  it('carries the frontmatter the ADR gates require', () => {
    const text = adr()
    // INV-107 (check-adr-index.mjs): canonical_id must equal the filename number.
    expect(text).toMatch(/^canonical_id: '103'$/m)
    // gen-ssot-core.mjs skips `kind/adr`; without the tag the ADR joins SSOT_CORE_SET.
    expect(text).toMatch(/kind\/adr/)
    // A superseded ADR is still readable — but this one is live (see the citation sweep below).
    expect(text).toMatch(/\*\*Status:\*\* Accepted/)
  })

  it('states all three carve-out conditions and that missing any one voids the exemption', () => {
    const text = adr()
    expect(text).toMatch(/dedicated worktree/i)
    expect(text).toMatch(/distinct branch/i)
    expect(text).toMatch(/disjoint/i)
    expect(text).toMatch(/voids the exemption/i)
    expect(text).toMatch(/ALL of the following/i)
  })

  it('keeps the three prohibitions that survive the carve-out', () => {
    const text = adr()
    expect(text).toMatch(/lockfile/i)
    expect(text).toMatch(/main working tree|main tree/i)
    expect(text).toMatch(/tag/i)
  })

  it('states the total lock order and the gate-exec leaf rule', () => {
    const text = adr()
    expect(text).toMatch(/gate-lock ≺ worktree-lock ≺ wave-claim/)
    expect(text).toMatch(/leaf/i)
    expect(text).toMatch(/\.arbiter\/\.lock/)
  })

  it('records the divergences between the surviving paraphrase and the code', () => {
    const text = adr()
    // The reconstruction must show its work, not transcribe the paraphrase.
    expect(text).toMatch(/Where the paraphrase and the code disagree/i)
    // D1: the open lock does not serialize branch creation.
    expect(text).toMatch(/worktree-open\.log\.json/)
    // D5 / RT-03: the `-o` trade-off is named, not asserted away.
    expect(text).toMatch(/-o|--close/)
  })

  it('is honest that it is a reconstruction, not a recovered original', () => {
    expect(adr()).toMatch(/reconstruct/i)
  })
})

describe('ADR-103 section numbering satisfies the live §N citations (#2330)', () => {
  // `gate-exec.ts` and `worktree-prune.ts` cite "ADR-103 §2"; `gate-exec.ts` cites
  // "ADR-103 §4"; issue #1896's title cites "ADR-103 §3". A body written on the bare
  // ADR template shape would dangle all four — the exact defect #2330 exists to close.
  const headings = (): string[] =>
    adr()
      .split('\n')
      .filter((l) => /^##+\s*§\d/.test(l))

  it('has §1 through §5 headings', () => {
    const found = headings().join('\n')
    for (const n of [1, 2, 3, 4, 5]) {
      expect(found, `ADR-103 §${n} heading missing`).toMatch(new RegExp(`§${n}[ .:—-]`))
    }
  })

  it('§2 is the deterministic-leaf-primitive section that gate-exec.ts cites', () => {
    const gateExec = readFileSync(join(repoRoot, 'src', 'commands', 'gate-exec.ts'), 'utf-8')
    const prune = readFileSync(join(repoRoot, 'src', 'commands', 'worktree-prune.ts'), 'utf-8')
    expect(gateExec, 'the citation this heading answers').toMatch(/ADR-103 §2/)
    expect(prune).toMatch(/ADR-103 §2/)
    const h2 = headings().find((l) => /§2/.test(l)) ?? ''
    expect(h2.toLowerCase()).toMatch(/primitive/)
  })

  it('§4 is the lock-ordering section that gate-exec.ts cites', () => {
    const gateExec = readFileSync(join(repoRoot, 'src', 'commands', 'gate-exec.ts'), 'utf-8')
    expect(gateExec).toMatch(/ADR-103 §4/)
    const h4 = headings().find((l) => /§4/.test(l)) ?? ''
    expect(h4.toLowerCase()).toMatch(/lock/)
  })

  it('§3 is the ship --batch deprecation window that issue #1896 cites', () => {
    const h3 = headings().find((l) => /§3/.test(l)) ?? ''
    expect(h3).toMatch(/batch/i)
    expect(adr()).toMatch(/ship --batch/)
  })
})

describe('rule-50 agrees with the reconstructed ADR (#2330)', () => {
  it('no longer claims the open lock serializes branch creation', () => {
    for (const p of [RULE_TEMPLATE, RULE_SELF]) {
      expect(
        readFileSync(p, 'utf-8'),
        `${p}: the lock is acquired AFTER \`git worktree add -b\` (worktree.ts:341 vs :352)`,
      ).not.toMatch(/Branch creation is serialized by the\s+worktree open lock/)
    }
  })

  it('no longer claims a process never holds two arbiter locks at once', () => {
    for (const p of [RULE_TEMPLATE, RULE_SELF]) {
      expect(
        readFileSync(p, 'utf-8'),
        `${p}: saveConfig nests kit.lock inside .arbiter/.lock (config.ts:28-55)`,
      ).not.toMatch(/a process never holds\s+two arbiter locks at once/)
    }
  })

  it('still carries the character-pinned lock order and cites the ADR', () => {
    const template = readFileSync(RULE_TEMPLATE, 'utf-8')
    expect(template).toMatch(/gate-lock ≺ worktree-lock ≺ wave-claim/)
    expect(template).toMatch(/ADR-103/)
    expect(readFileSync(WAVE_PRIMITIVES, 'utf-8')).toMatch(
      /gate-lock ≺ worktree-lock ≺ wave-claim/,
    )
  })
})

describe('no tracked doc still advertises ADR-103 as missing (#2330)', () => {
  // The gap was asserted in six architecture docs and one test header comment. A single
  // survivor re-opens the question the ADR answers, so scan rather than enumerate.
  const SCAN_ROOTS = ['docs/architecture', 'docs/REFERENCE', 'docs/methodology', '__tests__/docs']
  // Dated audit records are evidence of the past, not live claims about the tree; and this
  // file necessarily spells the phrases out in order to search for them.
  const EXCLUDE = ['docs/audit', 'adr-103-carveout.test.ts']

  const GAP_PHRASES = [
    /missing ADR-103/i,
    /ADR-103 \(missing file\)/i,
    /ADR-103 file missing/i,
    /There is no ADR-103/i,
    /gap at ADR-103/i,
    /ADR-103[^.\n]{0,40}does not exist/i,
  ]

  function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (EXCLUDE.some((e) => full.includes(e))) continue
      if (statSync(full).isDirectory()) walk(full, out)
      else if (['.md', '.ts'].includes(extname(full))) out.push(full)
    }
    return out
  }

  it('finds no gap assertion in the architecture, reference or methodology docs', () => {
    const offenders: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(repoRoot, root))) {
        const text = readFileSync(file, 'utf-8')
        for (const phrase of GAP_PHRASES) {
          const hit = phrase.exec(text)
          if (hit) offenders.push(`${file.slice(repoRoot.length + 1)}: ${hit[0]}`)
        }
      }
    }
    expect(offenders, 'ADR-103 now exists — these still say otherwise').toEqual([])
  })

  it('the generated ADR index lists 103 between 102 and 104', () => {
    const readme = readFileSync(join(repoRoot, 'docs', 'internal', 'ADR', 'README.md'), 'utf-8')
    expect(readme).toMatch(/103-worktree-parallel-carveout\.md/)
    const digest = join(repoRoot, 'docs', 'internal', 'SYSTEM', 'DECISIONS.md')
    expect(readFileSync(digest, 'utf-8')).toMatch(/103-worktree-parallel-carveout\.md/)
  })
})
