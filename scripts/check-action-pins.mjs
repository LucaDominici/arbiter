#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — SHA-pin self-check gate (INV-76, enforced)
// Scans .github/workflows/ and .github/actions/ for non-SHA action refs.
// ALSO scans the workflow TEMPLATES arbiter SHIPS (src/templates/**/workflows/*.ejs): a
// fabricated/short/tag SHA in an .ejs template is emitted verbatim into a user's project, so a
// blind spot there ships a broken, unverifiable pin to consumers while the self-gate stays green.
// (#1491 / security-privacy MAJOR-3). Templated refs (action@<%= … %> / action@${ … }) are
// expression interpolation, not literal pins, and are skipped.
// Enforced (#886): any non-SHA remote action ref fails the gate (exit 1). Local composite
// actions (./…) and docker:// refs are exempt. All arbiter workflows + composite actions are
// 40-hex pinned, so this gate passes clean; a future tag-pinned ref is a hard stop.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { collectYamlFiles, collectWorkflowTemplates } from './lib/workflow-scan.mjs'

const CWD = process.cwd()

const onReadError = (dir, err) =>
  process.stderr.write(`  [check-action-pins] warn: cannot read ${dir}: ${err.message}\n`)

const yamlFiles = [
  ...collectYamlFiles(join(CWD, '.github', 'workflows'), { onReadError }),
  ...collectYamlFiles(join(CWD, '.github', 'actions'), { onReadError }),
]

// Workflow templates arbiter emits to user projects. A bad pin here never lands in arbiter's own
// .github/ (so the yaml scan above misses it) but ships to every generated project — fail-closed.
const templateFiles = collectWorkflowTemplates(join(CWD, 'src', 'templates'), { onReadError })

