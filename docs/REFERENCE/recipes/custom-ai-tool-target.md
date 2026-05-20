---
title: 'Recipe: Adding a Custom AI Tool Target'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Recipe: Adding a Custom AI Tool Target

**Issue:** #647

## Context

arbiter ships with first-party generators for 7 AI tools (Claude Code, Cursor, GitHub Copilot, Windsurf, Zed, Obsidian, Continue). This recipe documents how to add a new tool target — for example, a hypothetical "Toolbot 9000" IDE assistant.

## Overview

Adding a new tool target requires:

1. A generator that produces the tool's config file(s)
2. An entry in the compatibility matrix
3. (Optional) a plugin to distribute the generator

## Step 1: Create the Generator

```bash
# Generators live under src/generators/
# First, survey for reuse (CANON-16 required):
grep -r "export function" src/generators/ --include="*.ts" -l
```

If no suitable base exists, create `src/generators/toolbot9000.ts`:

```typescript
// src/generators/toolbot9000.ts
import type { GeneratorContext } from '../types/generator.js'

export async function generateToolbot9000Config(ctx: GeneratorContext): Promise<void> {
  // Toolbot 9000 uses .toolbot/config.json
  const config = {
    version: '1',
    governance: ctx.governanceLevel,
    agentsFile: ctx.agentsFilePath,
    hooks: ctx.hooks.map((h) => ({ event: h.event, script: h.script })),
  }
  await ctx.writeFile('.toolbot/config.json', JSON.stringify(config, null, 2))
}
```

The `GeneratorContext` type is defined in `src/types/generator.ts`.

## Step 2: Wire into Compatibility Matrix

Open `src/compatibility/cross-language-matrix.json` and add the new tool column:

```json
{
  "tools": {
    "toolbot9000": {
      "label": "Toolbot 9000",
      "status": "beta",
      "generatorFn": "generateToolbot9000Config"
    }
  }
}
```

Mark as `"status": "beta"` initially. Promote to `"proven"` only after adding a fixture under `__tests__/fixtures/real-projects/` (INV-32 requires it).

## Step 3: Register the Generator

In `src/commands/init.ts` (or `update.ts`), import and call the generator when the user selects Toolbot 9000 during the wizard:

```typescript
import { generateToolbot9000Config } from '../generators/toolbot9000.js'

// In the tool-selection switch:
case 'toolbot9000':
  await generateToolbot9000Config(ctx)
  break
```

## Step 4: Add a Fixture (INV-32)

```bash
mkdir -p __tests__/fixtures/real-projects/toolbot9000-basic
```

```json
// __tests__/fixtures/real-projects/toolbot9000-basic/manifest.json
{
  "language": "typescript",
  "archetype": "node-library",
  "levels": ["L1", "L2"],
  "tool": "toolbot9000"
}
```

## Worked Example: Toolbot 9000

Full sequence from zero to working generator:

```bash
# 1. Survey for reuse
grep -r "writeFile\|GeneratorContext" src/generators/ -l

# 2. Create generator (see Step 1 above)

# 3. Add matrix entry

# 4. Wire into init/update commands

# 5. Add fixture

# 6. Run gate
node scripts/check-all.mjs L2
```

After gate passes, the compatibility matrix reports `toolbot9000: beta` and `arbiter init` will offer it as a tool choice.

## Step 5: Submit Upstream (RFC Process)

If you want the tool included in arbiter core:

1. File an RFC issue using the `docs/rfc/` template.
2. Reference the RFC process documented in F4 (Feature Request RFC) — see `docs/GOVERNANCE/CONTRIBUTING.md`.
3. PRs that add a new first-party tool target must include: generator, matrix entry, fixture, and at least one integration test.

## Plugin Route (No Upstream Required)

To distribute without a core PR, package as a plugin:

```bash
arbiter plugin init arbiter-plugin-toolbot9000
```

The plugin structure:

```
arbiter-plugin-toolbot9000/
  plugin.json      ← declares generator + matrix extension
  generators/
    toolbot9000.ts
  fixtures/
    basic/manifest.json
```

Users install via:

```bash
arbiter plugin add arbiter-plugin-toolbot9000
```
