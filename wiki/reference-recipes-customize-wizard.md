---
generated: true
source: 'docs/REFERENCE/recipes/customize-wizard.md'
source_sha: 'bf710ca82cc6360e1eb1ad2ffbc2326c4a310e67'
last_updated: '2026-06-08'
---

# Recipe: Customizing the Wizard

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/recipes/customize-wizard.md](../docs/REFERENCE/recipes/customize-wizard.md)

# Recipe: Customizing the Wizard

**Issue:** #648

## Context

The `arbiter init` wizard asks questions interactively. Teams want to: pre-fill answers to skip repetitive prompts, add team-specific questions, and run non-interactively in CI. This recipe covers all three paths.

## Path 1: Pre-fill via `--recipe` (D9)

**Status (2026-05-16):** The `--recipe` flag ships in D9. If your arbiter version predates D9, use the `--non-interactive` path described in Path 3 below.

When D9 ships, a recipe file is a JSON document that pre-answers wizard questions:

```json
// my-team-recipe.json
{
  "language": "typescript",
  "buildTool": "npm",
  "governanceLevel": "L2",
  "tools": ["claude-code", "cursor"],
  "teamName": "Platform Team"
}
```

Run with:

```bash
arbiter init --recipe my-team-recipe.json
```

The wizard skips questions whose answers are in the recipe. It still prompts for unanswered questions unless `--non-interactive` is also passed.

## Path 2: Adding Team-Specific Questions via a Plugin

Plugins can extend the wizard with additional prompts. Create a plugin that exports a `wizardExtension`:

```typescript
// arbiter-plugin-myteam/index.ts
export const wizardExtension = {
  questions: [
    {
      id: 'jira-project-key',
      type: 'input',
      message: 'JIRA project key (e.g. PLAT):',
      validate: (v: string) => /^[A-Z]+$/.test(v) || 'Must be uppercase letters only',
    },
  ],
  onAnswer: (answers: Record<string, string>, ctx: WizardContext) => {
    // Write team-specific config based on answers
    ctx.writeFile('.arbiter/team.json', JSON.stringify({ jiraKey: answers['jira-project-key'] }))
  },
}
```

Users install the plugin and subsequent `arbiter init` runs include the extra questions.

## Path 3: Skipping Prompts Non-Interactively

For CI or scripted setup, pass all required answers as CLI flags:

```bash
arbiter init \
  --language typescript \
  --build-tool npm \
  --governance-level L2 \
  --tools claude-code \
  --non-interactive
```

`--non-interactive` causes arbiter to error (not prompt) if a required answer is missing. This ensures CI fails loudly rather than hanging on an unanswered prompt.

To see all available flags:

```bash
arbiter init --help
```

## Worked Example: Team-Wide Standard Recipe

A platform team maintains a recipe file checked into a shared config repo:

```bash
# Clone team config
git clone https://github.com/myorg/arbiter-config

# Init new service using team recipe
cd my-new-service
arbiter init --recipe ../arbiter-config/platform-recipe.json --non-interactive
```

The recipe pins: governance level, tools, required invariants, and team-specific questions. New services always start from the same baseline.

## Gotchas

- Recipe files override wizard detection defaults. If the recipe specifies `"language": "python"` but the project is TypeScript, arbiter will use the recipe value. Validate recipes before distributing.
- `--non-interactive` + incomplete recipe = error exit. Always test recipes with `--dry-run` first (if available in your arbiter version).
- Wizard extensions from plugins run after core questions. If your extension answer depends on a core question answer, access it via the `answers` object in `onAnswer`.
