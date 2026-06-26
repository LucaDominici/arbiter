// SPDX-License-Identifier: Apache-2.0
// Branch-coverage test for src/conformance/engine.ts (#1486).
//
// Drives every uncovered conditional in the conformance engine: the value-op
// report-extraction model (json/xml/regex selectors, compareValue ops, threshold_ref
// vs literal bar resolution), the forbidden_pattern anti-fake-green ladder
// (empty/invalid pattern, invalid glob, exclude_paths literal+rationale guards,
// 0-match NA, all-excluded N, unreadable N, present N, absent Y), the file_stat
// executable-bit ladder (non-exec bit N, 0-match NA, core.fileMode-disabled NA,
// symlink-never-exec, all/some/none verdicts), version_consistency P/N branches,
// and the score/dimension/ratchet accumulators. Filesystem reads use real temp
// fixtures (mkdtempSync under the OS tmpdir), torn down in afterEach. Deterministic,
// fast, no network, no real git/gh, no Date.now assertions.
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  chmodSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir, platform } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  evaluate,
  checkNoRegress,
  ratchet,
  baselineOf,
  type RegistryInput,
  type EngineResult,
  type EvaluateOptions,
  type Verdict,
} from '../../src/conformance/engine.js'
import {
  hasNestedUnboundedQuantifier,
  readScanText,
  MAX_SCAN_BYTES,
} from '../../src/conformance/shared.js'

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'engine-cov-'))
  created.push(dir)
  return dir
}

/** Evaluate a single check and return its verdict + evidence detail. */
function verdictOf(
  root: string,
  check: RegistryInput['checks'] extends (infer T)[] | undefined ? T : never,
  overlays: readonly string[] = [],
  options: EvaluateOptions | null = {},
): { verdict: Verdict; detail: string | undefined; file: string | undefined } {
  const result = evaluate({ checks: [check] }, new Set(overlays), root, options)
  const c = result.checks[0]
  return {
    verdict: c?.verdict ?? 'NV',
    detail: c?.evidence?.detail,
    file: c?.evidence?.file,
  }
}

// ── value-op: legacy `equals`-contains (no format) ──────────────────────────────

describe('value (legacy equals-contains)', () => {
  it('Y when the literal equals string is present', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'v.txt'), 'line1\nVERSION=1.2.3\nline3')
    const r = verdictOf(root, {
      id: 'V',
      type: 'value',
      args: { path: 'v.txt', equals: 'VERSION=1.2.3' },
    })
    expect(r.verdict).toBe('Y')
  })

  it('N when the equals string is absent', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'v.txt'), 'nope')
    const r = verdictOf(root, {
      id: 'V',
      type: 'value',
      args: { path: 'v.txt', equals: 'absent-token' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('value not present')
  })

  it('N when the value file is missing', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'V',
      type: 'value',
      args: { path: 'gone.txt', equals: 'x' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('missing')
  })
})

// ── value-op: report extraction (#1413) ─────────────────────────────────────────

describe('value report extraction — absent report ⇒ NA', () => {
  it('NA when the report file does not exist (never a false-N)', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'missing-report.json', format: 'json', select: 'pct', op: 'gte', expected: 50 },
    })
    expect(r.verdict).toBe('NA')
    expect(r.file).toBeUndefined()
  })
})

describe('value report extraction — json selector', () => {
  it('Y when a dotted-path numeric metric satisfies gte', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'cov.json'), JSON.stringify({ total: { lines: { pct: 92 } } }))
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'cov.json', format: 'json', select: 'total.lines.pct', op: 'gte', expected: 90 },
    })
    expect(r.verdict).toBe('Y')
    expect(r.detail).toBe('92 gte 90')
  })

  it('N when the metric fails the comparison', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'cov.json'), JSON.stringify({ pct: 40 }))
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'cov.json', format: 'json', select: 'pct', op: 'gte', expected: 90 },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('40 !gte 90')
  })

  it('N (no metric) on invalid JSON', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'cov.json'), '{not json')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'cov.json', format: 'json', select: 'pct', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('no metric')
  })

  it('N (no metric) when the dotted path traverses into a non-object', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'cov.json'), JSON.stringify({ a: 5 }))
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'cov.json', format: 'json', select: 'a.b.c', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('no metric')
  })

  it('N (no metric) when the resolved node is non-numeric / non-finite', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'cov.json'), JSON.stringify({ pct: 'NaNish' }))
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'cov.json', format: 'json', select: 'pct', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('tolerates an empty path-segment in the selector (leading dot skipped)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'cov.json'), JSON.stringify({ pct: 10 }))
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'cov.json', format: 'json', select: '.pct', op: 'lte', expected: 50 },
    })
    expect(r.verdict).toBe('Y')
  })
})

