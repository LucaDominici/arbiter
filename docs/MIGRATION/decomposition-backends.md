---
title: 'Migration: decomposition backends (`useGitHub` → `decomposition.backend`)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Migration: decomposition backends (`useGitHub` → `decomposition.backend`)

## What changed

`arbiter.json` now stores decomposition configuration under `decomposition.backend`
(`"github"` or `"markdown"`) instead of the legacy `useGitHub` boolean.

The old field is automatically migrated with a deprecation warning:

```
[arbiter] Warning: `useGitHub` is deprecated.
Use `decomposition.backend: "github"|"markdown"` instead.
```

## Migration steps

### Automatic (recommended)

Run `arbiter init` on your project again. The wizard will write the updated `arbiter.json`
with the new field. Your existing governance files are preserved.

### Manual

Edit `.arbiter/arbiter.json` (or the project root `arbiter.json`):

**Before:**

```json
{
  "version": "0.2",
  "useGitHub": true
}
```

**After:**

```json
{
  "version": "0.2",
  "useGitHub": true,
  "decomposition": {
    "backend": "github"
  }
}
```

Use `"backend": "markdown"` for offline / no-GitHub projects.

## Switching backends after init

To switch an existing project from GitHub to markdown:

```bash
# Re-init with explicit backend override
arbiter init --yes --backend markdown

# Or edit arbiter.json manually and run arbiter update
```

To switch from markdown to GitHub:

```bash
arbiter init --yes --backend github
# Authenticate first: gh auth login
```

## Markdown backend: what's stored where

Work units live in `.arbiter/work/*.md` as YAML front-matter files:

```markdown
---
id: WU-001
title: Add login page
status: open
phase: plan
---

Full description here...
```

Add `.arbiter/work/` to git to share work units with teammates, or keep it gitignored
for personal task tracking. Either approach works — arbiter never auto-commits.

## Compatibility

| arbiter version | `useGitHub`        | `decomposition.backend` |
| --------------- | ------------------ | ----------------------- |
| < 0.8           | supported          | not supported           |
| 0.8+            | deprecated (warns) | preferred               |
| 1.0 (planned)   | removed            | required                |
