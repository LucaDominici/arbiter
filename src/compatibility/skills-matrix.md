# Skills Matrix Schema

`src/compatibility/skills-matrix.json` — curated registry of known Claude Code skills and their relationship to arbiter's built-in skill generators.

## Purpose

When `arbiter init` detects installed Claude Code skills, it checks this matrix to determine:

1. Whether to skip the corresponding built-in SKILL.md generator (detect-and-reference, no content copy)
2. What to display in AGENTS.md `## Integrations` section

## Schema

```json
{
  "$schemaVersion": 1,
  "_lastUpdated": "YYYY-MM-DD",
  "_refreshCadence": "monthly",
  "_promotionCriteria": "...",
  "skills": [
    {
      "skillId": "<pluginOwner>:<skillName>",
      "pluginOwner": "<plugin package name>",
      "versionRange": ">=X.Y.Z",
      "role": "Human description of what the skill does",
      "integrationStatus": "proven | beta | unknown",
      "replaces": ["<SKILL_NAME>", ...],
      "referenceUrl": "https://..."
    }
  ]
}
```

## Fields

| Field               | Required | Description                                                                 |
| ------------------- | -------- | --------------------------------------------------------------------------- |
| `skillId`           | Yes      | `pluginOwner:skillName` — composite unique key                              |
| `pluginOwner`       | Yes      | The plugin package name (matches detection scan)                            |
| `versionRange`      | Yes      | semver range (currently informational)                                      |
| `role`              | Yes      | One-line description for AGENTS.md display                                  |
| `integrationStatus` | Yes      | `proven` / `beta` / `unknown`                                               |
| `replaces`          | Yes      | List of built-in SKILL_NAMES to skip when detected. Empty = no suppression. |
| `referenceUrl`      | Yes      | Link to plugin documentation                                                |

## integrationStatus Values

| Value     | Meaning                                                 |
| --------- | ------------------------------------------------------- |
| `proven`  | Verified in ≥3 arbiter recipes + CI fixture coverage    |
| `beta`    | Present and detectable but not exercised by CI fixtures |
| `unknown` | Detected by the scanner but no matrix entry exists yet  |

## Valid SKILL_NAMES (built-in generators)

The `replaces` array must only reference these names:

- `tdd`
- `verification`
- `architect-review`
- `clean-code`
- `understand-code`
- `codebase-audit`
- `epic-decompose`
- `configure`

Enforced by the `skills-matrix-schema` L1 gate (`scripts/check-skills-matrix.mjs`).

## Promotion Process

1. Open a PR adding or updating an entry in `skills-matrix.json`
2. L1 gate validates the schema automatically
3. To promote to `proven`, add a real-projects fixture or recipe that exercises the detection path
4. To add entries to `replaces`, verify the installed skill covers all the use cases of the built-in generator