describe('value report extraction — xml selectors', () => {
  it('count:tag counts open + self-closing element boundaries (Y on gte)', () => {
    const root = tmpRoot()
    writeFileSync(
      join(root, 'report.xml'),
      '<testsuite><testcase name="a"/><testcase name="b"></testcase><testcaseX/></testsuite>',
    )
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'count:testcase', op: 'gte', expected: 2 },
    })
    // <testcaseX is NOT a boundary match, so only the two real <testcase elements count.
    expect(r.verdict).toBe('Y')
    expect(r.detail).toBe('2 gte 2')
  })

  it('count: with an empty tag ⇒ N (no metric)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'report.xml'), '<root/>')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'count:', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('attr:tag@name extracts a numeric attribute (Y on eq)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'report.xml'), '<coverage line-rate="88" branch-rate="70"></coverage>')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'attr:coverage@line-rate', op: 'eq', expected: 88 },
    })
    expect(r.verdict).toBe('Y')
  })

  it('attr: without an @ ⇒ N (no metric)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'report.xml'), '<coverage rate="9"/>')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'attr:coverage', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('attr: with an empty tag or attr ⇒ N (no metric)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'report.xml'), '<coverage rate="9"/>')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'attr:@rate', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('attr: when the tag element is not found ⇒ N (no metric)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'report.xml'), '<other rate="9"/>')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'attr:coverage@rate', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('attr: with a regex-metachar attr name fails closed to N (no throw)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'report.xml'), '<coverage rate="9">x</coverage>')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'attr:coverage@(', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('attr: when the attribute is absent on the element ⇒ N (regex no match)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'report.xml'), '<coverage other="9"></coverage>')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'attr:coverage@rate', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('attr: when the captured attribute is non-numeric ⇒ N (non-finite)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'report.xml'), '<coverage rate="high"></coverage>')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'attr:coverage@rate', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('an unknown xml selector prefix ⇒ N (no metric)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'report.xml'), '<root/>')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'bogus:thing', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('attr: with an unclosed element (no >) slices to EOF and still extracts', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'report.xml'), '<coverage rate="55"')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'report.xml', format: 'xml', select: 'attr:coverage@rate', op: 'gte', expected: 50 },
    })
    expect(r.verdict).toBe('Y')
  })
})

describe('value report extraction — regex selector', () => {
  it('Y when capture group 1 is a number satisfying the op', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'out.txt'), 'Coverage: 95.5% of lines')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'out.txt', format: 'regex', select: 'Coverage: ([0-9.]+)%', op: 'gte', expected: 90 },
    })
    expect(r.verdict).toBe('Y')
  })

  it('N (no metric) on an invalid regex', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'out.txt'), 'whatever')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'out.txt', format: 'regex', select: '([0-9', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('N (no metric) when the regex does not match', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'out.txt'), 'no numbers here')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'out.txt', format: 'regex', select: 'X([0-9]+)Y', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('N (no metric) when the regex has no capture group', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'out.txt'), 'value 7')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'out.txt', format: 'regex', select: 'value [0-9]+', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })

  it('N (no metric) when the captured group is non-numeric', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'out.txt'), 'value=abc')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'out.txt', format: 'regex', select: 'value=(\\w+)', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })
})

describe('value report extraction — unknown format ⇒ no metric ⇒ N', () => {
  it('an unsupported format yields N (extractMetric falls through to null)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.dat'), 'anything')
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'r.dat', format: 'yaml', select: 'x', op: 'gte', expected: 1 },
    })
    expect(r.verdict).toBe('N')
  })
})

describe('value report extraction — comparison operators', () => {
  it('lte passes when actual <= bar', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.json'), JSON.stringify({ n: 3 }))
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'r.json', format: 'json', select: 'n', op: 'lte', expected: 5 },
    })
    expect(r.verdict).toBe('Y')
  })

  it('eq fails when actual !== bar', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.json'), JSON.stringify({ n: 3 }))
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'r.json', format: 'json', select: 'n', op: 'eq', expected: 4 },
    })
    expect(r.verdict).toBe('N')
  })

  it('an unknown op fails closed (false ⇒ N)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.json'), JSON.stringify({ n: 3 }))
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'r.json', format: 'json', select: 'n', op: 'between', expected: 3 },
    })
    expect(r.verdict).toBe('N')
  })
})

