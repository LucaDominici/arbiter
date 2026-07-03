// SPDX-License-Identifier: Apache-2.0
// continue-on-error-core.mjs — parser-backed detection for the swallowed-gate guard (A3, #1497).
//
// A LIBRARY module under scripts/lib/, NOT a `check-*.mjs`, so it is exempt from the INV-94
// CATALOG-marker requirement (check-script-cohesion only scans /^check-.+\.mjs$/).
//
// The fake-green it catches: a GATING job/step carrying `continue-on-error: <truthy>`. A swallowed
// gate failure turns a red run green with the regression never surfaced. The novelty over the
// regex sibling (check-workflow-test-integrity): the truthy value is evaluated through the YAML 1.1
// boolean grammar, so the const-true forms a plain regex misses are caught —
//   continue-on-error: on        # YAML-1.1 `on`  → boolean true  (regex for `true` MISSES this)
//   continue-on-error: yes       # YAML-1.1 `yes` → boolean true
//   continue-on-error: ${{ true }}   # const-true GitHub expression
// js-yaml (when installed) confirms the boolean; otherwise the YAML-1.1 truthy-token set is the
// tolerant fallback — either way the `on:`/`yes:` trap is handled. A dynamic expression
// (`${{ <expr> }}`, `<%= ... %>`) is indeterminate ⇒ NOT flagged (conservative). The sole exempt
// step is an artifact up/download (its failure legitimately must not block CI); informational
// workflows, an audited `# arbiter-allow-continue-on-error` marker, and a step-scoped allowlist are
// also honored, mirroring the regex sibling's policy.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createRequire } from 'node:module'

// js-yaml is an OPTIONAL parser — present in arbiter's toolchain, absent in a fresh consumer. We
// load it lazily and fall back to the token grammar, so the guard never hard-depends on it.
let yamlLib = null
try {
  yamlLib = createRequire(import.meta.url)('js-yaml')
} catch {
  yamlLib = null
}

// Informational workflows whose best-effort steps are not gates (mirrors check-workflow-test-
// integrity). A swallowed step here is legitimate.
const INFORMATIONAL_PATTERNS = ['heartbeat', 'nightly', 'weekly', 'monthly', 'notify']

// Step-scoped allowlist (parity with the regex sibling): drift-shadow's `parity` step compares the
// local vs CI gate hash and must not fail the nightly run — a mismatch opens a drift issue instead.
const STEP_SCOPED_ALLOWLIST = {
  'drift-shadow.yml': new Set(['parity']),
}

// YAML 1.1 boolean tokens that resolve to TRUE. This set is what a plain `=== "true"` regex misses.
const TRUTHY_TOKENS = new Set(['true', 'on', 'yes', 'y'])

// A run/uses fragment that invokes a recognized GATE. Word-boundaried on the build-tool goals so a
// MUTATION runner (`mvn pitest:…`, `./gradlew pitest`, `stryker`, `go-mutesting`, `mutmut`) — which
// is legitimately non-blocking — is NOT mistaken for a gate. github-script/k6/artifact steps carry
// no gate token and are likewise not matched.
const GATE_COMMAND_RE =
  /\b(?:check-all(?:\.mjs)?|scripts\/check-[\w.-]+\.mjs|arbiter\s+(?:verify|gold-audit|anti-fake-green)|npm\s+(?:run\s+)?test|npm\s+run\s+(?:lint|gate|check[\w:-]*)|npx\s+(?:vitest|jest|eslint|tsc|playwright)\b|pnpm\s+(?:run\s+)?test|yarn\s+test|vitest\b|jest\b|pytest\b|cargo\s+(?:test|clippy)\b|go\s+test\b|(?:\.\/)?gradlew\b[^\n]*\b(?:test|check|verify)\b|mvn\b[^\n]*\b(?:test|verify)\b)/

/**
 * Classify a raw `continue-on-error:` value as const-true. Catches the YAML 1.1 `on`/`yes`/`y`
 * tokens and the `${{ true }}` const expression; treats a dynamic expression as indeterminate.
 * @param {string} rawValue text after `continue-on-error:` (may carry a trailing comment).
 * @returns {boolean} true when the value is unconditionally truthy.
 */
