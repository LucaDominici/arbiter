// SPDX-License-Identifier: Apache-2.0
// Shared registry — minimum `go` version required by each `go install <module>@<version>`
// pin used across arbiter's own CI surfaces (template-rendered AND hand-authored). Single
// source of truth so every consumer (the _nightly.yml.ejs render guard in
// __tests__/templates/_nightly-render.test.ts, the generator-matrix.yml literal-file guard
// in __tests__/scripts/generator-matrix-workflow.test.ts, …) enforces the SAME minimums.
//
// Bump this table alongside any tool pin bump. Minimums come from each module's own `go`
// directive (proxy.golang.org/<module>/@v/<version>.mod).
//
// #1854/#1856/#1840: actions/setup-go v6 pins GOTOOLCHAIN=local right after installing the
// toolchain resolved from `go-version-file` — the `go` tool can no longer silently
// self-upgrade to satisfy a newer pinned tool's requirement the way it did under
// GOTOOLCHAIN=auto. That makes EVERY pinned tool's minimum-go a hard constraint on whichever
// fixture's go.mod directive the caller checks against — never assume, always verify.
export const MIN_GO_FOR_PINNED_TOOL: Record<string, Record<string, string>> = {
  'github.com/golangci/golangci-lint/v2/cmd/golangci-lint': { '2.5.0': '1.24.0' },
  // staticcheck's 2025.1.1 release tag aliases module version v0.6.1
  'honnef.co/go/tools/cmd/staticcheck': { '2025.1.1': '1.23.0' },
  'golang.org/x/vuln/cmd/govulncheck': { '1.5.0': '1.25.0' },
}

export interface GoInstallPin {
  tool: string
  version: string
}

/** Extract every `go install <module>@v<version>` pin from arbitrary workflow/script text. */
export function extractGoInstallPins(content: string): GoInstallPin[] {
  return [...content.matchAll(/go install ([^\s@]+)@v?(\d+\.\d+(?:\.\d+)?)/g)].map((m) => ({
    tool: m[1],
    version: m[2],
  }))
}

/**
 * Assert every pin in `pins` is satisfied by the `go X.Y` directive found in `goModContent`.
 * Throws (via a plain Error, not a vitest matcher) with a diagnostic message identifying the
 * unmet pin — callers wrap this in their own `expect(...).not.toThrow()` or call it directly
 * inside an `it(...)` block, where a thrown Error fails the test with the message intact.
 */
export function assertGoPinsSatisfyDirective(pins: GoInstallPin[], goModContent: string): void {
  const directiveMatch = goModContent.match(/^go (\d+\.\d+)/m)
  if (!directiveMatch) {
    throw new Error(`expected a \`go X.Y\` directive in the given go.mod content`)
  }
  const [fixMajor, fixMinor] = directiveMatch[1].split('.').map(Number)

  for (const { tool, version } of pins) {
    const minGo = MIN_GO_FOR_PINNED_TOOL[tool]?.[version]
    if (minGo == null) {
      throw new Error(
        `no known minimum Go version recorded for ${tool}@${version} — add it to ` +
          'MIN_GO_FOR_PINNED_TOOL in __tests__/helpers/go-pinned-tool-minimums.ts (read the ' +
          'module go directive from proxy.golang.org)',
      )
    }
    const [minMajor, minMinor] = minGo.split('.').map(Number)
    const satisfies = fixMajor > minMajor || (fixMajor === minMajor && fixMinor >= minMinor)
    if (!satisfies) {
      throw new Error(
        `fixture pins go ${directiveMatch[1]} but ${tool}@${version} requires go >= ${minGo} — ` +
          'actions/setup-go v6 pins GOTOOLCHAIN=local so this fails hard in CI (#1854/#1856)',
      )
    }
  }
}
