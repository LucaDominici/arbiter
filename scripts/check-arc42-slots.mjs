#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: arc42 is twelve enumerable slots, not twelve paragraphs. This gate turns the
// CATALOG: architecture document into an addressable structure: it parses the arc42 doc into
// CATALOG: ARC-01..ARC-12, reports which slots the project's document actually carries, and fails when
// CATALOG: a project has LOST a slot its own skeleton provides. The stub count — a slot whose body
// CATALOG: is nothing but the skeleton's prompt comment — rides a monotone ratchet, so a project
// CATALOG: may leave sections unfilled but may never add an unfilled one.
// CATALOG: rejected a keyword scan for TODO/TBD markers, which was the first design: run over
// CATALOG: arbiter's own arc42 it produced three false positives, all of them prose ABOUT todo
// CATALOG: gates and a technical-debt count. A stub is recognised structurally instead — the body,
// CATALOG: with HTML comments and whitespace removed, is empty or is exactly one placeholder token.
// CATALOG: rejected inventing a per-tier list of required sections: src/generators/doc-set.ts
// CATALOG: already decides which skeleton a tier receives (canvas for solo/small, full for
// CATALOG: enterprise). The required set is READ from that skeleton, so this gate can never hold a
// CATALOG: second opinion about what a tier owes, and adding a section to a skeleton automatically
// CATALOG: makes it required of the projects that receive it. The converse is guarded by a second
// CATALOG: ratchet over the skeleton's OWN gaps against canonical ARC-01..ARC-12: without it, deleting a
// CATALOG: section from a skeleton would quietly lower the bar for every project that receives it,
// CATALOG: and the gate would report the weakened bar as a pass.
// CATALOG: rejected fold-in into check-doc-set.mjs because that gate answers "does the
// CATALOG: architecture document exist and is it fresh" — a presence question over 55 rows. This
// CATALOG: one answers "is the document structurally complete", for exactly one row, and folding
// CATALOG: them would make a missing file and a hollow file the same failure.
//
// scripts/check-arc42-slots.mjs
// L1 gate (INV-144): the architecture document is a filled structure, not a surviving skeleton.
//
// Usage: node scripts/check-arc42-slots.mjs [--dir <repo>] [--json] [--update-baseline]
// --dir names the tree to AUDIT; the arc42 skeletons are read from this script's own install root
// (override with --skeleton-root, which exists so the split is an explicit seam rather than an
// implicit one), so auditing a governed project holds it to the skeleton it was generated from.
// There is deliberately no --allow-increase: a rise in the stub count is legitimised by
// hand-editing scripts/data/arc42-baseline.json in the same PR as the section that caused it.
// Exit: 0 pass, 1 violation, 2 error (INV-53).
//
// Exports for unit tests: SLOTS, normalizeHeading, slotForHeading, splitSections, isStub,
// analyzeDocument, skeletonSlots, skeletonGaps

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  loadOverlays,
  loadTierColumn,
  resolveEffectiveColumn,
  resolvePresentPaths,
} from './lib/doc-set-resolve.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const SELF_ROOT = resolve(scriptDir, '..')
const MANIFEST_REL = join('standards', 'gold-doc-set.yml')
const BASELINE_REL = join('scripts', 'data', 'arc42-baseline.json')
const SKELETON_FILE_FOR_COLUMN = {
  solo: 'arc42-canvas.md.ejs',
  small: 'arc42-canvas.md.ejs',
  enterprise: 'arc42-full.md.ejs',
}
// Two layouts, and the gate must read the right one in each. A dev checkout has `src/templates`
// (the source of truth) AND a `dist/templates` copy that `npm run build` refreshes — reading dist
// there would grade an edited skeleton against a stale build. The published package has only
// `dist/`, because `npm run build` does `cp -r src/templates dist/templates` and `src/` is not in
// package.json `files` — which is why a constant pointing at `src/templates/...` resolved in this
// checkout and NOWHERE else, a silent permanent SKIP for every consumer. Source first, shipped
// second: correct in both, and the fallback is what makes the consumer case work at all.
const SKELETON_ROOTS = [join('src', 'templates'), join('dist', 'templates')]
/** Formats the arc42 doc-set row admits that are NOT arc42 and must not be graded as one. */
const NON_ARC42_ALIASES = /(^|\/)(blueprint|c4-model)\.md$/i