describe('value report extraction — threshold_ref bar resolution', () => {
  it('resolves the bar from the thresholds table for the active brownfield class (Y)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.json'), JSON.stringify({ pct: 70 }))
    const options: EvaluateOptions = {
      thresholds: { coverage: { gold: 90, light: 60, medium: 70, heavy: 50 } },
      brownfieldClass: 'light',
    }
    const r = verdictOf(
      root,
      {
        id: 'R',
        type: 'value',
        args: { path: 'r.json', format: 'json', select: 'pct', op: 'gte' },
        threshold_ref: 'coverage',
      },
      [],
      options,
    )
    // class=light ⇒ bar 60; 70 >= 60 ⇒ Y
    expect(r.verdict).toBe('Y')
  })

  it('defaults the class to gold when brownfieldClass is unset', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.json'), JSON.stringify({ pct: 70 }))
    const options: EvaluateOptions = {
      thresholds: { coverage: { gold: 90, light: 60 } },
    }
    const r = verdictOf(
      root,
      {
        id: 'R',
        type: 'value',
        args: { path: 'r.json', format: 'json', select: 'pct', op: 'gte' },
        threshold_ref: 'coverage',
      },
      [],
      options,
    )
    // class defaults to gold ⇒ bar 90; 70 >= 90 is false ⇒ N
    expect(r.verdict).toBe('N')
  })

  it('unresolved threshold (ref not in table) ⇒ N', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.json'), JSON.stringify({ pct: 70 }))
    const r = verdictOf(
      root,
      {
        id: 'R',
        type: 'value',
        args: { path: 'r.json', format: 'json', select: 'pct', op: 'gte' },
        threshold_ref: 'missing-ref',
      },
      [],
      { thresholds: { other: { gold: 1 } } },
    )
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('unresolved threshold')
  })

  it('unresolved threshold (class missing from the row) ⇒ N', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.json'), JSON.stringify({ pct: 70 }))
    const r = verdictOf(
      root,
      {
        id: 'R',
        type: 'value',
        args: { path: 'r.json', format: 'json', select: 'pct', op: 'gte' },
        threshold_ref: 'coverage',
      },
      [],
      { thresholds: { coverage: { gold: 90 } }, brownfieldClass: 'heavy' },
    )
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('unresolved threshold')
  })

  it('unresolved threshold (no table, no literal expected) ⇒ N', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.json'), JSON.stringify({ pct: 70 }))
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'r.json', format: 'json', select: 'pct', op: 'gte' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('unresolved threshold')
  })

  it('literal expected is used when threshold_ref is empty string', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.json'), JSON.stringify({ pct: 70 }))
    const r = verdictOf(root, {
      id: 'R',
      type: 'value',
      args: { path: 'r.json', format: 'json', select: 'pct', op: 'gte', expected: 50 },
      threshold_ref: '',
    })
    expect(r.verdict).toBe('Y')
  })
})

// ── forbidden_pattern: anti-fake-green ladder (#1470) ────────────────────────────

describe('forbidden_pattern ladder', () => {
  it('empty/non-string pattern ⇒ N', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: '' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('empty or non-string pattern')
  })

  it('invalid regex pattern ⇒ N', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: '([unterminated' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('invalid regex')
  })

  it('invalid/empty glob ⇒ N', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '', pattern: 'TODO' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('invalid or empty glob')
  })

  it('glob matched 0 files ⇒ NA', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'only.md'), 'text')
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'TODO' },
    })
    expect(r.verdict).toBe('NA')
  })

  it('pattern absent across all scanned files ⇒ Y', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.ts'), 'const x = 1')
    writeFileSync(join(root, 'b.ts'), 'const y = 2')
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'FIXME' },
    })
    expect(r.verdict).toBe('Y')
    expect(r.detail).toContain('absent across')
  })

  it('pattern present ⇒ N with the first SORTED file + line', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'b.ts'), 'line\nconst x = 1')
    writeFileSync(join(root, 'a.ts'), 'first\nFIXME here\nthird')
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'FIXME' },
    })
    expect(r.verdict).toBe('N')
    // a.ts sorts first and holds the marker
    expect(r.file).toBe('a.ts')
    expect(r.detail).toBe('forbidden pattern present')
  })

  it('exclude_paths entry with a glob char ⇒ N (literal-only)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.ts'), 'x')
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'TODO', exclude_paths: ['gen/*.ts'], rationale: 'why' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('must be literal')
  })

  it('exclude_paths with a non-string entry ⇒ N (literal-only)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.ts'), 'x')
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'TODO', exclude_paths: [42], rationale: 'why' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('must be literal')
  })

  it('exclude_paths set without a rationale ⇒ N', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.ts'), 'x')
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'TODO', exclude_paths: ['a.ts'] },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('requires a rationale')
  })

  it('excludes that remove ALL matched files ⇒ N (refusing fake-green)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.ts'), 'TODO')
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'TODO', exclude_paths: ['a.ts'], rationale: 'generated' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('all matched files excluded')
  })

  it('a valid literal exclude with rationale narrows the scan but keeps a file ⇒ Y', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'gen.ts'), 'TODO is fine in generated')
    writeFileSync(join(root, 'src.ts'), 'clean')
    const r = verdictOf(root, {
      id: 'F',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'TODO', exclude_paths: ['gen.ts'], rationale: 'generated file' },
    })
    expect(r.verdict).toBe('Y')
  })
})

