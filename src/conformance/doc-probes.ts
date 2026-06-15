// SPDX-License-Identifier: Apache-2.0
// conformance/doc-probes.ts — docs-convention probe functions (#1396, C4).
//
// Seven DOC-* probes that check whether standard documentation files/directories
// exist and meet minimum quality bars. All return DimensionEntry with evidence.
//
// Pure functions: no process.exit, no console. All IO is wrapped in try/catch.

import { readdirSync } from 'node:fs'
import type { DimensionEntry } from './dimensions.js'
import { safeResolve, readText, fileExists } from './shared.js'

/** Shared field values for docs-convention tier-2 dimensions. */
const DOC_T2: Pick<DimensionEntry, 'family' | 'tier' | 'weight' | 'required_at'> = {
  family: 'docs-convention',
  tier: 2,
  weight: 1,
  required_at: 'L1',
}

// ─── DOC-README ───────────────────────────────────────────────────────────────

const README_MIN_LENGTH = 50

/**
 * DOC-README: project has a README.md with meaningful content.
 * Y = present and >= 100 chars; P = present but too short; N = absent.
 */
export function probeDDocReadme(root: string): DimensionEntry {
  const candidates = ['README.md', 'README.rst', 'README.txt', 'README']
  for (const file of candidates) {
    const abs = safeResolve(root, file)
    if (abs === null || !fileExists(abs)) continue
    const text = readText(abs)
    if (text === null) continue
    if (text.length >= README_MIN_LENGTH) {
      return {
        id: 'DOC-README',
        title: 'Project has a meaningful README',
        ...DOC_T2,
        verdict: 'Y',
        evidence: { file },
      }
    }
    return {
      id: 'DOC-README',
      title: 'Project has a meaningful README',
      ...DOC_T2,
      verdict: 'P',
      evidence: {
        file,
        detail: `too short (${text.length} chars < ${README_MIN_LENGTH} required)`,
      },
    }
  }

  return {
    id: 'DOC-README',
    title: 'Project has a meaningful README',
    ...DOC_T2,
    verdict: 'N',
    evidence: { file: 'README.md', detail: 'absent — no README found' },
  }
}

// ─── DOC-CHANGELOG ────────────────────────────────────────────────────────────

/**
 * DOC-CHANGELOG: project maintains a CHANGELOG.
 * Y = CHANGELOG.md (or .rst/.txt) present; N = absent.
 */
export function probeDDocChangelog(root: string): DimensionEntry {
  const candidates = ['CHANGELOG.md', 'CHANGELOG.rst', 'CHANGELOG.txt', 'CHANGELOG']
  for (const file of candidates) {
    const abs = safeResolve(root, file)
    if (abs !== null && fileExists(abs)) {
      return {
        id: 'DOC-CHANGELOG',
        title: 'Project maintains a CHANGELOG',
        ...DOC_T2,
        verdict: 'Y',
        evidence: { file },
      }
    }
  }

  return {
    id: 'DOC-CHANGELOG',
    title: 'Project maintains a CHANGELOG',
    ...DOC_T2,
    verdict: 'N',
    evidence: { file: 'CHANGELOG.md', detail: 'absent — no CHANGELOG found' },
  }
}

// ─── DOC-ADR ─────────────────────────────────────────────────────────────────

