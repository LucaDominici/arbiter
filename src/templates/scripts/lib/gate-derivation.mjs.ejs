// SPDX-License-Identifier: Apache-2.0

function isRepoRelativePosixPath(value) {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
}

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

export function deriveGatesForFiles(files, _registry, inspection) {
  const authority = inspection?.authority ?? []
  const gates = (inspection?.gates ?? []).map((gate) => ({
    ...gate,
    ...(gate.name === 'coverage' ? { kind: 'test-first' } : {}),
    authority,
  }))
  const external = (inspection?.external ?? []).map((entry) => ({
    ...entry,
    kind: 'constraint',
    authority,
  }))
  const unresolved = (inspection?.unresolved ?? []).map((entry) => ({
    ...entry,
    kind: 'constraint',
    status: 'unresolved',
    authority,
  }))
  return [...gates, ...external, ...unresolved]
}

export function validateDerivedGates(files, stored, registry, inspection) {
  const expected = deriveGatesForFiles(files, registry, inspection)
  return {
    ok: Array.isArray(stored) && JSON.stringify(stored) === JSON.stringify(expected),
    expected,
  }
}
