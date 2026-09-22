// SPDX-License-Identifier: Apache-2.0
// Pure plan-time gate derivation (#2773). No filesystem, environment, or process reads.
import {
  GATE_AFFECTS_REGISTRY,
  GATE_SKIP_BLACKLIST,
  affectedGateNames,
} from './gate-affects-registry.mjs'
import { DERIVED_ARTIFACTS } from './derived-artifacts.mjs'

const ARTIFACTS = new Map(DERIVED_ARTIFACTS.map(({ name, writeCmd }) => [name, writeCmd.join(' ')]))

// These live check-all entries execute tests or verify RED evidence. Every other
// non-generated check is a constraint to respect while writing.
const TEST_FIRST = new Set([
  'unit tests',
  'greenfield smoke',
  'template tests',
  'generator tests',
  'command tests',
  'brownfield tests (CANON-11)',
  'tdd-evidence',
  'BDD suite (INV-25)',
])

function classify(name, files) {
  if (
    name === 'integration suite (INV-25)' &&
    files.some((file) => file.startsWith('src/templates/'))
  ) {
    return {
      name,
      kind: 'artifact-regenerate',
      command: 'BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake',
    }
  }
  const command = ARTIFACTS.get(name)
  if (command !== undefined) return { name, kind: 'artifact-regenerate', command }
  return { name, kind: TEST_FIRST.has(name) ? 'test-first' : 'constraint' }
}

function inspectedGate(name, inspection) {
  return inspection?.gates?.find((gate) => gate.name === name)
}

function bindInspection(gate, inspection) {
  const described = inspectedGate(gate.name, inspection)
  if (gate.kind === 'artifact-regenerate' && described) {
    const { command: verificationCommand, ...verification } = described
    return {
      ...verification,
      ...gate,
      verificationCommand,
      ...(inspection?.authority ? { authority: inspection.authority } : {}),
    }
  }
  return {
    ...gate,
    ...(described ?? {}),
    ...(gate.name === 'coverage' ? { kind: 'test-first' } : {}),
    ...(inspection?.authority ? { authority: inspection.authority } : {}),
  }
}

export function deriveGatesForFiles(
  files,
  registry = GATE_AFFECTS_REGISTRY,
  inspection = undefined,
) {
  const affected = affectedGateNames(files, registry, GATE_SKIP_BLACKLIST)
  const candidates = registry
    .filter((entry) => affected.has(entry.name))
    .map((entry) => classify(entry.name, files))
  const gates = candidates
    .filter(
      (gate) =>
        inspection === undefined ||
        gate.kind === 'artifact-regenerate' ||
        inspectedGate(gate.name, inspection) !== undefined,
    )
    .map((gate) => bindInspection(gate, inspection))
  const external = (inspection?.external ?? []).map((entry) => ({
    ...entry,
    kind: 'constraint',
    authority: inspection.authority,
  }))
  const unresolved = (inspection?.unresolved ?? []).map((entry) => ({
    ...entry,
    kind: 'constraint',
    status: 'unresolved',
    authority: inspection.authority,
  }))
  return [...gates, ...external, ...unresolved]
}

export function validateDerivedGates(
  files,
  stored,
  registry = GATE_AFFECTS_REGISTRY,
  inspection = undefined,
) {
  const expected = deriveGatesForFiles(files, registry, inspection)
  return {
    ok: Array.isArray(stored) && JSON.stringify(stored) === JSON.stringify(expected),
    expected,
  }
}

function isRepoRelativePosixPath(value) {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
}

/** Parse the files: list from the plan frontmatter shape already used by /ship. */
export function parsePlanFilesManifest(plan) {
  const frontMatter = plan.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  if (frontMatter === undefined) return null
  const lines = frontMatter.split(/\r?\n/)
  const filesIndex = lines.findIndex((line) => /^files:\s*$/.test(line))
  if (filesIndex === -1) return null
  const files = []
  for (const line of lines.slice(filesIndex + 1)) {
    if (/^[A-Za-z][A-Za-z0-9_-]*:\s*/.test(line)) break
    if (line.trim() === '') continue
    const file = line.match(/^\s+-\s+(.+?)\s*$/)?.[1]
    if (file === undefined || !isRepoRelativePosixPath(file)) return null
    files.push(file)
  }
  return files
}
