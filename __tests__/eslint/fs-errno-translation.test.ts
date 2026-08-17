// SPDX-License-Identifier: Apache-2.0
// CANON-17 promotion (#1924): the errno-translation rule, exercised against real handlers.
//
// The rule is the DELIVERABLE, so it is what the RED exercises. Asserting the CANON parity
// gate instead would be a false green: findsWiredCitation returns on its first hit, so a
// missing or no-op rule would still make the parity gate report CANON-17 as `gated`.
import { RuleTester } from 'eslint'
import rule from '../../eslint-rules/fs-errno-translation.js'

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

const FS_IMPORT = "import { readFileSync, writeFileSync } from 'node:fs'\n"

tester.run('fs-errno-translation (CANON-17, #1924)', rule, {
  valid: [
    // The caught binding flows into the exported translator.
    {
      code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { throw toFsError(err, p) }',
    },
    // Or into an ArbiterError built from it.
    {
      code:
        FS_IMPORT +
        "try { readFileSync(p) } catch (err) { throw ArbiterError.fromKey(err.code, 'errors.E_FS_ENOENT', { path: p }) }",
    },
    {
      code:
        FS_IMPORT +
        "try { writeFileSync(p, d) } catch (err) { throw new ArbiterError('E_FS', String(err)) }",
    },
    // A catch that swallows deliberately binds nothing — there is no errno to leak.
    { code: FS_IMPORT + 'try { readFileSync(p) } catch { fallback() }' },
    // No direct fs in the try block — not this rule's business.
    { code: 'try { JSON.parse(s) } catch (err) { throw err }' },
    // fs imported but the try block calls something else.
    { code: FS_IMPORT + 'try { compute() } catch (err) { throw err }' },

    // ── #2314: the non-leaking shapes each predicate must reject ──────────────
    // The rule fires only on a RAW escape, so every near-miss below is a valid
    // case — and each one is a distinct arm of isRawUse/isStdio/bindingIsTranslated
    // that no fixture reached. Coverage of a lint rule IS its false-positive proof:
    // an unexercised arm is a flood waiting for the first consumer to hit it.

    // Import declaration from a module that is not node:fs at all.
    { code: "import { join } from 'node:path'\ntry { join(a, b) } catch (err) { throw err }" },
    // Mixed default + named specifiers in one node:fs declaration.
    {
      code: "import fs, { readFileSync } from 'node:fs'\ntry { readFileSync(p) } catch (err) { throw toFsError(err, p) }",
    },
    // A destructured catch param binds no name the rule can track.
    { code: FS_IMPORT + 'try { readFileSync(p) } catch ({ code }) { throw code }' },
    // Sanctioned Node idiom: a new error under a message, cause preserved.
    { code: FS_IMPORT + "try { readFileSync(p) } catch (err) { throw new Error('read failed') }" },
    // A structured logger is keyed and rendered, not raw stdout.
    { code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { logger.error(err) }' },
    // console call, but the argument carries no errno.
    { code: FS_IMPORT + "try { readFileSync(p) } catch (err) { console.error('read failed') }" },
    // A call whose callee is an Identifier other than String.
    { code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { console.error(describe(ctx)) }' },
    // Member access on something that is not the caught binding.
    { code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { console.error(ctx.message) }' },
    // Template / binary / conditional shapes that never interpolate the binding.
    { code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { console.error(`at ${p}`) }' },
    { code: FS_IMPORT + "try { readFileSync(p) } catch (err) { console.error('at ' + p) }" },
    { code: FS_IMPORT + "try { readFileSync(p) } catch (err) { console.error(q ? 'a' : 'b') }" },
    // Consumers of the binding that are neither translators nor leaks.
    { code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { report({ cause: err }) }' },
    { code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { helper.wrap(err) }' },
    { code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { throw new CustomError(err) }' },
    // A translator called on something OTHER than the caught binding translates nothing —
    // but nothing leaks either, so the rule stays silent.
    { code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { throw toFsError(other, p) }' },
  ],
  invalid: [
    // Re-throwing the raw binding is the canonical violation.
    {
      code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { throw err }',
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // Stringifying it leaks the errno text just as effectively.
    {
      code:
        FS_IMPORT + 'try { writeFileSync(p, d) } catch (err) { process.stderr.write(String(err)) }',
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // Calling a façade function inside the catch translates NOTHING — the caught
    // binding never reaches a translator.
    {
      code:
        FS_IMPORT +
        'try { readFileSync(p) } catch (err) { writeFileTranslated(q, "fallback"); throw err }',
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // Aliased import — the binding, not the source name, is what the rule must resolve.
    {
      code: "import { readFileSync as rf } from 'node:fs'\ntry { rf(p) } catch (err) { throw err }",
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // Namespace import.
    {
      code: "import * as fs from 'node:fs'\ntry { fs.readFileSync(p) } catch (err) { throw err }",
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // Default import.
    {
      code: "import fs from 'node:fs'\ntry { fs.statSync(p) } catch (err) { throw err }",
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // Awaited node:fs/promises call.
    {
      code: "import { readFile } from 'node:fs/promises'\nasync function f() { try { await readFile(p) } catch (err) { throw err } }",
      errors: [{ messageId: 'untranslatedErrno' }],
    },

    // ── #2314: every raw-escape shape isRawUse claims to catch ────────────────
    // console.* is as much the user's terminal as process.stdout is.
    {
      code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { console.error(String(err)) }',
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // `err.message` is the bare errno string with the stack trimmed off.
    {
      code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { console.log(err.message) }',
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // Interpolated into a template literal.
    {
      code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { process.stdout.write(`${err}`) }',
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // Concatenated onto a prefix.
    {
      code:
        FS_IMPORT + "try { readFileSync(p) } catch (err) { console.error('read failed: ' + err) }",
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // Behind a ternary — either arm leaks.
    {
      code: FS_IMPORT + "try { readFileSync(p) } catch (err) { console.error(q ? err : 'ok') }",
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    {
      code: FS_IMPORT + "try { readFileSync(p) } catch (err) { console.error(q ? 'ok' : err) }",
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // The re-throw sits inside a nested block, not at the handler's top level.
    {
      code: FS_IMPORT + 'try { readFileSync(p) } catch (err) { if (q) { throw err } }',
      errors: [{ messageId: 'untranslatedErrno' }],
    },
    // The fs call sits inside an array literal in the try block.
    {
      code: FS_IMPORT + 'try { const a = [readFileSync(p)] } catch (err) { throw err }',
      errors: [{ messageId: 'untranslatedErrno' }],
    },
  ],
})