// ── file_stat: executable-bit ladder (#1470) ─────────────────────────────────────

const isPosix = platform() !== 'win32'

describe('file_stat ladder', () => {
  it('non-executable bit request ⇒ N (only the exec bit is deterministic)', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '*.sh', bit: 'readable' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('only the executable bit')
  })

  it('invalid/empty glob ⇒ N', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '', bit: 'executable' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('invalid or empty glob')
  })

  it('valid glob matching 0 files ⇒ NA', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'note.md'), 'x')
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '*.sh', bit: 'executable' },
    })
    expect(r.verdict).toBe('NA')
  })

  it('core.fileMode = false ⇒ NA (git does not track the exec bit)', () => {
    const root = tmpRoot()
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'config'), '[core]\n\tfilemode = false\n')
    writeFileSync(join(root, 'run.sh'), '#!/bin/sh\n')
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '*.sh', bit: 'executable' },
    })
    expect(r.verdict).toBe('NA')
  })

  it('honors the LAST filemode value when the key is declared twice', () => {
    const root = tmpRoot()
    mkdirSync(join(root, '.git'))
    // first false, then true ⇒ git honors the last ⇒ enabled ⇒ NOT NA
    writeFileSync(join(root, '.git', 'config'), '[core]\n\tfilemode = false\n\tfilemode = true\n')
    writeFileSync(join(root, 'run.sh'), '#!/bin/sh\n')
    if (isPosix) chmodSync(join(root, 'run.sh'), 0o644)
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '*.sh', bit: 'executable' },
    })
    // filemode enabled + a non-exec file ⇒ N, not NA
    expect(r.verdict).toBe(isPosix ? 'N' : 'Y')
  })

  it('ignores a [core "subsection"] header (not the top-level [core])', () => {
    const root = tmpRoot()
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'config'), '[core "weird"]\n\tfilemode = false\n')
    writeFileSync(join(root, 'run.sh'), '#!/bin/sh\n')
    if (isPosix) chmodSync(join(root, 'run.sh'), 0o644)
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '*.sh', bit: 'executable' },
    })
    // subsection filemode is ignored ⇒ default enabled ⇒ non-exec file ⇒ N
    expect(r.verdict).toBe(isPosix ? 'N' : 'Y')
  })

  it('missing .git/config ⇒ filemode treated as enabled', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'run.sh'), '#!/bin/sh\n')
    if (isPosix) chmodSync(join(root, 'run.sh'), 0o755)
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '*.sh', bit: 'executable' },
    })
    expect(r.verdict).toBe('Y')
  })

  it('all matched files executable ⇒ Y', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.sh'), '#!/bin/sh\n')
    writeFileSync(join(root, 'b.sh'), '#!/bin/sh\n')
    if (isPosix) {
      chmodSync(join(root, 'a.sh'), 0o755)
      chmodSync(join(root, 'b.sh'), 0o755)
    }
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '*.sh', bit: 'executable' },
    })
    expect(r.verdict).toBe('Y')
    if (isPosix) expect(r.detail).toContain('executable across')
  })

  it('no matched files executable ⇒ N (posix)', () => {
    if (!isPosix) return
    const root = tmpRoot()
    writeFileSync(join(root, 'a.sh'), '#!/bin/sh\n')
    chmodSync(join(root, 'a.sh'), 0o644)
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '*.sh', bit: 'executable' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('not executable')
  })

  it('some-but-not-all executable ⇒ P (posix)', () => {
    if (!isPosix) return
    const root = tmpRoot()
    writeFileSync(join(root, 'a.sh'), '#!/bin/sh\n')
    writeFileSync(join(root, 'b.sh'), '#!/bin/sh\n')
    chmodSync(join(root, 'a.sh'), 0o755)
    chmodSync(join(root, 'b.sh'), 0o644)
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '*.sh', bit: 'executable' },
    })
    expect(r.verdict).toBe('P')
    expect(r.detail).toContain('executable 1/2')
  })

  it('a symlink is never counted as executable (anti-fake-green, posix)', () => {
    if (!isPosix) return
    const root = tmpRoot()
    writeFileSync(join(root, 'real.txt'), 'data')
    symlinkSync(join(root, 'real.txt'), join(root, 'link.sh'))
    const r = verdictOf(root, {
      id: 'S',
      type: 'file_stat',
      args: { glob: '*.sh', bit: 'executable' },
    })
    // lstat on the symlink: never executable ⇒ none exec ⇒ N
    expect(r.verdict).toBe('N')
  })
})

// ── version_consistency: P/N branch ladder ───────────────────────────────────────

