// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONTRACT_CAPABILITY = '@arbiter-gate-contract arbiter-gate-contract-v1'

function authority(path) {
  return {
    path: 'scripts/check-all.mjs',
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }
}

function unresolved(root, reason) {
  const path = join(root, 'scripts', 'check-all.mjs')
  return {
    schema: 'arbiter-gate-contract-v1',
    authority: existsSync(path) ? [authority(path)] : [],
    gates: [],
    external: [],
    unresolved: [{ name: 'verification authority', source: 'scripts/check-all.mjs', reason }],
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasAuthorityEntries(authorityEntries) {
  return (
    Array.isArray(authorityEntries) &&
    authorityEntries.every(
      (entry) => isNonEmptyString(entry?.path) && isNonEmptyString(entry?.sha256),
    )
  )
}

function hasGateEntries(gates) {
  return (
    Array.isArray(gates) &&
    gates.every(
      (entry) =>
        isNonEmptyString(entry?.name) &&
        isNonEmptyString(entry?.command) &&
        isNonEmptyString(entry?.condition),
    )
  )
}

function hasExternalEntries(external) {
  return (
    Array.isArray(external) &&
    external.every(
      (entry) =>
        isNonEmptyString(entry?.name) &&
        isNonEmptyString(entry?.source) &&
        isNonEmptyString(entry?.command) &&
        isNonEmptyString(entry?.condition) &&
        entry?.status === 'remote-dependent',
    )
  )
}

function hasUnresolvedEntries(unresolvedEntries) {
  return (
    unresolvedEntries === undefined ||
    (Array.isArray(unresolvedEntries) &&
      unresolvedEntries.every(
        (entry) => isNonEmptyString(entry?.source) && isNonEmptyString(entry?.reason),
      ))
  )
}

function isGateContract(contract) {
  return (
    contract?.schema === 'arbiter-gate-contract-v1' &&
    hasAuthorityEntries(contract.authority) &&
    hasGateEntries(contract.gates) &&
    hasExternalEntries(contract.external) &&
    hasUnresolvedEntries(contract.unresolved)
  )
}

export function inspectGateContract(root) {
  const script = join(root, 'scripts', 'check-all.mjs')
  if (!existsSync(script)) return unresolved(root, 'missing gate authority')
  if (!readFileSync(script, 'utf8').includes(CONTRACT_CAPABILITY)) {
    return unresolved(root, 'unsupported custom gate authority')
  }
  const result = spawnSync(process.execPath, [script, 'L2', '--dry-run'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 5000,
  })
  if (result.error || result.status !== 0 || result.signal) {
    return unresolved(root, 'unsupported custom gate authority')
  }
  try {
    const contract = JSON.parse(result.stdout)
    if (!isGateContract(contract)) return unresolved(root, 'incomplete gate contract')
    return contract
    // FAIL-OPEN-INTENT: malformed output becomes a blocking unresolved authority below.
  } catch {
    return unresolved(root, 'unsupported custom gate authority')
  }
}

export function unresolvedContractReasons(contract) {
  return (contract.unresolved ?? []).map((entry) => entry.reason)
}