export function isConstTrueValue(rawValue) {
  let v = String(rawValue)
    .replace(/\s+#.*$/, '')
    .trim()
  if (v === '') return false
  if (/^\$\{\{\s*true\s*\}\}$/i.test(v)) return true // const-true GitHub expression
  if (v.includes('${{') || v.includes('<%')) return false // dynamic/EJS ⇒ indeterminate, not flagged
  v = v.replace(/^["']|["']$/g, '')
  if (TRUTHY_TOKENS.has(v.toLowerCase())) return true
  // Parser-backed confirmation for exotic forms (`!!bool yes`, `True`) when js-yaml is present.
  if (yamlLib && typeof yamlLib.load === 'function') {
    try {
      return yamlLib.load(`v: ${v}`)?.v === true
    } catch {
      return false
    }
  }
  return false
}

// Resolve the job/step block enclosing the `continue-on-error:` at line index `i`. Tolerant of the
// EJS control tags and column-0 comments that break strict indentation in `.ejs` templates.
function enclosingBlock(lines, i, coeIndent) {
  const isKey = (ln) => /^\s*['"]?[\w.-]+['"]?\s*:/.test(ln)
  const isDash = (ln) => /^(\s*)-\s/.exec(ln)
  const skip = (ln) => ln.trim() === '' || /^\s*#/.test(ln) || /^\s*<%/.test(ln)

  // STEP detection: the nearest `- ` dash shallower than the value, before any shallower mapping key.
  let dashIdx = -1
  let dashIndent = -1
  for (let j = i - 1; j >= 0; j--) {
    const ln = lines[j]
    if (skip(ln)) continue
    const dash = isDash(ln)
    const indent = ln.length - ln.trimStart().length
    if (dash && dash[1].length < coeIndent) {
      dashIdx = j
      dashIndent = dash[1].length
      break
    }
    if (!dash && indent < coeIndent && isKey(ln)) break // shallower key ⇒ job-level, not a step
  }

  if (dashIdx >= 0) {
    const out = [lines[dashIdx]]
    for (let j = dashIdx + 1; j < lines.length; j++) {
      const ln = lines[j]
      if (ln.trim() === '') {
        out.push(ln)
        continue
      }
      const indent = ln.length - ln.trimStart().length
      const dash = isDash(ln)
      if (dash && dash[1].length === dashIndent) break
      if (!dash && indent <= dashIndent && isKey(ln)) break
      out.push(ln)
    }
    const text = out.join('\n')
    const idM = /^\s*id:\s*(\S+)/m.exec(text)
    const nameM = /^\s*-?\s*name:\s*(.+)$/m.exec(text)
    return {
      kind: 'step',
      text,
      stepId: idM ? idM[1].replace(/['"]/g, '') : null,
      label: nameM ? nameM[1].trim() : '(unnamed step)',
    }
  }

  // JOB-level: gather from the nearest shallower mapping key (the job key) through its sub-tree.
  let jobIdx = -1
  let jobIndent = -1
  for (let j = i - 1; j >= 0; j--) {
    const ln = lines[j]
    if (skip(ln)) continue
    const indent = ln.length - ln.trimStart().length
    if (indent < coeIndent && isKey(ln)) {
      jobIdx = j
      jobIndent = indent
      break
    }
  }
  if (jobIdx < 0)
    return { kind: 'job', text: lines.slice(i, i + 1).join('\n'), stepId: null, label: '(job)' }
  const km = /^(\s*)['"]?([\w.-]+)['"]?\s*:/.exec(lines[jobIdx])
  const out = [lines[jobIdx]]
  for (let j = jobIdx + 1; j < lines.length; j++) {
    const ln = lines[j]
    if (ln.trim() === '') {
      out.push(ln)
      continue
    }
    const indent = ln.length - ln.trimStart().length
    if (indent <= jobIndent && isKey(ln)) break
    out.push(ln)
  }
  return { kind: 'job', text: out.join('\n'), stepId: null, label: km ? km[2] : '(job)' }
}

/**
 * Scan one workflow (or `.ejs` template) for a GATING job/step that swallows its failure via a
 * const-true `continue-on-error`.
 * @param {string} filePath
 * @param {string} [content] pre-read content (else read from disk).
 * @returns {string[]} human-readable findings (empty when clean / exempt / unreadable).
 */
export function findContinueOnErrorViolations(filePath, content) {
  const name = basename(filePath).replace(/\.ejs$/, '')
  if (INFORMATIONAL_PATTERNS.some((p) => name.includes(p))) return []
  let text = content
  if (text === undefined) {
    try {
      text = readFileSync(filePath, 'utf-8')
    } catch {
      return []
    }
  }
  const allowedSteps = STEP_SCOPED_ALLOWLIST[name]
  const lines = text.split('\n')
  const findings = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)continue-on-error:\s*(.+?)\s*$/.exec(lines[i])
    if (!m) continue
    if (!isConstTrueValue(m[2])) continue
    const block = enclosingBlock(lines, i, m[1].length)
    // Sole sanctioned step exception: artifact up/download (its failure must not block CI).
    if (/\b(?:upload|download)-artifact\b/.test(block.text)) continue
    // Audited, greppable per-block opt-out — must carry a non-empty reason (parity with
    // arbiter-allow-skip); a bare/empty marker does NOT bypass (#1499).
    if (/arbiter-allow-continue-on-error:[ \t]*\S/.test(block.text)) continue
    // Step-scoped allowlist parity with the regex sibling.
    if (allowedSteps && block.stepId && allowedSteps.has(block.stepId)) continue
    // Only a GATING block (one that RUNS a recognized gate/test/check command) is a fake-green.
    // Strip full-line comments first — a `run:`/`uses:` step is executed; a comment merely
    // mentioning a script path (e.g. "# Enforced by scripts/check-foo.mjs") is documentation,
    // not a gate invocation, and must not trip this classification.
    const executableText = block.text
      .split('\n')
      .filter((ln) => !/^\s*#/.test(ln))
      .join('\n')
    if (!GATE_COMMAND_RE.test(executableText)) continue
    findings.push(
      `${filePath}:${i + 1}: continue-on-error swallows a GATING ${block.kind} ("${block.label}") — a swallowed gate is a fake-green (#1497)`,
    )
  }
  return findings
}