describe('version_consistency ladder', () => {
  it('Y when VERSION equals the latest CHANGELOG entry', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'VERSION'), '1.2.3\n')
    writeFileSync(join(root, 'CHANGELOG.md'), '## [1.2.3] - 2024\n## [1.0.0] - 2023\n')
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: {
        version_file: 'VERSION',
        changelog_file: 'CHANGELOG.md',
        changelog_pattern: '^## \\[([0-9.]+)\\]',
      },
    })
    expect(r.verdict).toBe('Y')
  })

  it('P when VERSION and CHANGELOG diverge', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'VERSION'), '2.0.0\n')
    writeFileSync(join(root, 'CHANGELOG.md'), '## [1.2.3] - 2024\n')
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: {
        version_file: 'VERSION',
        changelog_file: 'CHANGELOG.md',
        changelog_pattern: '^## \\[([0-9.]+)\\]',
      },
    })
    expect(r.verdict).toBe('P')
    expect(r.detail).toContain('!=')
  })

  it('P (empty version file) when VERSION is blank', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'VERSION'), '   \n')
    writeFileSync(join(root, 'CHANGELOG.md'), '## [1.2.3]\n')
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: {
        version_file: 'VERSION',
        changelog_file: 'CHANGELOG.md',
        changelog_pattern: '^## \\[([0-9.]+)\\]',
      },
    })
    expect(r.verdict).toBe('P')
    expect(r.detail).toContain('empty version file')
  })

  it('P when no changelog entry matches the pattern', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'VERSION'), '1.0.0\n')
    writeFileSync(join(root, 'CHANGELOG.md'), 'no version headers here')
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: {
        version_file: 'VERSION',
        changelog_file: 'CHANGELOG.md',
        changelog_pattern: '^## \\[([0-9.]+)\\]',
      },
    })
    expect(r.verdict).toBe('P')
    expect(r.detail).toContain('no changelog entry')
  })

  it('P when the changelog pattern is an invalid regex (no match ⇒ indeterminate)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'VERSION'), '1.0.0\n')
    writeFileSync(join(root, 'CHANGELOG.md'), '## [1.0.0]\n')
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: {
        version_file: 'VERSION',
        changelog_file: 'CHANGELOG.md',
        changelog_pattern: '([bad',
      },
    })
    expect(r.verdict).toBe('P')
  })

  it('P when the changelog pattern is missing / non-string', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'VERSION'), '1.0.0\n')
    writeFileSync(join(root, 'CHANGELOG.md'), '## [1.0.0]\n')
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: { version_file: 'VERSION', changelog_file: 'CHANGELOG.md' },
    })
    expect(r.verdict).toBe('P')
  })

  it('P when the captured changelog version is empty (falsy capture ⇒ not a version)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'VERSION'), '1.0.0\n')
    writeFileSync(join(root, 'CHANGELOG.md'), 'release:\n')
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: {
        version_file: 'VERSION',
        changelog_file: 'CHANGELOG.md',
        // matches "release:" but captures an empty group
        changelog_pattern: '^release:(.*)$',
      },
    })
    expect(r.verdict).toBe('P')
  })

  it('N (invalid path) when the version file path traverses out of root', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: {
        version_file: '../escape',
        changelog_file: 'CHANGELOG.md',
        changelog_pattern: '^## \\[([0-9.]+)\\]',
      },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('invalid path')
  })

  it('N (missing version file)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'CHANGELOG.md'), '## [1.0.0]\n')
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: {
        version_file: 'NO_VERSION',
        changelog_file: 'CHANGELOG.md',
        changelog_pattern: '^## \\[([0-9.]+)\\]',
      },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('missing version file')
  })

  it('N (missing changelog)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'VERSION'), '1.0.0\n')
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: {
        version_file: 'VERSION',
        changelog_file: 'NO_CHANGELOG',
        changelog_pattern: '^## \\[([0-9.]+)\\]',
      },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('missing changelog')
  })

  it('N (invalid path) when both file args are non-string (empty)', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'VC',
      type: 'version_consistency',
      args: {},
    })
    // both vFile and cFile coerce to '', safeResolve('') is the root dir, readText(dir) ⇒ null
    expect(r.verdict).toBe('N')
  })
})

// ── single-file dispatch guards ──────────────────────────────────────────────────

