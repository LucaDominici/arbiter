#!/usr/bin/env node
// go-library — anti-proforma test gate (INV-118, §R-41)
// CATALOG: INV-118 enforcement. Detects proforma (no-assertion) test methods in TypeScript/JavaScript
// CATALOG:   test files. Recognized assertions: expect(, assert., toBe(, toEqual(, toThrow(,
// CATALOG:   toHaveLength(, toContain(, assertThat, verify(. Bypass via
// CATALOG:   `// anti-proforma-exempt: <rationale>` comment. Bypass counter alarmed above 5% threshold.
// CATALOG: Rejected fold-in into check-test-naming.mjs (naming convention gate, different axis).
// CATALOG: Rejected fold-in into check-no-skipped-tests.mjs (skipped tests, not proforma tests).
//
// #2031 — the line/brace heuristic this replaced had three structural false-positive
// classes and one false-negative class, and ALL 19 tests it flagged in run #2000 were
// false positives:
//   1. Naive brace counting broke on `}` inside strings/regex/comments, and on the
//      `it(name, { timeout }, fn)` option-object form where depth returned to 0 on the
//      options literal — the block "closed" before the body was ever read.
//   2. `expect` inside a local helper called from the test body was invisible.
//   3. Template-string fixtures containing `it(` at line start parsed as test blocks.
//   4. False negative: `expect(SOME_MODULE_SCOPE_CONST).toBeDefined()` — a masked
//      tautology — counted as a real assertion.
// The fix is a literal-masking pass (strings/templates/regex/comments blanked, offsets and
// line structure preserved) plus PAREN-matched block extents, in-file assertion-helper
// attribution, and a tautology denylist. Deliberately NOT an AST/TypeScript-parser pass:
// the shipped template twin runs inside consumer projects that need not have `typescript`
// installed, and a self-only parser would fork the two implementations.
//
// Exit codes per INV-53: 0=PASS/WARN (warn-default), 1=FAIL (--enforce), 2=ERROR
// Usage: node scripts/check-anti-proforma.mjs [--dir=<path>] [--enforce] [--help]

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { walkRepo } from './lib/glob-walk.mjs';

const ROOT = process.cwd();

const HELP = `Usage: node scripts/check-anti-proforma.mjs [options]

Detects proforma test methods (no real assertions) in TypeScript/JavaScript test files.
Warn-default (exit 0) unless --enforce is set.

Options:
  --dir=<path>     Directory to scan for test files (default: repo root)
  --enforce        Promote to hard-block (exit 1) on violations
  --help, -h       Show this help and exit

Bypass:
  Add // anti-proforma-exempt: <rationale> in the test block to exclude it.
  Bypass ratio > 5% triggers EXEMPT-THRESHOLD warning.

Recognized assertion patterns:
  expect(   assert.   toBe(   toEqual(   toThrow(   toHaveLength(
  toContain(   assertThat   verify(   should.   toMatch(   toBeNull(

An assertion reached only through a helper defined in the same file counts. A block whose
only assertion is expect(<module-scope identifier>).toBeDefined()/toBeTruthy() does NOT —
that is a masked tautology, and it is reported.`;

