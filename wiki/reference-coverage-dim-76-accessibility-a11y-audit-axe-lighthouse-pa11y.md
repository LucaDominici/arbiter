---
generated: true
source: 'docs/REFERENCE/coverage/dim-76-accessibility-a11y-audit-axe-lighthouse-pa11y.md'
source_sha: '5817b94c3c32c91690a3a0bd7f8249ba78cd3704'
last_updated: '2026-06-09'
---

# N76: Accessibility (a11y) audit (Axe / Lighthouse / pa11y)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-76-accessibility-a11y-audit-axe-lighthouse-pa11y.md](../docs/REFERENCE/coverage/dim-76-accessibility-a11y-audit-axe-lighthouse-pa11y.md)

<!-- arbiter-generated dim=N76 hash=b3428f34794dc10455d4a19b227445f7d651057a8b943b23e8759827f9e6e0a3 generator=kit@1 -->

# N76: Accessibility (a11y) audit (Axe / Lighthouse / pa11y)

| Field    | Value    |
| -------- | -------- |
| TML      | L3       |
| Gate     | ADVISORY |
| Status   | partial  |
| Category | a11y     |

## Notes

a11y auditing for frontend archetypes; INV-61 enforces a11y gate when frontend present

## Per-Stack Coverage

| Stack        | Kind                                   |
| ------------ | -------------------------------------- |
| `java`       | gap                                    |
| `typescript` | tool: axe-core/playwright (via a11y)   |
| `python`     | tool: axe-playwright-python (via a11y) |
| `go`         | gap                                    |
| `rust`       | gap                                    |