describe('single-file path guards', () => {
  it('non-string (numeric) path ⇒ N invalid path', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'P',
      type: 'file_exists',
      // a malformed registry can carry a numeric path
      args: { path: 7 },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('invalid path')
  })

  it('missing path key ⇒ N invalid path', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'P',
      type: 'file_exists',
      args: {},
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('invalid path')
  })

  it('traversal path ⇒ N invalid path (safeResolve null)', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'P',
      type: 'file_exists',
      args: { path: '../outside' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('invalid path')
  })

  it('file_exists on an unreadable-stat path is handled (directory ⇒ N)', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'adir'))
    const r = verdictOf(root, {
      id: 'P',
      type: 'file_exists',
      args: { path: 'adir' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('is a directory')
  })

  it('count_matches with a partial count ⇒ P', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'f.ts'), 'test(\nnothing\n')
    const r = verdictOf(root, {
      id: 'C',
      type: 'count_matches',
      args: { path: 'f.ts', pattern: 'test(', min: 3 },
    })
    expect(r.verdict).toBe('P')
    expect(r.detail).toContain('count=1/3')
  })

  it('count_matches on a missing file ⇒ N', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'C',
      type: 'count_matches',
      args: { path: 'gone.ts', pattern: 'x', min: 1 },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('missing')
  })

  it('file_contains on a missing file ⇒ N', () => {
    const root = tmpRoot()
    const r = verdictOf(root, {
      id: 'FC',
      type: 'file_contains',
      args: { path: 'gone.ts', pattern: 'x' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toBe('missing')
  })

  it('numeric YAML pattern is String()-coerced (no Y→N flip)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'f.txt'), 'version 7 here')
    const r = verdictOf(root, {
      id: 'FC',
      type: 'file_contains',
      // a bare numeric YAML scalar
      args: { path: 'f.txt', pattern: 7 },
    })
    expect(r.verdict).toBe('Y')
  })
})

// ── unknown / missing type ───────────────────────────────────────────────────────

describe('type dispatch', () => {
  it('a check missing its type ⇒ N (unknown type, fail-closed)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'f.txt'), 'x')
    const r = verdictOf(root, {
      id: 'U',
      args: { path: 'f.txt' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('unknown check type')
  })
})

// ── overlays / applies_if ────────────────────────────────────────────────────────

describe('applies_if overlays', () => {
  it("applies_if 'always' always applies", () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.md'), 'x')
    const r = verdictOf(
      root,
      { id: 'A', type: 'file_exists', args: { path: 'r.md' }, applies_if: 'always' },
      [],
    )
    expect(r.verdict).toBe('Y')
  })

  it('overlays passed as a plain array (not a Set) are normalized', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'r.md'), 'x')
    const result = evaluate(
      { checks: [{ id: 'A', type: 'file_exists', args: { path: 'r.md' }, applies_if: 'frontend' }] },
      ['frontend'],
      root,
    )
    expect(result.checks[0]?.verdict).toBe('Y')
  })

  it('null overlays normalize to an empty set', () => {
    const root = tmpRoot()
    const result = evaluate(
      { checks: [{ id: 'A', type: 'file_exists', args: { path: 'r.md' }, applies_if: 'frontend' }] },
      null,
      root,
    )
    expect(result.checks[0]?.verdict).toBe('NA')
  })
})

// ── scoring / dimensions / risky / weights ───────────────────────────────────────

describe('scoring and dimension accumulation', () => {
  it('groups checks by dimension and computes per-dimension scores', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.md'), 'x')
    const registry: RegistryInput = {
      version: '2',
      checks: [
        { id: 'A1', type: 'file_exists', args: { path: 'a.md' }, dimension: 'D-DOCS', weight: 2 },
        { id: 'A2', type: 'file_exists', args: { path: 'gone.md' }, dimension: 'D-DOCS', weight: 2 },
        { id: 'B1', type: 'file_exists', args: { path: 'a.md' }, dimension: 'D-CODE' },
      ],
    }
    const result = evaluate(registry, new Set<string>(), root)
    expect(result.dimensions['D-DOCS']).toEqual({ score: 50, y: 1 })
    expect(result.dimensions['D-CODE']).toEqual({ score: 100, y: 1 })
    // overall: earned (2 + 0 + 1) / possible (2 + 2 + 1) = 3/5 = 60
    expect(result.score).toBe(60)
    expect(result.yCount).toBe(2)
  })

  it('defaults the dimension to D-UNCLASSIFIED when absent', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.md'), 'x')
    const result = evaluate(
      { checks: [{ id: 'A', type: 'file_exists', args: { path: 'a.md' } }] },
      new Set<string>(),
      root,
    )
    expect(result.dimensions['D-UNCLASSIFIED']).toBeDefined()
  })

  it('counts RISKY checks and treats non-RISKY as SAFE', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.md'), 'x')
    const result = evaluate(
      {
        checks: [
          { id: 'A', type: 'file_exists', args: { path: 'a.md' }, risk: 'RISKY' },
          { id: 'B', type: 'file_exists', args: { path: 'a.md' }, risk: 'whatever' },
        ],
      },
      new Set<string>(),
      root,
    )
    expect(result.riskyCount).toBe(1)
    expect(result.checks.find((c) => c.id === 'A')?.risk).toBe('RISKY')
    expect(result.checks.find((c) => c.id === 'B')?.risk).toBe('SAFE')
  })

  it('a YAML-quoted weight is Number()-coerced (sums, not concatenates)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.md'), 'x')
    const result = evaluate(
      {
        checks: [
          { id: 'A', type: 'file_exists', args: { path: 'a.md' }, weight: '2' },
          { id: 'B', type: 'file_exists', args: { path: 'gone.md' }, weight: '2' },
        ],
      },
      new Set<string>(),
      root,
    )
    // 2/4 = 50
    expect(result.score).toBe(50)
    expect(result.checks[0]?.weight).toBe(2)
  })

  it('emits an anchor string when present and null otherwise', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.md'), 'x')
    const result = evaluate(
      {
        checks: [
          { id: 'A', type: 'file_exists', args: { path: 'a.md' }, anchor: 'docs#section' },
          { id: 'B', type: 'file_exists', args: { path: 'a.md' } },
        ],
      },
      new Set<string>(),
      root,
    )
    expect(result.checks.find((c) => c.id === 'A')?.anchor).toBe('docs#section')
    expect(result.checks.find((c) => c.id === 'B')?.anchor).toBeNull()
  })

  it('NA and NV checks are excluded from the score denominator', () => {
    const root = tmpRoot()
    const result = evaluate(
      {
        checks: [
          { id: 'A', type: 'manual' }, // NV
          { id: 'B', type: 'file_exists', args: { path: 'gone' }, applies_if: 'x' }, // NA
        ],
      },
      new Set<string>(),
      root,
    )
    expect(result.score).toBe(0)
    expect(result.totals.nv).toBe(1)
    expect(result.totals.na).toBe(1)
  })
})

