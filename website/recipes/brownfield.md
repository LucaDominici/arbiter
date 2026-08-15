---
title: 'Recipe: Brownfield Onboarding'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Recipe: Brownfield Onboarding

Running `arbiter init` on a project that already has an `AGENTS.md`, `.claude/` config, or CI workflow is safe — arbiter detects conflicts and prompts before overwriting.

## One-command init

```bash
node dist/cli.js init --dir /path/to/your-project --tools claude --level L2
```

For a production repo, use `--yes` only after reviewing what gets generated on a test clone first.

## What happens on conflict

For each file that would overwrite existing content, arbiter asks:

```
AGENTS.md already exists. Overwrite? [y/N/diff]
```

- **y**: overwrite with generated content.
- **N**: skip — your existing file is kept.
- **diff**: show a unified diff first, then decide.

Use `N` for files you maintain manually; use `y` for files you want arbiter to own going forward.

## Typical conflict pattern

| File                       | Typical choice | Reason                                          |
| -------------------------- | -------------- | ----------------------------------------------- |
| `AGENTS.md`                | diff → y       | Merge your custom rules into arbiter's template |
| `.claude/settings.json`    | y              | Arbiter manages hooks                           |
| `scripts/check-all.mjs`    | y              | Gate is the product                             |
| `<project>/.github/workflows/ci.yml` | diff           | May conflict with existing jobs                 |
| `commitlint.config.js`     | y              | Unless you have custom rules                    |

## Rollback

All arbiter init operations are reversible via git:

```bash
git diff --stat     # review what changed
git checkout .      # discard all changes if unsatisfied
```

Run init on a branch, not main, so rollback is always one `git checkout` away.

## Level recommendation for existing repos

| Existing CI                    | Recommended level            |
| ------------------------------ | ---------------------------- |
| No CI                          | L1 (add gates incrementally) |
| Basic lint + test              | L2                           |
| Full coverage + contract tests | L3                           |

Start at L1 and advance with `arbiter update --level L2` once the team is comfortable.

## Reference

- Init options: `arbiter init --help`
- Governance levels: [Concepts](/concepts/)
- Stack support: [Reference — Stack Support](/reference/stacks)
