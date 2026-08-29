---
description: Walk one use case end to end as the user would live it — execute every read-only/dry-run step, compare doc promise against observed behaviour, and record owned findings (skill:tabletop)
title: '/tabletop'
doc_version: '1.0.0'
status: active
last_review: '2026-08-29'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/analysis']
related: ['ship', 'gold-audit']
---

# /tabletop

`/tabletop <scenario>` runs a **tabletop exercise**: it loads the **`tabletop`** skill and
walks one concrete journey — `greenfield-init-ts`, `ship-one-xs-issue`, or a free-text use
case — in the persona's voice, executing what is safely executable and recording every point
where the documentation, the CLI, a hook, a gate or CI disagree.

It is **evidence only**: it never modifies the repository. Its single output is
`.arbiter/evidence/tabletop/<slug>-<date>.md`.

## Steps

1. Pick the scenario from `docs/internal/METHOD/TABLETOP-SCENARIOS.md` (or slugify the
   free-text use case) and state its persona, starting state, goal, docs and exit criterion.
2. Pin the tree with `git rev-parse HEAD`.
3. Walk each step in character. Execute read-only or `--dry-run` probes, quote the doc
   promise with `path:line`, and record observed vs promised.
4. Write the evidence file with its frontmatter and findings table, then verify it:

```bash
node scripts/check-tabletop-evidence.mjs
```

5. File or fix every `blocker` and `major` — an unowned one fails the gate — and give each
   behaviour finding the test or gate that would have caught it.

## Allowed Tools

- `Bash` for read-only and `--dry-run` probes only
- `Read` / `Grep` for the docs and code paths the user would follow
- `Write` for `.arbiter/evidence/tabletop/<slug>-<date>.md` — and nothing else

> See the **`tabletop`** skill for the severity ladder, the findings-table columns and the
> hard rules.