// ── fail-closed normalization ────────────────────────────────────────────────────

describe('evaluate normalization and fail-closed', () => {
  it('drops non-object entries in the checks array', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.md'), 'x')
    const registry = {
      checks: [null, { id: 'A', type: 'file_exists', args: { path: 'a.md' } }, undefined],
    } as unknown as RegistryInput
    const result = evaluate(registry, new Set<string>(), root)
    expect(result.totals.checks).toBe(1)
    expect(result.checks[0]?.id).toBe('A')
  })

  it('coerces a non-string options to an empty options object', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.md'), 'x')
    const result = evaluate(
      { checks: [{ id: 'A', type: 'file_exists', args: { path: 'a.md' } }] },
      new Set<string>(),
      root,
      // an accidental non-object options
      'oops' as unknown as EvaluateOptions,
    )
    expect(result.checks[0]?.verdict).toBe('Y')
  })

  it('defaults registryVersion to "0" when version is absent', () => {
    const root = tmpRoot()
    const result = evaluate({ checks: [] }, new Set<string>(), root)
    expect(result.registryVersion).toBe('0')
  })

  it('coerces a numeric id without throwing (sort + emit)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.md'), 'x')
    const registry = {
      checks: [{ id: 2, type: 'file_exists', args: { path: 'a.md' } }],
    } as unknown as RegistryInput
    const result = evaluate(registry, new Set<string>(), root)
    expect(result.checks[0]?.id).toBe('2')
  })
})

// ── checkNoRegress / ratchet / baselineOf branch edges ──────────────────────────

describe('checkNoRegress branch edges', () => {
  function res(score: number, yCount: number): EngineResult {
    return {
      registryVersion: '1',
      score,
      yCount,
      riskyCount: 0,
      totals: { checks: 0, y: yCount, p: 0, n: 0, na: 0, nv: 0 },
      dimensions: {},
      checks: [],
    }
  }

  it('reports both score and yCount regressions together', () => {
    const r = checkNoRegress(res(70, 3), { score: 90, yCount: 5 })
    expect(r.ok).toBe(false)
    expect(r.reasons).toHaveLength(2)
  })

  it('ok when both are higher than baseline', () => {
    const r = checkNoRegress(res(95, 6), { score: 90, yCount: 5 })
    expect(r.ok).toBe(true)
  })
})

describe('ratchet branch edges', () => {
  it('per-dimension max across the union of dimension keys', () => {
    const current: EngineResult = {
      registryVersion: '1',
      score: 80,
      yCount: 4,
      riskyCount: 0,
      totals: { checks: 0, y: 4, p: 0, n: 0, na: 0, nv: 0 },
      dimensions: { 'D-A': { score: 90, y: 3 }, 'D-C': { score: 50, y: 1 } },
      checks: [],
    }
    const baseline = {
      score: 70,
      yCount: 5,
      dimensions: { 'D-A': { score: 60, y: 4 }, 'D-B': { score: 100, y: 2 } },
    }
    const r = ratchet(current, baseline)
    expect(r.score).toBe(80) // max(80,70)
    expect(r.yCount).toBe(5) // max(4,5)
    // D-A: max(90,60)/max(3,4); D-B present only in baseline; D-C only in current
    expect(r.dimensions['D-A']).toEqual({ score: 90, y: 4 })
    expect(r.dimensions['D-B']).toEqual({ score: 100, y: 2 })
    expect(r.dimensions['D-C']).toEqual({ score: 50, y: 1 })
  })
})