/**
 * The twelve arc42 slots. `names` are anchored patterns matched against a NORMALIZED heading,
 * so a document may number its sections, use `&`, or use the short form, and still resolve.
 * A heading matching no slot is an ADDITION, which arc42 explicitly permits and this gate ignores.
 */
export const SLOTS = [
  {
    id: 'ARC-01',
    title: 'Introduction and Goals',
    // `goals` and `purpose` are deliberately NOT standalone aliases: arc42's own subsection 1.2
    // is "Quality goals", and a `## 1.2 Quality goals` has its numbering stripped and would then
    // satisfy a slot, letting a filled subsection mask a hollow parent section.
    names: /^(introduction|introduction and goals|about)$/,
  },
  {
    id: 'ARC-02',
    title: 'Constraints',
    names: /^((architecture|architectural|technical) )?constraints$/,
  },
  {
    id: 'ARC-03',
    title: 'Context and Scope',
    // arc42 v8 splits section 3 into "Business Context" and "Technical Context"; both are the
    // same slot. Bare `scope` is dropped — it is a common subsection heading inside section 1.
    names:
      /^(context|context and scope|scope and context|system context|system scope|business context|technical context)$/,
  },
  { id: 'ARC-04', title: 'Solution Strategy', names: /^(solution strategy|strategy)$/ },
  {
    id: 'ARC-05',
    title: 'Building Block View',
    names: /^(building blocks?|building blocks? view)$/,
  },
  { id: 'ARC-06', title: 'Runtime View', names: /^(runtime|runtime view|runtime scenarios)$/ },
  {
    id: 'ARC-07',
    title: 'Deployment View',
    names: /^(deployment|deployment view|infrastructure)$/,
  },
  {
    id: 'ARC-08',
    title: 'Crosscutting Concepts',
    names: /^(cross ?cutting( concepts)?)$/,
  },
  {
    id: 'ARC-09',
    title: 'Architecture Decisions',
    names: /^((architecture|architectural|design) )?decisions$/,
  },
  {
    id: 'ARC-10',
    title: 'Quality Requirements',
    // `quality goals` dropped for the same reason as ARC-01's: it is arc42's subsection 1.2.
    names: /^(quality|quality requirements|quality scenarios|quality tree)$/,
  },
  {
    id: 'ARC-11',
    title: 'Risks and Technical Debt',
    // Plural `debts` is the official arc42 v8 EN title; a document copied verbatim from
    // arc42.org failed this gate until it was added.
    names: /^(risks?|risks? and technical debts?|technical debts?)$/,
  },
  { id: 'ARC-12', title: 'Glossary', names: /^(glossary|terminology)$/ },
]

/** A body that is exactly one of these, and nothing else, is a placeholder rather than content. */
const PLACEHOLDER_BODY =
  /^(tbd|todo|t\.b\.d|n\/a|na|none|nothing|xxx|to be determined|to be defined|\?+|[\u2010-\u2015-]+|_+)$/

/**
 * Heading text -> comparable token: drop leading section numbering (`3.`, `3.1`, `ARC-03 —`),
 * spell `&` as `and`, drop trailing punctuation, lowercase, collapse whitespace.
 */
export function normalizeHeading(raw) {
  return (
    raw
      .replace(/^\s*(?:(?:ARC-)?[Aa]?\d+(?:\.\d+)*)\s*[.):—–-]*\s*/i, '')
      .replace(/&/g, ' and ')
      // Hyphens are a typographic choice, not a semantic one: `Cross-cutting`, `Cross cutting` and
      // `Crosscutting` are the same arc42 slot, and a slot matcher that disagreed would be a bug
      // that reads as a missing section.
      .replace(/[\u2010-\u2015-]+/g, ' ')
      .replace(/[.:;,]+\s*$/, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  )
}

