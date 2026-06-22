// SPDX-License-Identifier: Apache-2.0
// B5 gap-close (#1491 / #1042): regression guard for the functional harness's
// fake-green vector.
//
// The functional harness proves the GENERATED project's own gate runs green. Its
// per-cell flow installs the project's deps, then runs the gate. The ORIGINAL harness
// skipped the gate (and passed the cell green) on ANY install failure, justified as
// "offline?". But a PEP-668 `externally-managed-environment` failure (the Debian/Ubuntu
// default — including the CI runner) is DETERMINISTIC, not offline: the python cell
// silently skipped the gate on every such host and never actually exercised the
// generated gate. That is the precise fake-green class B5 exists to eliminate.
//
// The fix narrows the skip to genuine NETWORK failures (isOfflineFailure) and THROWS on
// any other install failure so it surfaces as a hard RED. This test pins that
// classifier: a deterministic, reproducible failure must NOT be treated as offline.
import { describe, expect, it } from 'vitest'
import { isOfflineFailure } from '../helpers.js'

describe('B5 fake-green guard: install-failure classifier (#1491/#1042)', () => {
  it('does NOT treat a deterministic PEP-668 failure as offline', () => {
    // This is the EXACT failure the old harness laundered into a green. It must now be
    // classified as non-offline so installDeps throws and the cell fails RED instead of
    // skipping the gate.
    const pep668 = [
      'error: externally-managed-environment',
      '',
      '× This environment is externally managed',
      '╰─> To install Python packages system-wide, try apt install python3-xyz.',
      'note: If you believe this is a mistake ... pass --break-system-packages.',
      'hint: See PEP 668 for the detailed specification.',
    ].join('\n')
    expect(isOfflineFailure(pep668)).toBe(false)
  })

  it('does NOT treat other deterministic install failures as offline', () => {
    expect(isOfflineFailure('ERROR: No matching distribution found for nonexistent-pkg')).toBe(
      false,
    )
    expect(isOfflineFailure('npm ERR! code ERESOLVE\nnpm ERR! peer dep conflict')).toBe(false)
    expect(isOfflineFailure('build backend failed: ModuleNotFoundError: setuptools')).toBe(false)
    expect(isOfflineFailure('')).toBe(false)
  })

  it('DOES treat genuine network failures as offline (no false-RED in an air-gapped runner)', () => {
    expect(isOfflineFailure('getaddrinfo ENOTFOUND registry.npmjs.org')).toBe(true)
    expect(isOfflineFailure('pip: Temporary failure in name resolution')).toBe(true)
    expect(isOfflineFailure('Could not resolve host: pypi.org')).toBe(true)
    expect(isOfflineFailure('connect ECONNREFUSED 127.0.0.1:443')).toBe(true)
    expect(isOfflineFailure('Max retries exceeded with url')).toBe(true)
    expect(isOfflineFailure('Connection timed out')).toBe(true)
    expect(isOfflineFailure('Network is unreachable')).toBe(true)
  })
})