// ── #1525: ReDoS + unbounded-read hardening on untrusted registry regexes ────────────────────────

describe('hasNestedUnboundedQuantifier (ReDoS guard, #1525)', () => {
  it('flags the catastrophic nested-unbounded-quantifier family', () => {
    for (const p of [
      '(a+)+$',
      '(a*)*',
      '(a+)*',
      '(.*)+',
      '((a+))+',
      '(a+){2,}',
      '(?:a+)+',
      '([a-z]+)*',
    ]) {
      expect(hasNestedUnboundedQuantifier(p), `should flag: ${p}`).toBe(true)
    }
  })

  it('does NOT flag safe / linear patterns (no false positives)', () => {
    for (const p of [
      String.raw`^##\s*\[?(\d+\.\d+\.\d+)`, // real changelog_pattern
      String.raw`type="LINE"[^>]*covered="(\d+)"`, // real java coverage select
      String.raw`<coverage[^>]*line-rate="([0-9.]+)"`, // real rust coverage select
      'Coverage: ([0-9.]+)%',
      String.raw`value=(\w+)`,
      '^release:(.*)$',
      '(a+)', // a quantified group, but not itself quantified
      '(a+)?', // a bounded (?) outer quantifier is not catastrophic
      '(a+){2}', // a bounded {n} outer quantifier
      'a+b+', // two unbounded quantifiers, not nested
      '(a+)b+', // sibling, not nested
      '(a+)(b)+', // the outer + applies to (b), which has no inner quantifier
      '[0-9]+',
      'FIXME_MARKER',
    ]) {
      expect(hasNestedUnboundedQuantifier(p), `should NOT flag: ${p}`).toBe(false)
    }
  })
})

describe('forbidden_pattern ReDoS guard (#1525)', () => {
  it('rejects a catastrophic pattern as N WITHOUT hanging on an adversarial file', { timeout: 3000 }, () => {
    const root = tmpRoot()
    // 50k "a" + "!" — would wedge new RegExp("(a+)+$").exec() for effectively forever unguarded.
    writeFileSync(join(root, 'evil.ts'), 'a'.repeat(50_000) + '!')
    const t0 = Date.now()
    const r = verdictOf(root, {
      id: 'FP-REDOS',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: '(a+)+$' },
    })
    // Rejected at compile-guard before any file is scanned ⇒ N, fast.
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('unsafe regex (ReDoS risk)')
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('still scans normally for a safe pattern (guard does not over-reject)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'a.ts'), 'const a = 1 // FIXME_MARKER here\n')
    const present = verdictOf(root, {
      id: 'FP-SAFE-N',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'FIXME_MARKER' },
    })
    expect(present.verdict).toBe('N')
    expect(present.detail).toBe('forbidden pattern present')
    const absent = verdictOf(root, {
      id: 'FP-SAFE-Y',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'XYZZY_NEVER' },
    })
    expect(absent.verdict).toBe('Y')
  })

  it('fails closed (N) on a matched file exceeding the scan cap — never a fake-green Y', () => {
    const root = tmpRoot()
    // > MAX_SCAN_BYTES of a benign char; the pattern is absent, but we refuse to read it ⇒ N.
    writeFileSync(join(root, 'big.ts'), 'x'.repeat(MAX_SCAN_BYTES + 1))
    const r = verdictOf(root, {
      id: 'FP-BIG',
      type: 'forbidden_pattern',
      args: { glob: '*.ts', pattern: 'NOPE_NOT_PRESENT' },
    })
    expect(r.verdict).toBe('N')
    expect(r.detail).toContain('too large to scan')
  })
})

describe('readScanText (input cap, #1525)', () => {
  it('reads a normal file', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'f.txt'), 'hello')
    const r = readScanText(join(root, 'f.txt'))
    expect(r).toEqual({ ok: true, text: 'hello' })
  })

  it('reports unreadable for a missing file', () => {
    const root = tmpRoot()
    expect(readScanText(join(root, 'absent.txt'))).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('reports oversize for a file beyond the cap', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'big.txt'), 'y'.repeat(MAX_SCAN_BYTES + 1))
    expect(readScanText(join(root, 'big.txt'))).toEqual({ ok: false, reason: 'oversize' })
  })
})

describe('baselineOf', () => {
  it('extracts only the ratchet-compared subset', () => {
    const current: EngineResult = {
      registryVersion: '9',
      score: 42,
      yCount: 7,
      riskyCount: 2,
      totals: { checks: 10, y: 7, p: 0, n: 3, na: 0, nv: 0 },
      dimensions: { 'D-X': { score: 100, y: 7 } },
      checks: [],
    }
    const b = baselineOf(current)
    expect(b).toEqual({ score: 42, yCount: 7, dimensions: { 'D-X': { score: 100, y: 7 } } })
  })
})
