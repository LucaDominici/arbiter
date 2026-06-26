// SPDX-License-Identifier: Apache-2.0
export interface SemVer {
  major: number
  minor: number
  patch: number
}

interface VersionSpec {
  /** Capture groups 1-3 = major, minor, patch (patch optional when `optionalPatch`). */
  re: RegExp
  /** Trim the raw input before matching (required for `$`-anchored patterns). */
  trim?: boolean
  /** Patch group is optional; default it to 0 when absent. */
  optionalPatch?: boolean
}

/** Shared body for every spec-driven parser. The regexes ARE the contract. */
function parseWith(spec: VersionSpec, raw: string): SemVer | null {
  const m = (spec.trim ? raw.trim() : raw).match(spec.re)
  if (!m) return null
  const [, maj, min, pat] = m
  if (maj === undefined || min === undefined) return null
  if (!spec.optionalPatch && pat === undefined) return null
  return { major: +maj, minor: +min, patch: pat !== undefined ? +pat : 0 }
}

const SPECS = {
  node: { re: /^v(\d+)\.(\d+)\.(\d+)$/, trim: true },
  npm: { re: /^(\d+)\.(\d+)\.(\d+)$/, trim: true },
  gradle: { re: /Gradle\s+(\d+)\.(\d+)(?:\.(\d+))?/, optionalPatch: true },
  maven: { re: /Apache Maven\s+(\d+)\.(\d+)\.(\d+)/ },
  rust: { re: /rustc\s+(\d+)\.(\d+)\.(\d+)/ },
  cargo: { re: /cargo\s+(\d+)\.(\d+)\.(\d+)/ },
  go: { re: /go(\d+)\.(\d+)(?:\.(\d+))?/, optionalPatch: true },
  python: { re: /Python\s+(\d+)\.(\d+)\.(\d+)/ },
  pip: { re: /pip\s+(\d+)\.(\d+)(?:\.(\d+))?/, optionalPatch: true },
  lintImports: { re: /lint-imports,\s+version\s+(\d+)\.(\d+)\.(\d+)/, trim: true },
  ruff: { re: /^ruff\s+(\d+)\.(\d+)\.(\d+)/, trim: true },
  kotlin: { re: /kotlinc-jvm\s+(\d+)\.(\d+)\.(\d+)/, trim: true },
} satisfies Record<string, VersionSpec>

/** `v20.11.1` → SemVer */
export const parseNodeVersion = (raw: string): SemVer | null => parseWith(SPECS.node, raw)

/** `10.2.4` → SemVer */
export const parseNpmVersion = (raw: string): SemVer | null => parseWith(SPECS.npm, raw)

/**
 * Handles:
 *   openjdk version "17.0.9" ...
 *   java version "1.8.0_402"   (legacy — major becomes 8)
 *
 * Bespoke: the legacy `1.x` remap and `_NNN` sub-patch have no representation
 * in the shared spec table, so this parser stays standalone.
 */
export function parseJavaVersion(raw: string): SemVer | null {
  // JEP 223 (Java 9) / JEP 322 (Java 10) drop trailing-zero elements from the
  // version string, so the first GA build of every feature release reports a
  // bare major ("21", "17", "24"). Make minor/patch optional in the modern
  // branch so those valid JDKs parse instead of being rejected as
  // "unrecognized version output" → false toolchain incompatibility (#1564).
  const m = raw.match(/"(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:_(\d+))?"/)
  if (!m) return null
  const [, maj, min, pat, sub] = m
  if (maj === undefined) return null
  if (maj === '1') {
    // legacy 1.x format → real major is the minor element; requires the dotted
    // form (a bare "1" carries no recoverable feature version).
    if (min === undefined || pat === undefined) return null
    return { major: +min, minor: +pat, patch: sub !== undefined ? +sub : 0 }
  }
  return {
    major: +maj,
    minor: min !== undefined ? +min : 0,
    patch: pat !== undefined ? +pat : 0,
  }
}

/** `Gradle 8.5` or `Gradle 7.6.4` */
export const parseGradleVersion = (raw: string): SemVer | null => parseWith(SPECS.gradle, raw)

/** `Apache Maven 3.9.6 (...)` */
export const parseMavenVersion = (raw: string): SemVer | null => parseWith(SPECS.maven, raw)

/** `rustc 1.78.0 (hash date)` */
export const parseRustVersion = (raw: string): SemVer | null => parseWith(SPECS.rust, raw)

/** `cargo 1.78.0 (hash date)` */
export const parseCargoVersion = (raw: string): SemVer | null => parseWith(SPECS.cargo, raw)

/** `go version go1.22.3 linux/amd64` */
export const parseGoVersion = (raw: string): SemVer | null => parseWith(SPECS.go, raw)

/** `Python 3.12.3` */
export const parsePythonVersion = (raw: string): SemVer | null => parseWith(SPECS.python, raw)

/** `pip 24.0 from ...` */
export const parsePipVersion = (raw: string): SemVer | null => parseWith(SPECS.pip, raw)

/** `lint-imports, version 2.1.0` */
export const parseLintImportsVersion = (raw: string): SemVer | null =>
  parseWith(SPECS.lintImports, raw)

/** `ruff 0.4.5` */
export const parseRuffVersion = (raw: string): SemVer | null => parseWith(SPECS.ruff, raw)

/** `kotlinc-jvm 1.9.23 (JRE 17.0.9+9)` or `info: kotlinc-jvm 1.9.23 (JRE 17.0.9+9)` */
export const parseKotlinVersion = (raw: string): SemVer | null => parseWith(SPECS.kotlin, raw)