const ASSERTION_PATTERNS = [
  /expect\s*\(/,
  /assert\./,
  /toBe\s*\(/,
  /toEqual\s*\(/,
  /toThrow\s*\(/,
  /toHaveLength\s*\(/,
  /toContain\s*\(/,
  /assertThat/,
  /verify\s*\(/,
  /should\./,
  /toMatch\s*\(/,
  /toBeNull\s*\(/,
  /toBeDefined\s*\(/,
  /toBeUndefined\s*\(/,
  /toBeGreaterThan\s*\(/,
  /toBeLessThan\s*\(/,
  /toHaveProperty\s*\(/,
  /toHaveBeenCalled\s*\(/,
  /toHaveBeenCalledWith\s*\(/,
  /toStrictEqual\s*\(/,
  /toBeInstanceOf\s*\(/,
];

// `it(`, `test(` and their dotted chained forms (each/concurrent/failing/… modifiers).
// Matched against the MASKED source, so an `it(` living inside a fixture string is gone.
const TEST_CALL_RE = /(^|[^\w.$])(it|test)((?:\.\w+)*)\s*(\()/gm;
const EXEMPT_COMMENT_PATTERN = /\/\/\s*anti-proforma-exempt:/i;

// A bare identifier asserted merely to be defined/truthy proves nothing when the identifier
// is a module-scope binding the test never produced. Member expressions (expect(mod.foo))
// are excluded on purpose: asserting that an export exists is a real, if small, check.
const TAUTOLOGY_RE =
  /expect\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.\s*(?:toBeDefined|toBeTruthy)\s*\(\s*\)/g;

/**
 * Returns true if the filename is a test file.
 */
function isTestFile(name) {
  return (
    name.endsWith('.test.ts') ||
    name.endsWith('.spec.ts') ||
    name.endsWith('.test.js') ||
    name.endsWith('.spec.js') ||
    name.endsWith('.test.mjs') ||
    name.endsWith('.spec.mjs')
  );
}

/**
 * Parse CLI arguments. Handles both --dir=<value> and --dir <value> forms.
 */
function parseArgs() {
  const raw = process.argv.slice(2);
  let dir = ROOT;
  let enforce = false;
  let help = false;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--enforce') {
      enforce = true;
    } else if (arg.startsWith('--dir=')) {
      dir = resolve(arg.slice('--dir='.length));
    } else if (arg === '--dir' && i + 1 < raw.length && !raw[i + 1].startsWith('--')) {
      dir = resolve(raw[i + 1]);
      i++;
    }
  }

  return { dir, enforce, help };
}

/**
 * Collect test files under `dir` via the shared, cycle-safe walker (#1521). walkRepo's SKIP_DIRS
 * already prune node_modules/.git/dist/build/coverage/.coverage.
 */
function collectTestFiles(dir) {
  const files = [];
  for (const rel of walkRepo(dir)) {
    if (isTestFile(rel.slice(rel.lastIndexOf('/') + 1))) files.push(join(dir, rel));
  }
  return files;
}

/** Can a `/` at this point start a regex literal rather than be a division operator? */
function regexAllowedAfter(prev) {
  return prev === '' || '(,=:[!&|?{};+-*%~^<>\n'.includes(prev);
}

function blankInto(out, i) {
  if (out[i] !== '\n') out[i] = ' ';
}

/** Blank a single- or double-quoted string starting at `i`; returns the index just past it. */
function maskQuoted(src, out, i, quote) {
  blankInto(out, i++);
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\') blankInto(out, i++);
    if (i < src.length) blankInto(out, i++);
  }
  blankInto(out, i++);
  return i;
}

/**
 * Blank a template literal starting at the backtick `i`, leaving `${...}` interpolations
 * live (they hold real code). Returns the index just past the closing backtick.
 */
function maskTemplate(src, out, i) {
  blankInto(out, i++);
  while (i < src.length && src[i] !== '`') {
    if (src[i] === '\\') {
      blankInto(out, i++);
      if (i < src.length) blankInto(out, i++);
      continue;
    }
    if (src[i] === '$' && src[i + 1] === '{') {
      i += 2;
      let depth = 1;
      const start = i;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
        i++;
      }
      const inner = maskLiterals(src.slice(start, i));
      for (let k = 0; k < inner.length; k++) out[start + k] = inner[k];
      i++; // consume the closing }
      continue;
    }
    blankInto(out, i++);
  }
  blankInto(out, i++);
  return i;
}

/**
 * Blank a regex literal starting at `/` — but only if one actually terminates on this
 * line. Returns the index just past it, or -1 when this `/` was division after all.
 */
function maskRegex(src, out, i) {
  let j = i + 1;
  let inClass = false;
  let closed = false;
  while (j < src.length && src[j] !== '\n') {
    if (src[j] === '\\') {
      j += 2;
      continue;
    }
    if (src[j] === '[') inClass = true;
    else if (src[j] === ']') inClass = false;
    else if (src[j] === '/' && !inClass) {
      closed = true;
      break;
    }
    j++;
  }
  if (!closed) return -1;
  while (i <= j) blankInto(out, i++);
  while (i < src.length && /[a-z]/.test(src[i])) blankInto(out, i++);
  return i;
}

/**
 * Blank out every string, template literal, regex literal and comment, replacing their
 * contents with spaces. Output has the SAME length and the same newline positions as the
 * input, so offsets and line numbers computed on it are valid for the original.
 *
 * This is what kills FP classes 1 and 3: braces and `it(` occurrences that exist only
 * inside literal text simply are not there any more.
 */
export function maskLiterals(src) {
  const out = src.split('');
  let i = 0;
  let prevSignificant = '';

  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === '/' && c2 === '/') {
      while (i < src.length && src[i] !== '\n') blankInto(out, i++);
      continue;
    }
    if (c === '/' && c2 === '*') {
      blankInto(out, i++);
      blankInto(out, i++);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) blankInto(out, i++);
      blankInto(out, i++);
      blankInto(out, i++);
      continue;
    }
    if (c === "'" || c === '"') {
      i = maskQuoted(src, out, i, c);
      prevSignificant = 'x';
      continue;
    }
    if (c === '`') {
      i = maskTemplate(src, out, i);
      prevSignificant = 'x';
      continue;
    }
    if (c === '/' && regexAllowedAfter(prevSignificant)) {
      const next = maskRegex(src, out, i);
      if (next !== -1) {
        i = next;
        prevSignificant = 'x';
        continue;
      }
    }
    if (c === '\n') prevSignificant = '\n';
    else if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out.join('');
}

/**
 * Given the index of the `(` opening a call in `masked`, return the index just past its
 * matching `)`, or -1. Parens are the right bracket to match on: they close only at the end
 * of the whole `it(name, options, fn)` call, so an option object no longer truncates the
 * block the way brace counting did.
 */
export function matchParen(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Extent of the first `{...}` block at or after `from` in `masked`; -1 if unbalanced. */
function matchBrace(masked, from) {
  const open = masked.indexOf('{', from);
  if (open === -1) return -1;
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function hasDirectAssertion(text) {
  return ASSERTION_PATTERNS.some((pat) => pat.test(text));
}

function callsHelper(text, helpers) {
  for (const name of helpers) {
    if (new RegExp(`(^|[^\\w.$])${name}\\s*\\(`).test(text)) return true;
  }
  return false;
}

const DECL_RE =
  /(?:^|[^\w.$])(?:(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>))/g;

/**
 * Names of same-file functions whose body asserts — directly or through another such
 * helper. Iterated to a fixed point so a two-hop helper chain still counts (FP class 2).
 */
export function collectAssertionHelpers(src, masked) {
  const decls = [];
  DECL_RE.lastIndex = 0;
  let m;
  while ((m = DECL_RE.exec(masked)) !== null) {
    const name = m[1] ?? m[2];
    const end = matchBrace(masked, m.index + m[0].length - 1);
    // Concise arrow bodies have no braces: fall back to the rest of the statement.
    const nl = masked.indexOf('\n', m.index + m[0].length);
    const bodyEnd = end === -1 ? (nl === -1 ? src.length : nl) : end;
    decls.push({ name, body: src.slice(m.index, bodyEnd) });
  }

  const helpers = new Set();
  for (let pass = 0; pass < 4; pass++) {
    const before = helpers.size;
    for (const d of decls) {
      if (helpers.has(d.name)) continue;
      if (hasDirectAssertion(d.body) || callsHelper(d.body, helpers)) helpers.add(d.name);
    }
    if (helpers.size === before) break;
  }
  return helpers;
}

/** Module-scope binding names: imports plus top-level const/let/var/function declarations. */
export function collectModuleScopeBindings(masked) {
  const names = new Set();
  const importRe = /import\s+(?:type\s+)?([^'"]+?)\s+from\s*['"]/g;
  let m;
  while ((m = importRe.exec(masked)) !== null) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      for (const tok of part.trim().split(/\s+as\s+/)) {
        const t = tok.trim().replace(/^\*\s*/, '');
        if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
      }
    }
  }
  const topRe = /^(?:export\s+)?(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = topRe.exec(masked)) !== null) names.add(m[1]);
  return names;
}

/**
 * Every `it(...)`/`test(...)` call in the file, with the ORIGINAL text of its full call
 * expression. Extents are paren-matched on the masked source.
 */
export function extractTestBlocks(src) {
  const masked = maskLiterals(src);
  const lines = src.split('\n');
  const blocks = [];

  // File-level exemption: an exempt comment that is not attached to a specific test block.
  const fileLevelExempt = lines.some((l, idx) => {
    if (!EXEMPT_COMMENT_PATTERN.test(l)) return false;
    return !/^\s*(?:it|test)\b/.test(lines[idx + 1] ?? '');
  });

  TEST_CALL_RE.lastIndex = 0;
  let m;
  while ((m = TEST_CALL_RE.exec(masked)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    let end = matchParen(masked, openIdx);
    // Keep scanning from just past the call head, so a nested it() is still its own block.
    TEST_CALL_RE.lastIndex = openIdx + 1;
    if (end === -1) continue;
    // A skipped/todo block is check-no-skipped-tests.mjs's axis, not this one (see the
    // CATALOG note on the rejected fold-in). Counting it here would double-report it.
    if (/\.(?:skip|todo|skipIf|runIf)\b/.test(m[3])) continue;
    // Curried form: `it.each(table)(name, fn)` — the body lives in the SECOND call, so
    // absorb every immediately-following paren group or the block would look empty.
    for (;;) {
      let k = end;
      while (k < masked.length && /\s/.test(masked[k])) k++;
      if (masked[k] !== '(') break;
      const next = matchParen(masked, k);
      if (next === -1) break;
      end = next;
    }
    const startIdx = m.index + m[1].length;
    const lineNo = src.slice(0, startIdx).split('\n').length;
    blocks.push({
      lineNo,
      blockContent: src.slice(startIdx, end),
      exemptComment:
        fileLevelExempt ||
        EXEMPT_COMMENT_PATTERN.test(lineNo > 1 ? lines[lineNo - 2] : '') ||
        EXEMPT_COMMENT_PATTERN.test(lines[lineNo - 1] ?? ''),
    });
  }

  return blocks;
}

/**
 * Classify one block: 'ok' | 'no-assertion' | 'masked-tautology'.
 * `helpers` are same-file assertion helpers; `bindings` are module-scope names.
 */
export function classifyBlock(blockContent, helpers, bindings) {
  // Assertions are matched on the MASKED body, so an assertion that appears only inside a
  // fixture string or a comment cannot launder a genuinely empty test.
  const masked = maskLiterals(blockContent);
  const direct = hasDirectAssertion(masked);
  const viaHelper = callsHelper(masked, helpers);
  if (!direct && !viaHelper) return 'no-assertion';
  if (viaHelper) return 'ok';

  const expects = masked.match(/expect\s*\(/g) ?? [];
  if (expects.length === 0) return 'ok';
  TAUTOLOGY_RE.lastIndex = 0;
  const tautologies = [];
  let t;
  while ((t = TAUTOLOGY_RE.exec(masked)) !== null) tautologies.push(t[1]);
  const otherEvidence = [/assert\./, /assertThat/, /verify\s*\(/, /should\./].some((p) =>
    p.test(masked),
  );
  const allTautological =
    tautologies.length === expects.length &&
    !otherEvidence &&
    tautologies.every(
      (name) => bindings.has(name) && !new RegExp(`(?:const|let|var)\\s+${name}\\b`).test(masked),
    );
  return allTautological ? 'masked-tautology' : 'ok';
}

/** Scan one file's source; pure, so the tests can drive it without touching the disk. */
export function scanFile(file, src) {
  const masked = maskLiterals(src);
  const helpers = collectAssertionHelpers(src, masked);
  const bindings = collectModuleScopeBindings(masked);
  const findings = [];
  let total = 0;
  let exempt = 0;

  for (const block of extractTestBlocks(src)) {
    total++;
    if (block.exemptComment) {
      exempt++;
      continue;
    }
    const verdict = classifyBlock(block.blockContent, helpers, bindings);
    if (verdict === 'no-assertion') {
      findings.push({
        file,
        lineNo: block.lineNo,
        kind: 'PROFORMA',
        detail: 'test block has no recognized assertion',
      });
    } else if (verdict === 'masked-tautology') {
      findings.push({
        file,
        lineNo: block.lineNo,
        kind: 'TAUTOLOGY',
        detail:
          'only assertion is expect(<module-scope identifier>).toBeDefined()/toBeTruthy() — proves nothing about behavior',
      });
    }
  }
  return { findings, total, exempt };
}

function main() {
  const { dir, enforce, help } = parseArgs();

  if (help) {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  const testFiles = collectTestFiles(dir);

  let totalTests = 0;
  let violations = 0;
  let exemptTests = 0;

  for (const file of testFiles) {
    let content;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const { findings, total, exempt } = scanFile(file, content);
    totalTests += total;
    exemptTests += exempt;
    for (const f of findings) {
      violations++;
      process.stderr.write(`[anti-proforma] ${f.kind}: ${f.file}:${f.lineNo} — ${f.detail}\n`);
    }
  }

  // Bypass threshold alarm
  if (totalTests > 0 && exemptTests / totalTests > 0.05) {
    process.stderr.write(
      `[anti-proforma] EXEMPT-THRESHOLD: ${exemptTests}/${totalTests} tests are exempt (${Math.round((exemptTests / totalTests) * 100)}% > 5% threshold)\n`,
    );
  }

  if (violations > 0) {
    process.stderr.write(
      `[anti-proforma] ${violations} proforma test(s) found out of ${totalTests} scanned.\n`,
    );
    if (enforce) {
      process.exit(1);
    }
  }

  // Warn-default: exit 0 regardless of violations (unless --enforce)
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(
    `[anti-proforma] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(2);
}
