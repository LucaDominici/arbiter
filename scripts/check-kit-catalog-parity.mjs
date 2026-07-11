#!/usr/bin/env node
// INV-86: Kit catalog parity gate (L1).
// Checks: coverage, field parity, enforcement coverage for BLOCKING dims,
// redaction, import provenance integrity, phantom-path existence, and
// import crosswalk referential integrity (finding R-08).
// Exit 0=PASS  1=FAIL  2=ERROR
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const violations = {
  coverage: [],
  field: [],
  enforcement: [],
  redaction: [],
  provenance: [],
  phantom: [],
  crosswalk: [],
}

// ─── Load files ───────────────────────────────────────────────────────────────

let catalog, mapping, unmappedImportDims, importTotal, lexicon

try {
  catalog = JSON.parse(readFileSync(resolve(root, 'src/kit/catalog.json'), 'utf-8'))
} catch (err) {
  process.stderr.write(`[INV-86] ERROR loading src/kit/catalog.json: ${err.message}\n`)
  process.exit(2)
}

try {
  const raw = JSON.parse(readFileSync(resolve(root, 'src/kit/canonical-mapping.json'), 'utf-8'))
  mapping = raw.dimensions
  unmappedImportDims = raw.unmapped_import_dims ?? []
  importTotal = raw.import_total ?? null
} catch (err) {
  process.stderr.write(`[INV-86] ERROR loading src/kit/canonical-mapping.json: ${err.message}\n`)
  process.exit(2)
}

try {
  lexicon = JSON.parse(readFileSync(resolve(root, 'scripts/data/redaction-lexicon.json'), 'utf-8'))
} catch (err) {
  process.stderr.write(
    `[INV-86] ERROR loading scripts/data/redaction-lexicon.json: ${err.message}\n`,
  )
  process.exit(2)
}

// ─── Validate basic schema ────────────────────────────────────────────────────

if (!Array.isArray(catalog)) {
  process.stderr.write('[INV-86] ERROR: src/kit/catalog.json is not an array\n')
  process.exit(2)
}
if (!Array.isArray(mapping)) {
  process.stderr.write(
    '[INV-86] ERROR: src/kit/canonical-mapping.json .dimensions is not an array\n',
  )
  process.exit(2)
}

// ─── Rule 1: Coverage parity ─────────────────────────────────────────────────

const catalogIds = new Set(catalog.map((d) => d.id))
const mappingCanonIds = new Map()

for (const dim of mapping) {
  if (!dim.canonical_id) {
    violations.coverage.push(`mapping entry id=${dim.id} missing canonical_id`)
    continue
  }
  if (mappingCanonIds.has(dim.canonical_id)) {
    violations.coverage.push(
      `duplicate canonical_id ${dim.canonical_id} in mapping (ids: ${mappingCanonIds.get(dim.canonical_id)}, ${dim.id})`,
    )
  } else {
    mappingCanonIds.set(dim.canonical_id, dim.id)
  }
}

for (const id of catalogIds) {
  if (!mappingCanonIds.has(id)) violations.coverage.push(`catalog ${id} missing from mapping`)
}
for (const [cid] of mappingCanonIds) {
  if (!catalogIds.has(cid)) violations.coverage.push(`mapping canonical_id ${cid} not in catalog`)
}

// ─── Rule 2: Field parity ────────────────────────────────────────────────────

function nfcNorm(s) {
  return s.normalize('NFC').trim()
}

function stripGateSuffix(g) {
  return g.replace(/\s*\([^)]+\)$/, '').trim()
}

for (const dim of mapping) {
  const catId = dim.canonical_id
  if (!catId) continue
  const cat = catalog.find((c) => c.id === catId)
  if (!cat) continue

  // name (NFC-normalized, trimmed)
  if (nfcNorm(dim.name) !== nfcNorm(cat.name)) {
    violations.field.push(`${catId} name: mapping="${dim.name}" catalog="${cat.name}"`)
  }

  // tml_source vs catalog.tml
  if (dim.tml_source !== cat.tml) {
    violations.field.push(
      `${catId} tml: mapping.tml_source="${dim.tml_source}" catalog.tml="${cat.tml}"`,
    )
  }

  // gate_type (strip suffix) vs catalog.gate
  if (stripGateSuffix(dim.gate_type) !== cat.gate) {
    violations.field.push(
      `${catId} gate: mapping.gate_type="${dim.gate_type}" (stripped="${stripGateSuffix(dim.gate_type)}") catalog.gate="${cat.gate}"`,
    )
  }
}

// ─── Rule 3: Enforcement coverage for BLOCKING dims ──────────────────────────

const ACCEPTED_WAVES = new Set(['W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11'])

for (const dim of mapping) {
  const catId = dim.canonical_id
  if (!catId) continue
  const cat = catalog.find((c) => c.id === catId)
  if (!cat || cat.gate !== 'BLOCKING') continue

  const fr = dim.framework_realization ?? {}
  const hasEnforcement =
    dim.invariant_id != null ||
    fr.invariant != null ||
    fr.validator != null ||
    fr.template != null ||
    fr.generator != null

  if (hasEnforcement) continue

  // Disposition exemption: adopt-framework/stack-adapter with a planned W-wave,
  // or done (already implemented — no future wave required)
  const hasExemption =
    dim.disposition === 'done' ||
    ((dim.disposition === 'adopt-framework' || dim.disposition === 'stack-adapter') &&
      dim.implementing_wave != null &&
      ACCEPTED_WAVES.has(dim.implementing_wave))

  if (!hasExemption) {
    violations.enforcement.push(
      `${catId} BLOCKING with no enforcement and no valid disposition exemption (wave="${dim.implementing_wave}", disposition="${dim.disposition}")`,
    )
  }
}