/** The slot id a heading fills, or null when the heading is an addition. */
export function slotForHeading(raw) {
  const norm = normalizeHeading(raw)
  const hit = SLOTS.find((s) => s.names.test(norm))
  return hit ? hit.id : null
}

/**
 * Split markdown into sections. Three things this must get right, each of which was a live defeat:
 *
 *  - HTML comments are stripped FIRST. A document wrapped entirely in `<!-- ... -->` renders as
 *    nothing, but slicing it into sections before stripping gave every slot a body containing the
 *    unbalanced `-->` residue, which `isStub` then read as content: a blank page scored 12/12.
 *  - The section level is DETECTED, not assumed. arc42's own single-file markdown template uses
 *    `# 1. Introduction and Goals`; assuming `##` scored such a document 0, which after the
 *    score-0 rule became a hard failure on a textbook-correct file.
 *  - Fenced blocks are skipped so a `## ` inside an example is not a section, and an UNTERMINATED
 *    fence is ignored rather than swallowing every heading after it.
 */
export function splitSections(markdown) {
  const text = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const level = detectSectionLevel(text)
  return sectionsAtLevel(text, level)
}

/** Headings at one level, fenced regions excluded. */
/** Fence state after a line: null when open text, else the open fence. CommonMark closes a fence
 *  only with a run of the SAME char at least as long as the opener, so a ``` cannot close a ````. */