// SHA-pinned: exactly 40 hex characters after @  (case-insensitive per git convention)
const SHA_PATTERN = /^[0-9a-f]{40}$/i
// A templated ref is EJS output (<%= … %>) or a shell/GitHub expression (${ … } / ${{ … }})
// interpolated at render time, not a literal pin — it cannot be SHA-validated statically.
const TEMPLATED_REF = /^(?:<%|\$\{)/
// Matches 'uses: action@ref' and '- uses: action@ref'; captures action (group 1) and ref (group 2).
// USES_PATTERN requires leading whitespace; column-0 'uses:' is not valid GitHub Actions syntax.
const USES_PATTERN = /^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([^\s#"']+)["']?/gm
// Comment-truthfulness scan (#1614): captures action (1), 40-hex sha (2), and the trailing
// `# vN…` version label (3). A single immutable sha resolves to exactly ONE upstream release,
// so two pins of the SAME sha must not advertise DIFFERENT MAJOR versions. INV-76 verifies the
// sha is 40-hex but never that the human-readable label is truthful; sync-action-pins only
// reconciles same-named self/template pairs — so a sha mislabelled `# v9` when it is really v7
// ships to every generated project unflagged. `# v6` vs `# v6.0.3` is precision (same major),
// not a contradiction, and is tolerated; `# v9` vs `# v7` for one sha is a factual lie.
const USES_WITH_COMMENT =
  /^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([0-9a-fA-F]{40})["']?\s*#\s*(v\d+\S*)/gm
// Divergent-SHA scan (#1666): captures action (1), 40-hex sha (2), and the OPTIONAL
// trailing comment (3, may be a non-version label like `stable`/`master`, or absent).
// One immutable sha is ONE upstream release; pinning an action to >1 distinct sha
// WITHIN a single MAJOR is a dup-sha bug, while a split ACROSS majors is the only
// case a project may legitimately carry (e.g. a reusable workflow that must support
// an older major) — and only when explicitly declared in CROSS_MAJOR_ALLOWLIST.
const USES_WITH_OPTIONAL_COMMENT =
  /^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([0-9a-fA-F]{40})["']?\s*(?:#\s*([^\n]+?))?\s*$/gm

// #1666 — DECLARED cross-major splits: `action -> { effectiveMajor -> exact 40-hex sha }`.
// The ONLY allowlistable divergence. Each sha is gh-api-verified to resolve to a tag in
// that major. A within-major duplicate is NEVER allowlistable (it is always a bug); this
// table excuses only an intentional split across DIFFERENT majors. For 0ver actions the
// effective major is `0.<minor>` (semver-0 treats the minor as the breaking axis).
const CROSS_MAJOR_ALLOWLIST = {
  'actions/download-artifact': {
    4: 'd3f86a106a0bac45b974a628896c90dbdf5c8093', // v4.3.0
    8: '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', // v8.0.1
  },
  'actions/github-script': {
    7: 'f28e40c7f34bde8b3046d885e986cb6290c5673b', // v7.1.0
    9: '3a2844b7e9c422d3c10d287c895573f7108da1b3', // v9.0.0
  },
  'actions/setup-node': {
    4: '39370e3970a6d050c480ffad4ff0ed4d3fdee5af', // v4.1.0
    7: '820762786026740c76f36085b0efc47a31fe5020', // v7.0.0
  },
  'actions/upload-artifact': {
    4: 'ea165f8d65b6e75b540449e92b4886f43607fa02', // v4.6.2
    7: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', // v7.0.1
  },
  'gradle/actions/setup-gradle': {
    3: 'd9c87d481d55275bb5441eef3fe0e46805f9ef70', // v3
    4: 'ed408507eac070d1f99cc633dbcf757c94c7933a', // v4
    6: '9c971963bec38e04b3d30dcc455b5382be2fdbfb', // v6.3.0
  },
  'anchore/sbom-action': {
    0.9: 'f6c3d0fe42c3cf876e3462574e4c9416b5e0f07a', // v0.9.0
    0.24: 'e22c389904149dbc22b58101806040fa8d37a610', // v0.24.0
  },
}

// Effective MAJOR bucket from a version label: `vN[.M…]` → "N", except `v0.M…` → "0.M"
// (0ver). Returns null for a non-version label (e.g. `stable`, `master`).
const effectiveMajor = (label) => {
  const m = /^v(\d+)(?:\.(\d+))?/.exec(label)
  if (!m) return null
  if (m[1] === '0') return m[2] !== undefined ? `0.${m[2]}` : '0'
  return m[1]
}

// Bucket key for a sha given the labels seen for it across the corpus. Prefer the
// first version label's major; fall back to a normalized ref label (`branch:stable`
// and `stable` collapse to `ref:stable`); else `unlabeled`. Computed per-SHA so the
// SAME sha appearing both with and without a comment stays one bucket (no false split).
const bucketOfSha = (labels) => {
  for (const l of labels) {
    const major = effectiveMajor(l)
    if (major !== null) return major
  }
  for (const l of labels) return `ref:${l.replace(/^branch:/, '')}`
  return 'unlabeled'
}

const violations = []
const scan = (file, content) => {
  for (const match of content.matchAll(USES_PATTERN)) {
    const action = match[1]
    const ref = match[2]
    if (action.startsWith('.')) continue
    if (action.startsWith('docker://')) continue
    if (TEMPLATED_REF.test(ref)) continue
    if (!SHA_PATTERN.test(ref)) {
      violations.push({ file: relative(CWD, file), action, ref })
    }
  }
}

// action@sha -> Map<versionLabel, Set<file>>; populated across the whole scanned set so a
// contradiction split across two files (e.g. template vs another template) is still caught.
const shaComments = new Map()
const majorOf = (label) => {
  const m = /^v(\d+)/.exec(label)
  return m ? m[1] : null
}
const scanComments = (file, content) => {
  for (const match of content.matchAll(USES_WITH_COMMENT)) {
    const action = match[1]
    if (action.startsWith('.') || action.startsWith('docker://')) continue
    const key = `${action}@${match[2]}`
    const label = match[3]
    if (!shaComments.has(key)) shaComments.set(key, new Map())
    const labels = shaComments.get(key)
    if (!labels.has(label)) labels.set(label, new Set())
    labels.get(label).add(relative(CWD, file))
  }
}

// #1666: action -> Map<sha, { labels:Set<string>, files:Set<string> }>. Tracks every
// distinct sha pinned for an action so the divergent-sha check below can bucket by major.
const actionPins = new Map()
const collectPins = (file, content) => {
  for (const match of content.matchAll(USES_WITH_OPTIONAL_COMMENT)) {
    const action = match[1]
    if (action.startsWith('.') || action.startsWith('docker://')) continue
    const sha = match[2].toLowerCase()
    const label = (match[3] ?? '').trim()
    if (!actionPins.has(action)) actionPins.set(action, new Map())
    const shaMap = actionPins.get(action)
    if (!shaMap.has(sha)) shaMap.set(sha, { labels: new Set(), files: new Set() })
    const entry = shaMap.get(sha)
    if (label) entry.labels.add(label)
    entry.files.add(relative(CWD, file))
  }
}

for (const file of [...yamlFiles, ...templateFiles]) {
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch (err) {
    process.stderr.write(`  [check-action-pins] warn: cannot read ${file}: ${err.message}\n`)
    continue
  }
  scan(file, content)
  scanComments(file, content)
  collectPins(file, content)
}

// A sha whose pins disagree on the MAJOR version is mislabelled — exactly one of the labels
// is false. Differing patch/minor precision on a shared major is not a contradiction.
const commentViolations = []
for (const [key, labels] of shaComments) {
  const majors = new Set([...labels.keys()].map(majorOf).filter((v) => v !== null))
  if (majors.size > 1) commentViolations.push({ key, labels })
}

// #1666 — divergent-sha gate. For each action, bucket its distinct shas by effective major:
//   RULE A: >1 distinct sha WITHIN one major = dup-sha bug, NON-allowlistable (always fails).
//   RULE B: a split ACROSS majors is allowed ONLY when every (major→sha) is declared, with the
//           exact sha, in CROSS_MAJOR_ALLOWLIST. An undeclared/ mismatched cross-major split fails.
// A single-sha action is always fine (one bucket); only ≥2 distinct shas can trip either rule.
const divergentSameMajor = []
const undeclaredCrossMajor = []
for (const [action, shaMap] of actionPins) {
  const buckets = new Map() // major -> Set<sha>
  for (const [sha, info] of shaMap) {
    const bucket = bucketOfSha(info.labels)
    if (!buckets.has(bucket)) buckets.set(bucket, new Set())
    buckets.get(bucket).add(sha)
  }
  for (const [bucket, shas] of buckets) {
    if (shas.size > 1) divergentSameMajor.push({ action, bucket, shas: [...shas] })
  }
  if (buckets.size > 1) {
    const allow = CROSS_MAJOR_ALLOWLIST[action]
    for (const [bucket, shas] of buckets) {
      if (shas.size !== 1) continue // a within-major dup is already reported by RULE A
      const [sha] = [...shas]
      const declared = allow ? allow[bucket] : undefined
      if (declared !== sha) {
        undeclaredCrossMajor.push({ action, bucket, sha, declared: declared ?? null })
      }
    }
  }
}

if (
  violations.length === 0 &&
  commentViolations.length === 0 &&
  divergentSameMajor.length === 0 &&
  undeclaredCrossMajor.length === 0
) {
  console.log(
    '  check-action-pins: all action references are SHA-pinned with truthful version comments',
  )
  process.exit(0)
}

// Enforced (#886): a non-SHA action reference is a hard stop — fail the gate.
if (violations.length > 0) {
  process.stderr.write(
    `  check-action-pins: ${violations.length} non-SHA action reference(s) — INV-76 requires 40-hex SHA pins:\n`,
  )
  for (const v of violations) {
    process.stderr.write(`    ${v.file}: ${v.action}@${v.ref}\n`)
  }
}

// Enforced (#1614): a sha labelled with contradictory major versions is a hard stop.
if (commentViolations.length > 0) {
  process.stderr.write(
    `  check-action-pins: ${commentViolations.length} action SHA(s) with contradictory version comments — a sha maps to ONE release (#1614):\n`,
  )
  for (const v of commentViolations) {
    const detail = [...v.labels.entries()]
      .map(([label, files]) => `# ${label} (${[...files].join(', ')})`)
      .join(' vs ')
    process.stderr.write(`    ${v.key}: ${detail}\n`)
  }
}

// Enforced (#1666): >1 distinct sha within ONE major is a dup-sha bug — never allowlistable.
if (divergentSameMajor.length > 0) {
  process.stderr.write(
    `  check-action-pins: ${divergentSameMajor.length} action(s) with divergent SHAs within one major — unify to a single sha (#1666):\n`,
  )
  for (const v of divergentSameMajor) {
    process.stderr.write(`    ${v.action} (major ${v.bucket}): ${v.shas.join(' vs ')}\n`)
  }
}

// Enforced (#1666): a cross-major split is allowed only when declared in CROSS_MAJOR_ALLOWLIST.
if (undeclaredCrossMajor.length > 0) {
  process.stderr.write(
    `  check-action-pins: ${undeclaredCrossMajor.length} undeclared cross-major action pin(s) — add to CROSS_MAJOR_ALLOWLIST or unify (#1666):\n`,
  )
  for (const v of undeclaredCrossMajor) {
    const expected = v.declared ? `declared ${v.declared}` : 'not in allowlist'
    process.stderr.write(`    ${v.action}@${v.sha} (major ${v.bucket}) — ${expected}\n`)
  }
}

process.exit(1)