// ─── Rule 4: Redaction scan ───────────────────────────────────────────────────

function scanText(text, filename) {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const entry of lexicon) {
      if (entry.allowContext && line.includes(entry.allowContext)) continue
      if (line.includes(entry.token)) {
        violations.redaction.push(`${filename}:${i + 1} [${entry.token}]: ${line.trim()}`)
      }
    }
  }
}

// Scan both files (skip $schema header line from mapping)
const catalogText = readFileSync(resolve(root, 'src/kit/catalog.json'), 'utf-8')
const mappingText = readFileSync(resolve(root, 'src/kit/canonical-mapping.json'), 'utf-8')

scanText(catalogText, 'src/kit/catalog.json')
// Skip the $schema header in mapping (first few lines)
const mappingLines = mappingText.split('\n')
const bodyStart = mappingLines.findIndex(
  (l) => !l.includes('"$schema"') && !l.includes('"source":') && !l.trim().startsWith('{'),
)
const mappingBody = mappingLines.slice(bodyStart).join('\n')
scanText(mappingBody, 'src/kit/canonical-mapping.json')

// ─── Rule 5: Provenance integrity (R-08) ─────────────────────────────────────
// If a row carries import_source, its import_name must recognizably identify
// the framework_realization.docs pointer it moved in with — this is the
// mechanical guard against a repeat of the #878 positional join bug. Docs
// slugs are truncated (long names get cut mid-word), so comparison is done
// on alphanumeric-only keys with a prefix check rather than exact/substring
// equality.

function alnumKey(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function docsSlugPortion(docsPath) {
  return docsPath.replace(/^.*\/dim-\d+-/, '').replace(/\.md$/, '')
}

for (const dim of mapping) {
  const src = dim.import_source
  if (!src) continue
  const docs = dim.framework_realization?.docs
  if (docs == null) continue
  const nameKey = alnumKey(src.import_name)
  const docsKey = alnumKey(docsSlugPortion(docs))
  if (!nameKey.startsWith(docsKey) && !docsKey.startsWith(nameKey)) {
    violations.provenance.push(
      `${dim.canonical_id} import_source.import_name="${src.import_name}" does not match framework_realization.docs="${docs}"`,
    )
  }
}

// ─── Rule 6: Phantom-path existence (R-13) ───────────────────────────────────
// Any framework_realization.{template,generator,validator} value must either
// be prefixed "planned:" (owner has not decided to build it yet) or exist on
// disk. Prevents the enforcement gate (Rule 3) from being satisfied by paths
// that were never real. Inapplicable when there is no src/ tree to check
// against (published-install parity with kit.ts's runParityCheck, #1575) —
// this script is a dev-time gate, but the guard keeps the two
// implementations behaviorally identical.

const hasSrcTree = existsSync(resolve(root, 'src'))

if (hasSrcTree) {
  for (const dim of mapping) {
    const fr = dim.framework_realization
    if (!fr) continue
    for (const key of ['template', 'generator', 'validator']) {
      const val = fr[key]
      if (val == null || val.startsWith('planned:')) continue
      if (!existsSync(resolve(root, val))) {
        violations.phantom.push(
          `${dim.canonical_id} framework_realization.${key}="${val}" does not exist on disk (prefix with "planned:" or build it)`,
        )
      }
    }
  }
}

// ─── Rule 7: Crosswalk referential integrity ─────────────────────────────────
// Every original import dim (1..import_total) must appear exactly once —
// either attached to a canonical row via import_source, or recorded in
// unmapped_import_dims. No import payload may be silently dropped. Gated
// on the import_total metadata field so mapping files that predate the R-08
// crosswalk (or minimal test fixtures) skip this rule entirely.

if (typeof importTotal === 'number' && importTotal > 0) {
  const importSeen = new Map()
  for (const dim of mapping) {
    const id = dim.import_source?.import_id
    if (id == null) continue
    if (importSeen.has(id)) {
      violations.crosswalk.push(
        `import_id ${id} attached to both ${importSeen.get(id)} and ${dim.canonical_id}`,
      )
    } else {
      importSeen.set(id, dim.canonical_id)
    }
  }
  for (const u of unmappedImportDims) {
    if (importSeen.has(u.import_id)) {
      violations.crosswalk.push(
        `import_id ${u.import_id} in unmapped_import_dims AND attached to ${importSeen.get(u.import_id)}`,
      )
    } else {
      importSeen.set(u.import_id, 'unmapped_import_dims')
    }
  }
  for (let id = 1; id <= importTotal; id++) {
    if (!importSeen.has(id))
      violations.crosswalk.push(`import_id ${id} missing from crosswalk entirely`)
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

const anyFail = Object.values(violations).some((v) => v.length > 0)

if (anyFail) {
  process.stdout.write('[INV-86] kit catalog parity FAIL\n')
  for (const [cat, msgs] of Object.entries(violations)) {
    if (msgs.length > 0) {
      for (const msg of msgs) {
        process.stdout.write(`  [${cat}]   ${msg}\n`)
      }
    }
  }
  process.stdout.write('Fix: see docs/ADR/045-kit-taxonomy.md §Parity Contract\n')
  process.exit(1)
}

process.stdout.write(
  `[INV-86] kit catalog parity PASS (${catalog.length} dims, all checks green)\n`,
)
process.exit(0)