function nextFenceState(fence, line, i) {
  const hit = /^\s*(```+|~~~+)/.exec(line)
  if (!hit) return { fence, isFenceLine: false }
  if (fence === null)
    return { fence: { char: hit[1][0], len: hit[1].length, at: i }, isFenceLine: true }
  const closes = hit[1][0] === fence.char && hit[1].length >= fence.len
  return { fence: closes ? null : fence, isFenceLine: true }
}

function headingsAtLevel(text, level) {
  const re = new RegExp(`^ {0,3}#{${level}}\\s+(.*\\S?)\\s*$`)
  const lines = text.split('\n')
  const readHeading = (i) => {
    const m = re.exec(lines[i])
    return m ? { line: i, heading: m[1].replace(/\s+#+\s*$/, '') } : null
  }
  const out = []
  let fence = null
  for (let i = 0; i < lines.length; i += 1) {
    const step = nextFenceState(fence, lines[i], i)
    fence = step.fence
    if (step.isFenceLine || fence !== null) continue
    const h = readHeading(i)
    if (h) out.push(h)
  }
  // An unterminated fence must not swallow the rest of the document: re-scan from its opener as
  // ordinary text rather than reporting every later section as absent.
  if (fence !== null) {
    for (let i = fence.at + 1; i < lines.length; i += 1) {
      const h = readHeading(i)
      if (h) out.push(h)
    }
    out.sort((a, b) => a.line - b.line)
  }
  return out
}

/** The heading level this document actually uses for its arc42 sections. */
function detectSectionLevel(text) {
  // `##` is the default and the tie-breaker: it is what both arbiter skeletons and the great
  // majority of arc42 documents use. Another level wins only by matching STRICTLY more slots, so
  // a document whose headings match nothing (or match equally) is still read at `##` rather than
  // silently reinterpreted at a level that happens to find nothing.
  const scoreAt = (level) =>
    headingsAtLevel(text, level).filter((h) => slotForHeading(h.heading) !== null).length
  let best = 2
  let bestScore = scoreAt(2)
  for (const level of [1, 3]) {
    const score = scoreAt(level)
    if (score > bestScore) {
      bestScore = score
      best = level
    }
  }
  return best
}

function sectionsAtLevel(text, level) {
  const lines = text.split('\n')
  const heads = headingsAtLevel(text, level)
  return heads.map((h, i) => ({
    heading: h.heading,
    body: lines
      .slice(h.line + 1, i + 1 < heads.length ? heads[i + 1].line : lines.length)
      .join('\n'),
  }))
}

/** A section is a stub when nothing but the skeleton's own prompt comment survives stripping. */
export function isStub(body) {
  const stripped = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*#{3,}\s.*$/gm, '')
    .trim()
  const bare = stripped.toLowerCase().replace(/[.!]+$/, '')
  return stripped === '' || PLACEHOLDER_BODY.test(bare)
}

/** Slot ids a markdown document carries, and which of those are stubs. */
export function analyzeDocument(markdown) {
  const present = new Map()
  for (const section of splitSections(markdown)) {
    const slot = slotForHeading(section.heading)
    if (slot === null) continue
    // A slot claimed twice (e.g. `## Risks` and `## Technical debt`) counts as filled if EITHER
    // half carries content — splitting a slot across two headings is a formatting choice, not a gap.
    const stub = isStub(section.body)
    if (!present.has(slot) || present.get(slot) === true) present.set(slot, stub)
  }
  return {
    slots: [...present.keys()].sort(),
    stubs: [...present.entries()]
      .filter(([, stub]) => stub)
      .map(([id]) => id)
      .sort(),
  }
}

/** The slot ids the skeleton for a tier column provides — the required set, read not invented. */
export function skeletonSlots(root, column) {
  const file = SKELETON_FILE_FOR_COLUMN[column] ?? SKELETON_FILE_FOR_COLUMN.enterprise
  for (const base of SKELETON_ROOTS) {
    const rel = join(base, 'docs', 'skeletons', file)
    if (existsSync(join(root, rel))) {
      return { rel, slots: analyzeDocument(readFileSync(join(root, rel), 'utf-8')).slots }
    }
  }
  return { rel: join(SKELETON_ROOTS[0], 'docs', 'skeletons', file), slots: null }
}

/** Every skeleton, not just this repo's column — ratchet #2 must protect the ones we do not run. */
export function allSkeletonSlots(root) {
  const out = {}
  for (const column of Object.keys(SKELETON_FILE_FOR_COLUMN)) {
    out[column] = skeletonSlots(root, column).slots
  }
  return out
}

/**
 * Canonical slots a skeleton does NOT provide. A gap is legitimate — the Canvas column drops
 * Crosscutting and Glossary on purpose — but it is RATCHETED, so dropping one more is a decision
 * that has to be written down rather than a side effect of editing a template.
 */
export function skeletonGaps(slots) {
  return SLOTS.filter((s) => !slots.includes(s.id)).map((s) => s.id)
}

/**
 * Gaps for EVERY column, not just the one this repo audits under. A single scalar keyed nothing:
 * it was measured on enterprise (0 gaps) while the Canvas really drops two, so a solo/small repo
 * was told a slot "was dropped" that never was, and arbiter's own CI never evaluated the Canvas at
 * all — leaving ratchet #2 inert for exactly the skeleton it exists to protect.
 */
export function gapsByColumn(perColumnSlots) {
  const out = {}
  for (const [column, slots] of Object.entries(perColumnSlots)) {
    // A MISSING skeleton is every slot gapped, not a column to quietly drop. Omitting it removed
    // that column from the ratchet entirely, so deleting a skeleton file did not lower the bar —
    // it deleted the bar.
    out[column] = slots === null ? SLOTS.map((x) => x.id) : skeletonGaps(slots)
  }
  return out
}

function loadJson(path, label) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf-8')) }
  } catch (err) {
    process.stderr.write(`check-arc42-slots: ERROR — ${label}: ${err.message}\n`)
    return { code: 2 }
  }
}

function resolveArc42Path(root) {
  const manifestPath = join(root, MANIFEST_REL)
  if (!existsSync(manifestPath)) return { skip: `no manifest at ${MANIFEST_REL}` }
  let manifest
  try {
    manifest = parseYaml(readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    process.stderr.write(`check-arc42-slots: ERROR — ${MANIFEST_REL}: ${err.message}\n`)
    return { code: 2 }
  }
  // The path list is READ from the arc42 row rather than restated here, so this gate and
  // check-doc-set.mjs can never disagree about where a project's architecture document lives.
  const row = (manifest.checks || []).find((c) => c.template === 'arc42')
  if (!row) return { skip: `no arc42 row in ${MANIFEST_REL}` }
  const found = resolvePresentPaths(row, root)
  if (found.length === 0)
    return { skip: 'no architecture document present (check-doc-set owns absence)' }
  // accept_any is an unordered set of aliases, so the first entry is NOT the arc42 — in arbiter's
  // own tree it resolves to a reading-order hub page. Score every present candidate and take the
  // one carrying the most slots: the document that is most arc42-shaped IS the arc42.
  const scored = found
    .map((rel) => ({ rel, slots: analyzeDocument(readFileSync(join(root, rel), 'utf-8')).slots }))
    .sort((a, b) => b.slots.length - a.slots.length || a.rel.localeCompare(b.rel))
  // The manifest's arc42 row deliberately admits non-arc42 formats too — `blueprint.md` and
  // `**/c4-model.md` are listed in its accept_any. Grading a C4 model against arc42's twelve slots
  // would hard-fail a project that legitimately chose C4, so those resolve to a SKIP: presence is
  // check-doc-set's business, and this gate has nothing to say about a format it does not model.
  if (NON_ARC42_ALIASES.test(scored[0].rel) && scored[0].slots.length === 0) {
    return {
      skip:
        `${scored[0].rel} is a non-arc42 architecture format the manifest admits ` +
        `(blueprint / c4-model) — check-doc-set owns its presence`,
    }
  }
  // Otherwise a zero-scoring candidate is NOT a skip. Replacing an arc42 with "# Architecture /
  // See the wiki." scored 0, skipped, exited 0 — and check-doc-set stayed green because the file
  // exists, so the two gates together certified "architecture documented" for a document with no
  // architecture in it. Report the score and let the caller turn it into a violation.
  return {
    path: scored[0].rel,
    score: scored[0].slots.length,
    candidates: scored.map((c) => `${c.rel}:${c.slots.length}`),
  }
}

function report(violations, summary, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ...summary, violations }, null, 2)}\n`)
  } else if (violations.length > 0) {
    process.stderr.write(`check-arc42-slots: FAIL — ${violations.length} violation(s)\n`)
    for (const v of violations) process.stderr.write(`  - ${v}\n`)
  } else {
    process.stdout.write(
      `check-arc42-slots: PASS — ${summary.doc}: ${summary.filled}/${summary.required} required ` +
        `slots filled, ${summary.stubs.length} stub(s) (baseline ${summary.baseline})\n`,
    )
  }
  return violations.length > 0 ? 1 : 0
}

/**
 * The required slot set, and where it came from. Inside arbiter the EJS skeleton is authoritative;
 * a governed project does not ship the skeletons, so the emitted `required` list in the baseline
 * is. When both exist they must agree — a divergence means the set governed projects are held to
 * has drifted from the skeleton they were built from, and that is reported, not reconciled.
 */
function resolveRequired(fromSkeleton, fromBaseline, skeletonRel) {
  const drift =
    fromSkeleton !== null && fromBaseline !== null && fromSkeleton.join() !== fromBaseline.join()
      ? [
          `${BASELINE_REL}: \`required\` is [${fromBaseline.join(', ')}] but ${skeletonRel} provides ` +
            `[${fromSkeleton.join(', ')}] — the set governed projects are held to has drifted from ` +
            `the skeleton they receive. Run --update-baseline.`,
        ]
      : []
  return { required: fromSkeleton ?? fromBaseline, drift }
}

