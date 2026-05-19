---
'@arbiter/cli': minor
---

Add StackAdapter interface + registry + language adapters + INV-88 (#881). Introduces a formal `StackAdapter` extension point for language-specific generation behaviour. TypeScript ships as a full adapter; Java, Python, Go, and Rust ship as stubs. `check-adapter-coverage.mjs` enforces INV-88 at L1. `arbiter doctor health` reports adapter coverage per project.
