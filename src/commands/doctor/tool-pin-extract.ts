// SPDX-License-Identifier: Apache-2.0
//
// #2162 — pure extractors for tool version pins declared in a target's GitHub
// Actions workflows. No fs/process side effects: callers read the workflow
// text and pass it in. Three shapes observed in real workflows (arbiter's own
// `.github/workflows/01-pr-fast.yml`, `scripts/ci-tools.json`):
//   1. download-url: `curl .../releases/download/vX.Y.Z/<archive>` — the tool
//      name is the repo segment of the GitHub URL.
//   2. env-pin: `FOO_VERSION: "X.Y(.Z)"` — tool name is the prefix, lowercased.
//   3. action-tag: `uses: owner/repo@vX.Y(.Z)` — requires at least major.minor
//      so bare `@v4`-style action tags (checkout, setup-node) never match.

export interface SemVer {
  major: number
  minor: number
  patch: number
}

export interface ToolPin {
  tool: string
  version: SemVer
  file: string
  line: number
  blocking: boolean
}

function toSemVer(major: string, minor: string, patch?: string): SemVer {
  return { major: Number(major), minor: Number(minor), patch: patch ? Number(patch) : 0 }
}

/** Local 3-component numeric compare (major → minor → patch). Negative if a < b. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

// YAML 1.1 boolean tokens that resolve to TRUE. A bare `=== 'true'` regex misses
// `on`/`yes`/`y` — the same trap `scripts/lib/continue-on-error-core.mjs` guards
// against for the swallowed-gate check. Reused here as a small local grammar
// rather than importing that scripts/lib helper (layering: scripts/ is
// arbiter's own gate tooling, not a dependency of the CLI it ships).
const TRUTHY_RE = /continue-on-error:\s*['"]?(\$\{\{\s*true\s*\}\}|true|on|yes|y)\b/i

/**
 * ponytail: job-granularity blocking detection (a `continue-on-error: true`
 * anywhere in the job body marks every pin found in that job as non-blocking),
 * not per-step. Upgrade path if this proves too coarse: the step-boundary
 * parser in `scripts/lib/continue-on-error-core.mjs`.
 *
 * Splits the workflow into job blocks by the top-level `jobs:` key's direct
 * children (two-space-indented `name:` lines) and returns, for each line
 * index, whether the enclosing job is advisory-only (continue-on-error truthy).
 */
function buildBlockingLineMap(workflowText: string): (line: number) => boolean {
  const lines = workflowText.split('\n')
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (jobsIdx === -1) return () => true // no jobs: key — treat everything as blocking (safe default)

  // Job header lines: exactly two-space indent under `jobs:`, e.g. "  build:".
  const jobStarts: number[] = []
  for (let i = jobsIdx + 1; i < lines.length; i++) {
    if (/^ {2}[\w-]+:\s*$/.test(lines[i] ?? '')) jobStarts.push(i)
  }
  const jobRanges = jobStarts.map((start, idx) => ({
    start,
    end: jobStarts[idx + 1] ?? lines.length,
  }))

  const advisoryRanges = jobRanges
    .filter(({ start, end }) => lines.slice(start, end).some((l) => TRUTHY_RE.test(l)))
    .map(({ start, end }) => ({ start, end }))

  return (lineNo: number) => {
    const idx = lineNo - 1 // lineOf() is 1-based
    return !advisoryRanges.some((r) => idx >= r.start && idx < r.end)
  }
}

const DOWNLOAD_URL_RE =
  /https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/releases\/download\/v?(\d+)\.(\d+)(?:\.(\d+))?\//g

const ENV_PIN_RE = /^\s*([A-Z][A-Z0-9_]*)_VERSION\s*:\s*['"]?(\d+)\.(\d+)(?:\.(\d+))?/gm

const ACTION_TAG_RE = /uses:\s*[\w.-]+\/([\w.-]+?)(?:-action)?@v?(\d+)\.(\d+)(?:\.(\d+))?/g

function extractDownloadUrlPins(
  text: string,
  file: string,
  isBlocking: (l: number) => boolean,
): ToolPin[] {
  const pins: ToolPin[] = []
  for (const m of text.matchAll(DOWNLOAD_URL_RE)) {
    const [, repo, major, minor, patch] = m
    if (!repo || !major || !minor) continue
    const line = lineOf(text, m.index)
    pins.push({
      tool: repo,
      version: toSemVer(major, minor, patch),
      file,
      line,
      blocking: isBlocking(line),
    })
  }
  return pins
}

function extractEnvPins(text: string, file: string, isBlocking: (l: number) => boolean): ToolPin[] {
  const pins: ToolPin[] = []
  for (const m of text.matchAll(ENV_PIN_RE)) {
    const [, prefix, major, minor, patch] = m
    if (!prefix || !major || !minor) continue
    const line = lineOf(text, m.index)
    pins.push({
      tool: prefix.toLowerCase(),
      version: toSemVer(major, minor, patch),
      file,
      line,
      blocking: isBlocking(line),
    })
  }
  return pins
}

function extractActionTagPins(
  text: string,
  file: string,
  isBlocking: (l: number) => boolean,
): ToolPin[] {
  const pins: ToolPin[] = []
  for (const m of text.matchAll(ACTION_TAG_RE)) {
    const [, repo, major, minor, patch] = m
    if (!repo || !major || !minor) continue
    const line = lineOf(text, m.index)
    pins.push({
      tool: repo,
      version: toSemVer(major, minor, patch),
      file,
      line,
      blocking: isBlocking(line),
    })
  }
  return pins
}

/** Extract every tool-version pin found in one workflow file's text. */
export function extractToolPins(workflowText: string, file: string): ToolPin[] {
  const isBlocking = buildBlockingLineMap(workflowText)
  return [
    ...extractDownloadUrlPins(workflowText, file, isBlocking),
    ...extractEnvPins(workflowText, file, isBlocking),
    ...extractActionTagPins(workflowText, file, isBlocking),
  ]
}