/** The two ratchet verdicts: hollow slots in the document, canonical gaps in the skeleton. */
function ratchetViolations({ docPath, stubs, allowed, gapsByCol, allowedByCol }) {
  const out = []
  if (stubs.length > allowed) {
    out.push(
      `${docPath}: ${stubs.length} hollow slot(s) (${stubs.join(', ')}), baseline allows ` +
        `${allowed} — a section may be left unfilled, but a new unfilled one may not be added.`,
    )
  }
  // Every column, not just this repo's: a scalar keyed to the auditing column left the Canvas
  // skeleton — which arbiter's own CI never resolves — completely unguarded.
  for (const [col, gaps] of Object.entries(gapsByCol)) {
    const permitted = allowedByCol[col]
    if (typeof permitted !== 'number') {
      out.push(`${BASELINE_REL}: skeletonGaps has no entry for the "${col}" column`)
      continue
    }
    if (gaps.length > permitted) {
      out.push(
        `the "${col}" arc42 skeleton omits ${gaps.length} canonical slot(s) (${gaps.join(', ')}), ` +
          `baseline allows ${permitted} — a slot dropped from a skeleton lowers the bar for every ` +
          `project that receives it, so the drop lands in the baseline diff or not at all.`,
      )
    }
  }
  return out
}

