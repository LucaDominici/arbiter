export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** `v20.11.1` → SemVer */
export function parseNodeVersion(raw: string): SemVer | null {
  const m = raw.trim().match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const [, maj, min, pat] = m;
  if (maj === undefined || min === undefined || pat === undefined) return null;
  return { major: +maj, minor: +min, patch: +pat };
}

/** `10.2.4` → SemVer */
export function parseNpmVersion(raw: string): SemVer | null {
  return parseBare(raw.trim());
}

/**
 * Handles:
 *   openjdk version "17.0.9" ...
 *   java version "1.8.0_402"   (legacy — major becomes 8)
 */
export function parseJavaVersion(raw: string): SemVer | null {
  const m = raw.match(/"(\d+)\.(\d+)\.(\d+)(?:_(\d+))?"/);
  if (!m) return null;
  const [, maj, min, pat, sub] = m;
  if (maj === undefined || min === undefined || pat === undefined) return null;
  if (maj === "1") {
    // legacy 1.x format → real major is min
    return { major: +min, minor: +pat, patch: sub !== undefined ? +sub : 0 };
  }
  return { major: +maj, minor: +min, patch: +pat };
}

/** `Gradle 8.5` or `Gradle 7.6.4` */
export function parseGradleVersion(raw: string): SemVer | null {
  const m = raw.match(/Gradle\s+(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const [, maj, min, pat] = m;
  if (maj === undefined || min === undefined) return null;
  return { major: +maj, minor: +min, patch: pat !== undefined ? +pat : 0 };
}

/** `Apache Maven 3.9.6 (...)` */
export function parseMavenVersion(raw: string): SemVer | null {
  const m = raw.match(/Apache Maven\s+(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const [, maj, min, pat] = m;
  if (maj === undefined || min === undefined || pat === undefined) return null;
  return { major: +maj, minor: +min, patch: +pat };
}

/** `rustc 1.78.0 (hash date)` */
export function parseRustVersion(raw: string): SemVer | null {
  const m = raw.match(/rustc\s+(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const [, maj, min, pat] = m;
  if (maj === undefined || min === undefined || pat === undefined) return null;
  return { major: +maj, minor: +min, patch: +pat };
}

/** `cargo 1.78.0 (hash date)` */
export function parseCargoVersion(raw: string): SemVer | null {
  const m = raw.match(/cargo\s+(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const [, maj, min, pat] = m;
  if (maj === undefined || min === undefined || pat === undefined) return null;
  return { major: +maj, minor: +min, patch: +pat };
}

/** `go version go1.22.3 linux/amd64` */
export function parseGoVersion(raw: string): SemVer | null {
  const m = raw.match(/go(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const [, maj, min, pat] = m;
  if (maj === undefined || min === undefined) return null;
  return { major: +maj, minor: +min, patch: pat !== undefined ? +pat : 0 };
}

/** `Python 3.12.3` */
export function parsePythonVersion(raw: string): SemVer | null {
  const m = raw.match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const [, maj, min, pat] = m;
  if (maj === undefined || min === undefined || pat === undefined) return null;
  return { major: +maj, minor: +min, patch: +pat };
}

/** `pip 24.0 from ...` */
export function parsePipVersion(raw: string): SemVer | null {
  const m = raw.match(/pip\s+(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const [, maj, min, pat] = m;
  if (maj === undefined || min === undefined) return null;
  return { major: +maj, minor: +min, patch: pat !== undefined ? +pat : 0 };
}

// ---- internal ----

function parseBare(s: string): SemVer | null {
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const [, maj, min, pat] = m;
  if (maj === undefined || min === undefined || pat === undefined) return null;
  return { major: +maj, minor: +min, patch: +pat };
}
