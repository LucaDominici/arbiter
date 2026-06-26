// SPDX-License-Identifier: Apache-2.0
// Regression guard for #1523: scripts/ — the gate-enforcement layer — was
// historically listed in eslint.config.js `ignores`, so the code that ENFORCES
// arbiter's quality bar received zero dead-code analysis. These tests assert the
// flat config now lints `scripts/**/*.mjs` for unused vars and unreachable code,
// while keeping `_`-prefixed bindings and node globals exempt.
import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import { join } from 'node:path'

const repoRoot = join(__dirname, '..', '..')

async function lintAsScript(code: string): Promise<{ ruleId: string | null; message: string }[]> {
  const eslint = new ESLint({ cwd: repoRoot })
  // A path under scripts/ so the dedicated flat-config block matches. The file
  // need not exist on disk — lintText evaluates the text against the config that
  // governs that path.
  const results = await eslint.lintText(code, {
    filePath: join(repoRoot, 'scripts', '__eslint_probe__.mjs'),
    warnIgnored: true,
  })
  return results.flatMap((r) => r.messages).map((m) => ({ ruleId: m.ruleId, message: m.message }))
}

describe('#1523 — scripts/ is covered by the dead-code gate', () => {
  it('flags an unused import in a scripts/ file as an error (the blind spot is closed)', async () => {
    const messages = await lintAsScript(
      "import { statSync } from 'node:fs'\nprocess.stdout.write('hi\\n')\n",
    )
    // Before the fix scripts/ was ignored → zero messages. After the fix the
    // dead import surfaces as a no-unused-vars error.
    expect(messages.some((m) => m.ruleId === 'no-unused-vars')).toBe(true)
    expect(messages.some((m) => m.message.includes('statSync'))).toBe(true)
  })

  it('flags unreachable code in a scripts/ file', async () => {
    const messages = await lintAsScript('export function f() {\n  return 1\n  return 2\n}\n')
    expect(messages.some((m) => m.ruleId === 'no-unreachable')).toBe(true)
  })

  it('does not flag `_`-prefixed intentionally-unused caught errors', async () => {
    const messages = await lintAsScript(
      'try {\n  process.exit(0)\n} catch (_err) {\n  process.exit(1)\n}\n',
    )
    expect(messages.some((m) => m.ruleId === 'no-unused-vars')).toBe(false)
  })

  it('does not flag bare node globals as undefined (no-undef is off for scripts)', async () => {
    const messages = await lintAsScript(
      "const buf = Buffer.from('x')\nprocess.stdout.write(String(buf.length))\n",
    )
    expect(messages.some((m) => m.ruleId === 'no-undef')).toBe(false)
  })
})
