# Recipe: Compose with Frontend Design Skill

**Applicable archetypes:** `frontend-spa`
**Applicable tools:** `claude`

## Problem

You have an existing Claude Code plugin (e.g., `frontend-design`) installed that provides superior UI/UX guidance for your frontend project. Running `arbiter init` would generate arbiter's built-in skill files alongside it, creating redundancy and potential conflict.

## Solution

Arbiter auto-detects installed Claude Code skills at init time. When a detected skill appears in `src/compatibility/skills-matrix.json` with a non-empty `replaces` list, the corresponding built-in SKILL.md generator is skipped. The AGENTS.md "Integrations" section lists all detected skills for agent visibility.

## How It Works

```bash
# Install the frontend-design plugin (or any compatible plugin)
# Then run arbiter init as normal:
arbiter init --yes --level L2

# Arbiter will:
# 1. Scan ~/.claude/plugins/cache, ~/.claude/skills, <project>/.claude/plugins, <project>/.claude/skills
# 2. Match detected skills against src/compatibility/skills-matrix.json
# 3. Skip built-in SKILL.md files for matched names (no-overwrite, detect-and-reference)
# 4. Add an "Integrations" section to AGENTS.md listing detected skills
# 5. Write .arbiter/detected-integrations.json for audit/drift detection
```

## Verifying the Integration

After init, check that:

1. AGENTS.md contains a `## Integrations` section listing the plugin:

   ```bash
   grep -A 10 "## Integrations" AGENTS.md
   ```

2. The built-in skill was not generated (because the plugin replaces it):

   ```bash
   # For a skill that is replaced, no file should exist:
   test ! -f .claude/skills/<skill-name>/SKILL.md && echo "correctly skipped"
   ```

3. Audit file was written:
   ```bash
   cat .arbiter/detected-integrations.json | jq '.detectedSkills[].skillId'
   ```

## Skills Matrix

The curated matrix lives at `src/compatibility/skills-matrix.json`. Each entry defines:

| Field               | Description                                  |
| ------------------- | -------------------------------------------- |
| `skillId`           | Composite `pluginOwner:skillName` identifier |
| `integrationStatus` | `proven` (tested in CI) / `beta` / `unknown` |
| `replaces`          | Built-in SKILL_NAMES this skill supersedes   |

To add a new skill to the matrix, open a PR updating `skills-matrix.json` and the `L1` gate step `skills-matrix-schema` will validate your changes.

## Adding a New Skill to the Matrix

```json
{
  "skillId": "my-plugin:my-skill",
  "pluginOwner": "my-plugin",
  "versionRange": ">=1.0.0",
  "role": "Description of what this skill does",
  "integrationStatus": "beta",
  "replaces": [],
  "referenceUrl": "https://github.com/my-org/my-plugin"
}
```

Start with `integrationStatus: "beta"` and `replaces: []`. Promote to `proven` and add `replaces` entries once the skill is verified to cover the use cases of the built-in generators it supersedes.