/** Slots the document owes its skeleton and does not carry. */
function missingSlotViolations(required, carried, docPath, column, source) {
  return required
    .filter((id) => !carried.has(id))
    .map((id) => {
      const slot = SLOTS.find((s) => s.id === id) ?? { title: 'unknown slot id' }
      return (
        `${docPath}: slot ${id} (${slot.title}) is absent, but ${source} — the skeleton this ` +
        `project's "${column}" column receives — provides it. Either the section was removed from ` +
        `the document, or the column rose (a promoted collaborationMode or tier_floor raises the ` +
        `bar and does not backfill the document). Both are real gaps; add the section.`
      )
    })
}

/**
 * Write the baseline, creating `scripts/data/` if absent — a generated project has `scripts/` but
 * not `scripts/data/`, so the unguarded write was an ENOENT reported as a document violation.
 */
function persistBaseline(baselinePath, next) {
  mkdirSync(dirname(baselinePath), { recursive: true })
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`)
}

function updateBaseline(baselinePath, baseline, required, stubs, gapsByCol, allowed, allowedByCol) {
  const risen = []
  if (stubs > allowed) risen.push(`stubs ${allowed} -> ${stubs}`)
  const nextGaps = {}
  for (const [col, gaps] of Object.entries(gapsByCol)) {
    nextGaps[col] = gaps.length
    const permitted = allowedByCol[col]
    if (typeof permitted === 'number' && gaps.length > permitted) {
      risen.push(`skeletonGaps.${col} ${permitted} -> ${gaps.length}`)
    }
  }
  if (risen.length > 0) {
    process.stderr.write(
      `check-arc42-slots: refusing --update-baseline — ${risen.join(', ')}. ` +
        `Raise the number by hand, in the same PR as the section that needs it.\n`,
    )
    return 1
  }
  persistBaseline(baselinePath, { ...baseline, required, stubs, skeletonGaps: nextGaps })
  process.stdout.write(
    `check-arc42-slots: baseline updated — stubs ${stubs}, skeletonGaps ${JSON.stringify(nextGaps)}\n`,
  )
  return 0
}

/**
 * The four things argv decides. `--dir` is the tree to AUDIT and defaults to cwd, exactly as
 * check-doc-set.mjs is run by `arbiter doc-set`; `--skeleton-root` is where the arc42 skeletons
 * come from and defaults to arbiter's own install — the two are separate because in production
 * they ARE separate, and conflating them would hold a governed project to a skeleton it carries.
 */
function parseArgs(argv) {
  const dirIdx = argv.indexOf('--dir')
  const skelIdx = argv.indexOf('--skeleton-root')
  return {
    root: dirIdx === -1 ? process.cwd() : resolve(argv[dirIdx + 1]),
    skeletonRoot: skelIdx === -1 ? SELF_ROOT : resolve(argv[skelIdx + 1]),
    updateBaseline: argv.includes('--update-baseline'),
    json: argv.includes('--json'),
  }
}

/**
 * What the ratchet currently permits. With NO baseline file the gate records where the tree is
 * rather than failing it: a freshly generated project's arc42 is hollow by construction, and a
 * gate that made `arbiter init` produce a red repo would only teach people to delete the gate.
 * Deleting the baseline later to reset is possible and deliberate — it lands in the diff.
 */
/** A ratchet counter is a finite, non-negative integer — never Infinity, a float, or a string. */
function isCount(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/** Validate a DECLARED skeletonGaps map: right shape, every shipped column, no unknown column. */
function validateDeclaredGaps(declared, gapCount) {
  if (declared === undefined) return null
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    return (
      `${BASELINE_REL}: "skeletonGaps" is ${JSON.stringify(declared)}, not a per-column object ` +
      `— a scalar or array here left every column but the auditing one unguarded`
    )
  }
  for (const col of Object.keys(declared)) {
    // Object.hasOwn, not `in`: `'__proto__' in obj` is true for every object, so `in` let an
    // unknown key named __proto__ straight through.
    if (!Object.hasOwn(gapCount, col)) {
      return `${BASELINE_REL}: skeletonGaps names unknown column "${col}"`
    }
  }
  for (const col of Object.keys(gapCount)) {
    if (!isCount(declared[col])) {
      return (
        `${BASELINE_REL}: skeletonGaps."${col}" is ${JSON.stringify(declared[col])}, not a whole ` +
        `count — every shipped column must be pinned, or the unpinned one is unguarded`
      )
    }
  }
  return null
}

function allowancesFrom(baseline, stubCount, gapCount) {
  // A COUNT, not merely a number. `"0"` is a string; `1e999` is Infinity and would permit any
  // number of hollow slots forever; a float is not a count. Each looks innocuous in a diff and
  // each disabled the ratchet permanently while --json kept reporting health.
  if (baseline.stubs !== undefined && !isCount(baseline.stubs)) {
    return {
      error: `${BASELINE_REL}: "stubs" is ${JSON.stringify(baseline.stubs)}, not a whole count`,
    }
  }
  const declared = baseline.skeletonGaps
  const gapsError = validateDeclaredGaps(declared, gapCount)
  if (gapsError !== null) return { error: gapsError }

  const allowedByCol = {}
  for (const [col, gaps] of Object.entries(gapCount)) {
    // With no baseline at all, bootstrap from what we measured — the ONLY backfill allowed. A
    // DECLARED map is complete by the check above, so a missing key can never re-permit today's
    // count silently, which was the same laundering as a non-numeric counter one level down.
    allowedByCol[col] = declared === undefined ? gaps.length : declared[col]
  }
  return {
    allowed: typeof baseline.stubs === 'number' ? baseline.stubs : stubCount,
    allowedByCol,
  }
}

/** The document exists but carries no arc42 at all — check-doc-set cannot see this. */
function emptyDocumentViolation(located) {
  if (located.score !== 0) return []
  return [
    `${located.path}: carries none of the twelve arc42 slots (candidates scored: ` +
      `${located.candidates.join(', ')}) — the document exists, so check-doc-set is green, but ` +
      `there is no architecture in it. A file that answers no arc42 question is not an arc42.`,
  ]
}

/**
 * Arm the ratchet on a clean first run. Tolerating the count only in memory meant no governed
 * project ever grew a baseline, so `allowed` was recomputed as "whatever it is today" every run
 * and the ratchet was inert everywhere except this repo.
 *
 * No `required` in the seed: it is column-SPECIFIC, so seeding it under one column and later
 * promoting the tier reported a "drift" when only the column had changed. And a write failure is
 * a warning, never a failure — an audit gate must not need write access to reach a verdict it has
 * already computed (read-only checkouts, hardened containers).
 */
function seedBaselineIfAbsent(baselinePath, stubs, gapsByCol) {
  if (existsSync(baselinePath)) return
  const seeded = {}
  for (const [col, gaps] of Object.entries(gapsByCol)) seeded[col] = gaps.length
  try {
    persistBaseline(baselinePath, { stubs, skeletonGaps: seeded })
    // stderr, not stdout: under --json stdout must stay a single parseable document.
    process.stderr.write(`check-arc42-slots: seeded ${BASELINE_REL} — the ratchet is now armed\n`)
  } catch (err) {
    process.stderr.write(
      `check-arc42-slots: could not seed ${BASELINE_REL} (${err.message}) — verdict stands, but ` +
        `the ratchet stays unarmed until this file exists and is committed\n`,
    )
  }
}

function skip(why) {
  process.stdout.write(`check-arc42-slots: SKIP — ${why}\n`)
  // #2052: recognized marker so runCheck surfaces SKIP, not PASS, in the gate summary.
  process.stdout.write(`[SKIP] ${why}\n`)
  return 0
}

/** The tier column, the skeleton it names, and the baseline — or an exit code saying why not. */
function loadContext(root, skeletonRoot) {
  // The EFFECTIVE column, floor included — check-doc-set.mjs resolves it the same way, and a gate
  // that read the derived column alone would demand the Canvas of a repo the doc-set treats as
  // enterprise.
  const { tierFloor } = loadOverlays(root, join('standards', 'doc-profile'))
  const column = resolveEffectiveColumn(loadTierColumn(root), tierFloor)
  const { rel: skeletonRel, slots: fromSkeleton } = skeletonSlots(skeletonRoot, column)

  const baselinePath = join(root, BASELINE_REL)
  const loaded = existsSync(baselinePath) ? loadJson(baselinePath, BASELINE_REL) : { value: {} }
  if (loaded.code !== undefined) return { code: loaded.code }
  return {
    column,
    skeletonRel,
    fromSkeleton,
    baselinePath,
    baseline: loaded.value,
    fromBaseline: Array.isArray(loaded.value.required) ? loaded.value.required : null,
  }
}

function main() {
  const { root, skeletonRoot, updateBaseline: doUpdate, json } = parseArgs(process.argv.slice(2))

  const located = resolveArc42Path(root)
  if (located.code !== undefined) return located.code
  if (located.skip) return skip(located.skip)

  const ctx = loadContext(root, skeletonRoot)
  if (ctx.code !== undefined) return ctx.code
  const { column, skeletonRel, fromSkeleton, baselinePath, baseline, fromBaseline } = ctx

  const { required, drift } = resolveRequired(fromSkeleton, fromBaseline, skeletonRel)
  if (required === null) {
    return skip(`neither ${skeletonRel} nor a \`required\` list in ${BASELINE_REL} is present`)
  }

  const doc = analyzeDocument(readFileSync(join(root, located.path), 'utf-8'))
  const carried = new Set(doc.slots)
  // Every skeleton this arbiter ships, so a column nobody audits still cannot lose a slot.
  const gapsByCol = gapsByColumn(allSkeletonSlots(skeletonRoot))
  const allowances = allowancesFrom(baseline, doc.stubs.length, gapsByCol)
  if (allowances.error !== undefined) {
    process.stderr.write(`check-arc42-slots: ERROR — ${allowances.error}\n`)
    return 2
  }
  const { allowed, allowedByCol } = allowances
  const requiredSource = fromSkeleton !== null ? skeletonRel : BASELINE_REL

  if (doUpdate) {
    return updateBaseline(
      baselinePath,
      baseline,
      required,
      doc.stubs.length,
      gapsByCol,
      allowed,
      allowedByCol,
    )
  }

  const violations = [
    ...drift,
    ...missingSlotViolations(required, carried, located.path, column, requiredSource),
    ...ratchetViolations({
      docPath: located.path,
      stubs: doc.stubs,
      allowed,
      gapsByCol,
      allowedByCol,
    }),
  ]
  violations.unshift(...emptyDocumentViolation(located))

  const summary = {
    doc: located.path,
    column,
    requiredFrom: requiredSource,
    required: required.length,
    filled: required.filter((id) => carried.has(id) && !doc.stubs.includes(id)).length,
    present: doc.slots,
    stubs: doc.stubs,
    skeletonGaps: gapsByCol,
    baseline: allowed,
    baselineSkeletonGaps: allowedByCol,
  }

  if (violations.length === 0) seedBaselineIfAbsent(baselinePath, doc.stubs.length, gapsByCol)

  return report(violations, summary, json)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main())
  } catch (err) {
    process.stderr.write(`check-arc42-slots: ERROR — unexpected: ${err.message}\n`)
    // INV-53: an error is exit 2. Exiting 1 misfiled every EACCES/EISDIR/ENOENT as a document
    // gap — the gate accusing the architecture doc of a defect in the gate's own plumbing.
    process.exit(2)
  }
}
