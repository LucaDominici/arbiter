---
generated: true
source: 'docs/internal/mobile-responsiveness-checklist.md'
source_sha: '89ec1f38d0575e2ed3d4730faac0e939b6c81fd4'
last_updated: '2026-06-07'
---

# Docs Site: A11y + Mobile Responsiveness Checklist

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/internal/mobile-responsiveness-checklist.md](../docs/internal/mobile-responsiveness-checklist.md)

# Docs Site: A11y + Mobile Responsiveness Checklist

Companion to automated axe-core CI (`.github/workflows/docs-a11y.yml`).
Run manually before every release that changes docs UI.

## Automated Gates

The following run in CI and block docs deploy on failure:

| Gate                      | Tool                          | Threshold                     |
| ------------------------- | ----------------------------- | ----------------------------- |
| WCAG 2.1 AA violations    | `@axe-core/cli` on built site | 0 violations                  |
| Lighthouse Performance    | Lighthouse CI                 | ≥ 90 on `/` and `/quickstart` |
| Lighthouse Accessibility  | Lighthouse CI                 | ≥ 95 on `/` and `/quickstart` |
| Lighthouse Best Practices | Lighthouse CI                 | ≥ 95 on `/` and `/quickstart` |
| Lighthouse SEO            | Lighthouse CI                 | ≥ 95 on `/` and `/quickstart` |

## Manual Checks (360px Viewport)

Set browser DevTools to 360×640 (e.g., iPhone SE). Verify each:

| Check                                                                                          | Pass | Fail | Notes |
| ---------------------------------------------------------------------------------------------- | ---- | ---- | ----- |
| Navigation: hamburger/drawer opens and is reachable by touch                                   | [ ]  | [ ]  |       |
| Navigation: all top-level links accessible from mobile menu                                    | [ ]  | [ ]  |       |
| Code blocks: scroll horizontally when content overflows (no line wrap that breaks indentation) | [ ]  | [ ]  |       |
| Code blocks: no horizontal overflow on the page body itself                                    | [ ]  | [ ]  |       |
| Search dialog: trigger opens (button reachable)                                                | [ ]  | [ ]  |       |
| Search dialog: input field receives focus                                                      | [ ]  | [ ]  |       |
| Search dialog: results render within viewport                                                  | [ ]  | [ ]  |       |
| Dark mode toggle: button/icon is visible and reachable                                         | [ ]  | [ ]  |       |
| Dark mode: activating it does not break layout or contrast                                     | [ ]  | [ ]  |       |
| Tables: scroll horizontally on small viewport, not overflow body                               | [ ]  | [ ]  |       |
| Font size: body text ≥ 16px (no pinch required to read)                                        | [ ]  | [ ]  |       |

## Keyboard / Screen Reader Spot-check

| Check                                                     | Pass | Fail | Notes |
| --------------------------------------------------------- | ---- | ---- | ----- |
| Tab through nav: all links focusable in logical order     | [ ]  | [ ]  |       |
| Skip-to-content link visible on first tab                 | [ ]  | [ ]  |       |
| Images have alt text (check via DevTools > Accessibility) | [ ]  | [ ]  |       |
| Color contrast: body text on background ≥ 4.5:1           | [ ]  | [ ]  |       |
| Color contrast: code blocks ≥ 4.5:1 in both light + dark  | [ ]  | [ ]  |       |

## Tester Sign-off

**Tester:** **\*\***\_\_\_**\*\***  
**Date:** **\*\***\_\_\_**\*\***  
**Docs version / commit:** **\*\***\_\_\_**\*\***

All checks PASS or waived with follow-up issue #\_\_\_
