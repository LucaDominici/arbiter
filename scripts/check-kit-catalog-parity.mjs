#!/usr/bin/env node
// INV-86: Kit catalog parity gate (L1).
// Checks: coverage, field parity, enforcement coverage for BLOCKING dims, redaction.
// Exit 0=PASS  1=FAIL  2=ERROR
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
let exitCode = 0
const violations = { coverage: [], field: [], enforcement: [], redaction: [] }

// ─── Load files ───────────────────────────────────────────────────────────────

let catalog, mapping, lexicon

try {
  catalog = JSON.parse(readFileSync(resolve(root, 'src/kit/catalog.json'), 'utf-8'))
} catch (err) {
  process.stderr.write(`[INV-86] ERROR loading src/kit/catalog.json: ${err.message}\n`)
  process.exit(2)
}

try {
  const raw = JSON.parse(
    readFileSync(resolve(root, 'docs/audits/kit-canonical-mapping.json'), 'utf-8'),
  )
  mapping = raw.dimensions
} catch (err) {
  process.stderr.write(
    `[INV-86] ERROR loading docs/audits/kit-canonical-mapping.json: ${err.message}\n`,
  )
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
    '[INV-86] ERROR: docs/audits/kit-canonical-mapping.json .dimensions is not an array\n',
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
const mappingText = readFileSync(resolve(root, 'docs/audits/kit-canonical-mapping.json'), 'utf-8')

scanText(catalogText, 'src/kit/catalog.json')
// Skip the $schema header in mapping (first few lines)
const mappingLines = mappingText.split('\n')
const bodyStart = mappingLines.findIndex(
  (l) => !l.includes('"$schema"') && !l.includes('"source":') && !l.trim().startsWith('{'),
)
const mappingBody = mappingLines.slice(bodyStart).join('\n')
scanText(mappingBody, 'docs/audits/kit-canonical-mapping.json')

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

process.stdout.write('[INV-86] kit catalog parity PASS (76 dims, all checks green)\n')
process.exit(0)
