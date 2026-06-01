---
title: 'Recipe: Custom Invariant — Advanced Patterns'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Recipe: Custom Invariant — Advanced Patterns

**Issue:** #646 (extends B10 — basic custom invariant)

> **Public intro:** for the basics, see the public recipe `website/recipes/custom-invariant.md` (published at `/recipes/custom-invariant`). This page is the **contributor deep-dive** — cross-file, AST-based, and language-specific invariant patterns — complementing, not duplicating, the public overview.

## Context

B10 covers adding a simple custom invariant. This recipe covers three advanced patterns: cross-file invariants, AST-based invariants, and language-specific invariants. It also documents where to wire each pattern for best performance, how to test it, and how to share it as a plugin.

## Pattern 1: Cross-File Invariant

A cross-file invariant checks a property that spans multiple files — e.g., "every exported function must have a corresponding entry in the public API barrel file."

**Where to wire:** L2 gate (`check-all.mjs L2`). Cross-file analysis is expensive; blocking it at `PreToolUse` would slow every edit.

**Implementation approach:**

```typescript
// src/invariants/catalog.ts — add entry
{
  id: 'INV-XX',
  name: 'barrel-completeness',
  description: 'Every exported function must appear in src/index.ts barrel',
  tier: 'L2',
  required: true,
  check: async (ctx) => {
    const barrel = await readFile('src/index.ts', 'utf8')
    const exported = await findExportedFunctions(ctx.projectRoot)
    const missing = exported.filter(fn => !barrel.includes(fn))
    if (missing.length > 0) {
      return { pass: false, message: `Missing from barrel: ${missing.join(', ')}` }
    }
    return { pass: true }
  }
}
```

Wire the check in `scripts/check-all.mjs`:

```javascript
if (level >= 2) {
  await runInvariant('INV-XX')
}
```

## Pattern 2: AST-Based Invariant

AST-based invariants parse source files with a language-appropriate parser and check structural properties — e.g., "no `console.log` in production source files."

**Where to wire:** L1 gate or `PostToolUse` (Edit/Write) if the check is fast (< 200ms per file). L2 for full-project scans.

**TypeScript example using ts-morph or acorn:**

```typescript
import { Project } from 'ts-morph'

const project = new Project({ tsConfigFilePath: 'tsconfig.json' })
const violations: string[] = []

for (const sourceFile of project.getSourceFiles('src/**/*.ts')) {
  sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => call.getExpression().getText() === 'console.log')
    .forEach((call) => violations.push(`${sourceFile.getFilePath()}:${call.getStartLineNumber()}`))
}
```

**Performance note:** `ts-morph` loads the full project graph. For PreToolUse hooks (per-file), use a lightweight parser like `acorn` or `@typescript-eslint/parser` instead.

## Pattern 3: Language-Specific Invariant

For non-TypeScript stacks, wire invariants as shell scripts called from the gate.

**Example: Python — no bare `except:` clauses**

```bash
# scripts/check-no-bare-except.sh
grep -rn "except:" src/ --include="*.py" | grep -v "except Exception" | grep -v "except (" \
  && echo "FAIL: bare except clauses found" && exit 1 || exit 0
```

Add to `check-all.mjs`:

```javascript
if (language === 'python' && level >= 1) {
  await shell('bash scripts/check-no-bare-except.sh')
}
```

## Wiring Tier Guidance

| Pattern                                 | Volume          | Recommended tier           |
| --------------------------------------- | --------------- | -------------------------- |
| Single-file structural check            | Per-edited file | `PostToolUse` (Edit/Write) |
| Fast AST check (< 200ms)                | Per-edited file | `PostToolUse` or L1 gate   |
| Slow AST / cross-file                   | Full project    | L1 gate                    |
| Cross-file aggregation                  | Full project    | L2 gate                    |
| External tool (coverage, security scan) | Full project    | L2 gate                    |

## Testing Your Custom Invariant

Test a custom invariant end-to-end by exercising its check script directly against fixtures:

```bash
# 1. Create a fixture file that violates the invariant
# 2. Run the gate and assert it fails
node scripts/check-all.mjs L1; echo "exit: $?"

# 3. Fix the violation
# 4. Re-run and assert it passes
```

## Sharing as a Plugin

Package your custom invariant as an arbiter plugin:

```bash
arbiter plugin init my-invariant-plugin
```

Plugins export an `invariants` array that arbiter merges into the local catalog on `arbiter plugin add`. See the plugin authoring recipe (custom-ai-tool-target.md §Plugin Route) for the full plugin structure.
