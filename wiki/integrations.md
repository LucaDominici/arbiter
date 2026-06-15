---
generated: true
source: 'docs/INTEGRATIONS.md'
source_sha: 'f0aafbb990c98688cb9d50239ec165ba596f0735'
last_updated: '2026-06-14'
---

# Integrations

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/INTEGRATIONS.md](../docs/INTEGRATIONS.md)

# Integrations

Arbiter's **detect-and-reference** posture lets it work alongside other Claude Code plugin suites (superpowers, pr-review-toolkit, frontend-design) without copying their content.

---

## Philosophy

Arbiter generates governance artifacts — `AGENTS.md`, hooks, CI gate, skills — for the _target project_. When an external skill suite is already installed, arbiter **detects** it and **references** it instead of duplicating it. This keeps each tool's author in control of their own content.

---

## What "detect-and-reference" means

1. **Detect** — during `arbiter init` (or `arbiter update`), arbiter inspects known install paths (`~/.claude/skills/`, `~/.claude/plugins/`, `<project>/.claude/skills/`) against the [skills matrix](../src/integrations/skills-matrix.ts).
2. **Reference** — when a skill is detected, arbiter omits its own equivalent (e.g. arbiter's bundled `tdd` skill is skipped if superpowers `tdd` is present) and instead adds an `Integrations` section to `AGENTS.md` pointing to the installed skill.
3. **No duplication** — arbiter never copies, embeds, or modifies upstream skill files.

Run `arbiter integrations list` to see which skills are currently detected or recommended.

---

## What is forbidden

- **Copying SKILL.md content** — do not reproduce, adapt, or paraphrase skill file content from superpowers, pr-review-toolkit, frontend-design, or any other upstream suite. Linking is fine; copying is not.
- **Vendoring upstream skill files** into arbiter's own `src/templates/` or `__tests__/fixtures/` directories.
- **Claiming authorship** of content that originates in a third-party package.

This policy is enforced by the pre-edit SSOT hook and reviewed on PRs.

---

## Attribution requirements

When referencing an upstream skill in generated files (e.g. in `AGENTS.md`):

1. Name the upstream package (`claude-plugins-official/superpowers`).
2. Include a brief role description (`session-bootstrap`, `pr-review`, etc.).
3. Link to the upstream install source (e.g. `/plugin add ...`).

Example (generated `AGENTS.md` fragment):

```markdown
## Integrations

| Skill                           | Owner                   | Role              | Install                                           |
| ------------------------------- | ----------------------- | ----------------- | ------------------------------------------------- |
| `superpowers:using-superpowers` | claude-plugins-official | session-bootstrap | `/plugin add claude-plugins-official/superpowers` |
```

---

## How to add a new skill to the matrix

1. Open `src/integrations/skills-matrix.ts`.
2. Add an entry to the `UPSTREAM_SKILLS` array:

```typescript
{
  id: 'my-plugin:my-skill',
  owner: 'npm-org-or-github-org',
  role: 'short-role-description',
  installCmd: '/plugin add my-org/my-plugin  # or: npm i my-plugin',
  installSource: 'plugin',  // 'builtin' | 'plugin' | 'npm'
},
```

3. Add detection logic if the skill uses a non-standard path (default: walks `~/.claude/skills/<skill-basename>`).
4. Open a PR. The `arbiter integrations list` test in CI will catch any malformed entries.

---

## License references

| Package                                     | License         | Source                              |
| ------------------------------------------- | --------------- | ----------------------------------- |
| `claude-plugins-official/superpowers`       | See plugin repo | Anthropic / claude-plugins-official |
| `claude-plugins-official/pr-review-toolkit` | See plugin repo | Anthropic / claude-plugins-official |
| `claude-plugins-official/frontend-design`   | See plugin repo | Anthropic / claude-plugins-official |

Arbiter's own code is Apache-2.0. Integration references do not transfer or extend that license to upstream content.