/** List .md files in a directory (non-recursive, returns relative names). */
function listMdFiles(absDir: string): string[] {
  try {
    return readdirSync(absDir).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
}

/**
 * DOC-ADR: project documents architecture decisions via ADRs.
 * Y = docs/ADR/ exists and has >= 1 .md file; P = dir exists but empty; N = absent.
 */
export function probeDDocAdr(root: string): DimensionEntry {
  const candidates = ['docs/ADR', 'docs/adr', '.adr', 'adr']
  for (const dir of candidates) {
    const abs = safeResolve(root, dir)
    if (abs === null || !fileExists(abs)) continue
    const mdFiles = listMdFiles(abs)
    if (mdFiles.length > 0) {
      return {
        id: 'DOC-ADR',
        title: 'Project documents architecture decisions (ADRs)',
        ...DOC_T2,
        verdict: 'Y',
        evidence: { file: `${dir}/${mdFiles[0]}`, detail: `${mdFiles.length} ADR(s) found` },
      }
    }
    return {
      id: 'DOC-ADR',
      title: 'Project documents architecture decisions (ADRs)',
      ...DOC_T2,
      verdict: 'P',
      evidence: { file: dir, detail: 'directory exists but contains no .md files' },
    }
  }

  return {
    id: 'DOC-ADR',
    title: 'Project documents architecture decisions (ADRs)',
    ...DOC_T2,
    verdict: 'N',
    evidence: { file: 'docs/ADR', detail: 'absent — no ADR directory found' },
  }
}

// ─── DOC-CONTRIBUTING ─────────────────────────────────────────────────────────

/**
 * DOC-CONTRIBUTING: project has contribution guidelines.
 * Y = CONTRIBUTING.md present; N = absent.
 */
export function probeDDocContributing(root: string): DimensionEntry {
  const candidates = ['CONTRIBUTING.md', 'CONTRIBUTING.rst', '.github/CONTRIBUTING.md']
  for (const file of candidates) {
    const abs = safeResolve(root, file)
    if (abs !== null && fileExists(abs)) {
      return {
        id: 'DOC-CONTRIBUTING',
        title: 'Project has contribution guidelines',
        ...DOC_T2,
        verdict: 'Y',
        evidence: { file },
      }
    }
  }

  return {
    id: 'DOC-CONTRIBUTING',
    title: 'Project has contribution guidelines',
    ...DOC_T2,
    verdict: 'N',
    evidence: { file: 'CONTRIBUTING.md', detail: 'absent — no contribution guidelines found' },
  }
}

// ─── DOC-LICENSE ─────────────────────────────────────────────────────────────

/**
 * DOC-LICENSE: project has a LICENSE file.
 * Y = LICENSE (or LICENSE.md/.txt) present; N = absent.
 */
export function probeDDocLicense(root: string): DimensionEntry {
  const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md']
  for (const file of candidates) {
    const abs = safeResolve(root, file)
    if (abs !== null && fileExists(abs)) {
      return {
        id: 'DOC-LICENSE',
        title: 'Project has a LICENSE file',
        ...DOC_T2,
        verdict: 'Y',
        evidence: { file },
      }
    }
  }

  return {
    id: 'DOC-LICENSE',
    title: 'Project has a LICENSE file',
    ...DOC_T2,
    verdict: 'N',
    evidence: { file: 'LICENSE', detail: 'absent — no LICENSE file found' },
  }
}

// ─── DOC-API-DOCS ─────────────────────────────────────────────────────────────

/**
 * DOC-API-DOCS: project has API reference documentation.
 * Y = docs/API/ or docs/api/ has >= 1 file; NV = absent (not all projects need this).
 */
export function probeDDocApiDocs(root: string): DimensionEntry {
  const candidates = ['docs/API', 'docs/api', 'docs/reference', 'api-docs']
  for (const dir of candidates) {
    const abs = safeResolve(root, dir)
    if (abs === null || !fileExists(abs)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(abs)
    } catch {
      // skip
    }
    if (entries.length > 0) {
      return {
        id: 'DOC-API-DOCS',
        title: 'Project has API reference documentation',
        ...DOC_T2,
        verdict: 'Y',
        evidence: { file: dir, detail: `${entries.length} file(s) found` },
      }
    }
  }

  return {
    id: 'DOC-API-DOCS',
    title: 'Project has API reference documentation',
    ...DOC_T2,
    verdict: 'NV',
    evidence: {
      file: 'docs/API',
      detail: 'absent — not verified (optional for non-library projects)',
    },
  }
}

// ─── DOC-SECURITY ─────────────────────────────────────────────────────────────

/**
 * DOC-SECURITY: project has a security policy.
 * Y = SECURITY.md or .github/SECURITY.md present; NV = absent (recommended, not required).
 */
export function probeDDocSecurity(root: string): DimensionEntry {
  const candidates = ['SECURITY.md', '.github/SECURITY.md', 'SECURITY.rst']
  for (const file of candidates) {
    const abs = safeResolve(root, file)
    if (abs !== null && fileExists(abs)) {
      return {
        id: 'DOC-SECURITY',
        title: 'Project has a security policy',
        ...DOC_T2,
        verdict: 'Y',
        evidence: { file },
      }
    }
  }

  return {
    id: 'DOC-SECURITY',
    title: 'Project has a security policy',
    ...DOC_T2,
    verdict: 'NV',
    evidence: {
      file: 'SECURITY.md',
      detail: 'absent — recommended but not required',
    },
  }
}
