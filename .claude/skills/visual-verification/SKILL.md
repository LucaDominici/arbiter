---
name: visual-verification
description: Automated visual regression check via Playwright — 5 DOM checks × 3 viewports (375/768/1280). Produces pass/fail grid + screenshot paths under .arbiter/evidence/visual/.
argument-hint: '--url <url> --task-id <id> [--evidence-dir <dir>]'
title: 'Visual Verification Skill'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Visual Verification Skill

Invoke when a UI change needs visual validation before marking a task complete.

## Usage

```bash
node scripts/visual-verify.mjs --url http://localhost:3000 --task-id 700

# Graceful skip when Playwright not installed:
node scripts/visual-verify.mjs --skip-if-missing --url http://localhost:3000 --task-id 700
```

## What it checks (5 checks × 3 viewports = 15 datapoints)

| #   | Check                 | Description                                      |
| --- | --------------------- | ------------------------------------------------ |
| 1   | `page-title`          | `<title>` element present and non-empty          |
| 2   | `no-layout-overflow`  | body scroll width ≤ viewport width               |
| 3   | `primary-cta-visible` | At least one `<button>` or `<a>` element visible |
| 4   | `no-console-error`    | No console errors on page load                   |
| 5   | `screenshot`          | Full-page screenshot captured for review         |

Viewports: **375px** (mobile), **768px** (tablet), **1280px** (desktop).

## Output schema

Results written to `.arbiter/evidence/visual/<task-id>/<page>.json`:

```json
{
  "url": "http://localhost:3000",
  "task_id": "700",
  "timestamp": "2026-05-17T11:00:00Z",
  "viewports": [
    {
      "width": 375,
      "checks": {
        "page-title": { "pass": true },
        "no-layout-overflow": { "pass": true },
        "primary-cta-visible": { "pass": false, "detail": "no visible CTA found" },
        "no-console-error": { "pass": true },
        "screenshot": { "pass": true, "path": ".arbiter/evidence/visual/700/375.png" }
      }
    }
  ],
  "summary": { "total": 15, "passed": 14, "failed": 1 }
}
```

## When Playwright is absent

With `--skip-if-missing`, the script exits 0 and writes a skip marker:

```json
{
  "skipped": true,
  "reason": "Playwright not installed",
  "install": "npm install -D @playwright/test && npx playwright install chromium"
}
```

Without `--skip-if-missing`, it prints install instructions and exits 1.

## Prerequisites

```bash
npm install -D @playwright/test
npx playwright install chromium
```

## Task completion gate

A task with UI changes is complete only when ALL 15 datapoints pass (or the task explicitly waives specific checks with documented justification in the PR description).
