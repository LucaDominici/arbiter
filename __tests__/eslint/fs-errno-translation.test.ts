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
  ],
})
