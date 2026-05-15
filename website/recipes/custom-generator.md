# Recipe: Add a Custom Generator

Generators live in `src/generators/` and are how arbiter itself emits files to target projects. This recipe is for **arbiter contributors** extending core support for a new language or archetype. If you want to emit custom files without modifying arbiter, use a plugin instead (see [Write an arbiter plugin](./plugin)).

## Generator vs plugin

|               | Generator                           | Plugin                         |
| ------------- | ----------------------------------- | ------------------------------ |
| **Who**       | arbiter contributors                | Third-party authors            |
| **Where**     | `src/generators/*.ts`               | Separate npm package           |
| **Scope**     | Built into every arbiter install    | Opt-in per project             |
| **Templates** | `src/templates/<language>/`         | `<plugin>/templates/`          |
| **Gate**      | Covered by arbiter's own test suite | Plugin author's responsibility |

## When to add a generator

Add a generator when:

- You're adding a new language arbiter doesn't yet support.
- You're adding a new archetype to an existing language.
- The feature belongs in every arbiter installation, not just some projects.

## Step 1 — Existing Code Survey (CANON-16)

```bash
grep -r "export function generate" src/generators/ --include="*.ts" -l
ls src/generators/
```

Can you extend an existing generator with a parameter? If yes, do that. Only create a new file if the responsibility is architecturally distinct.

## Step 2 — Create the generator

```ts
// src/generators/my-language.ts
// SPDX-License-Identifier: Apache-2.0
import type { ArbiterConfig } from '../utils/config.js'
import type { GeneratorResult } from './types.js'
import { renderTemplate } from '../utils/render.js'

export function generateMyLanguage(config: ArbiterConfig): GeneratorResult {
  return {
    files: [
      {
        path: 'scripts/check-all.mjs',
        content: renderTemplate('my-language/check-all.mjs.ejs', { level: config.level }),
      },
    ],
  }
}
```

## Step 3 — Add templates

```
src/templates/my-language/
└── check-all.mjs.ejs
```

## Step 4 — Wire into the dispatch

Register in `src/generators/dispatch.ts`: add a branch for the new language/archetype that calls your generator. Check `src/detectors/` to confirm the detector already classifies this stack.

## Step 5 — Add a fixture + test

```bash
mkdir -p __tests__/fixtures/real-projects/my-language-backend/
# Add manifest.json: { "language": "my-language", "archetype": "backend", "levels": ["L1", "L2"] }
```

INV-32 requires a fixture before the matrix cell can be promoted to `proven`.

## Reference

- Templates: `src/templates/`
- Dispatch: `src/generators/dispatch.ts`
- Matrix: `src/compatibility/cross-language-matrix.json`
- CANON-02 / CANON-03 / CANON-05 apply when promoting cells
