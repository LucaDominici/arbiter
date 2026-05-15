# Recipe: Add a Custom Invariant

Custom invariants extend a project's governance contract with rules specific to your team's standards. The recommended path is a plugin that contributes `verifyPlanRules` — no fork of arbiter required.

## When to use this

- Your team has a naming convention, banned dependency, or architectural constraint not covered by the built-in INV-NN catalog.
- You want the rule enforced by `arbiter verify plan` in CI alongside the built-in rules.

## Step 1 — Scaffold a plugin

```bash
arbiter plugin add my-rules
cd my-rules
```

This creates `my-rules/index.js` with a minimal `ArbiterPlugin` stub.

## Step 2 — Add a verify-plan rule

```js
// my-rules/index.js
const { join } = require('node:path')

/** @type {import("@arbiter/cli/plugin").ArbiterPlugin} */
module.exports = {
  name: 'my-rules',
  apiVersion: '1',
  templateRoot: join(__dirname, 'templates'),

  generate: () => ({ files: [] }),

  verifyPlanRules: [
    {
      id: 'MY-INV-01',
      description: 'No direct import of lodash — use native equivalents',
      check(ctx) {
        const violations = []
        for (const file of ctx.changedFiles) {
          if (file.content.includes("from 'lodash'")) {
            violations.push({ file: file.path, message: 'Direct lodash import detected' })
          }
        }
        return violations
      },
    },
  ],
}
```

Rules receive `ctx.changedFiles` (files in the current plan diff) and return an array of violations. An empty array means PASS.

## Step 3 — Register in arbiter config

```json
{
  "plugins": ["./my-rules"]
}
```

## Step 4 — Verify it fires

```bash
arbiter verify plan --context .arbiter/plan
```

The rule appears in the report alongside built-in rules. A violation exits 1 and blocks the gate.

## AGENTS.md entry

Document the invariant so AI agents know the rule exists:

```markdown
- **MY-INV-01**: No direct lodash imports — use native Array/Object methods.
  _Enforced by_: `my-rules` plugin, `arbiter verify plan`.
```

## Reference

- Plugin contract: `src/types/plugin.ts`
- Rule type: `src/verify/rules/types.ts`
