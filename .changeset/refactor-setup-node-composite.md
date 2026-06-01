---
'arbiter': patch
---

refactor(#1131): consolidate setup-node + npm ci into the setup-node-pnpm composite (#1131 slice 2)

Eliminates the duplicated `actions/setup-node + npm ci` boilerplate across CI workflows by extending the (previously dead, 0-caller) `setup-node-pnpm` composite action to bundle setup-node + `npm ci` (opt-out via the `install` input) and pinning a single canonical setup-node SHA.

- **Composite (both tracks):** `setup-node-pnpm/action.yml(.ejs)` now runs `npm ci` (gated on `install`, `shell: bash`) and pins `actions/setup-node@…v6.4.0` (was a dead v4.3.0). Emit-wiring unchanged (already emitted by the CI-tier generator). The legacy `-pnpm` dir name is retained (renaming would orphan the dir in already-generated repos); the action's `name:` is corrected.
- **Rewired** every `setup-node + npm ci` pair to `uses: ./.github/actions/setup-node-pnpm` across 01-pr-fast, 02-pr-extended, 05-release, 06-nightly, 06-nightly-lite, 07-weekly, 08-monthly, 12-mutation-scheduled, 14-license-scan, 15-codeql, drift-shadow. Parity-gated workflows are regenerated from their templates; 05-release is hand-edited (both tracks). Node-only/bare jobs (PII scan, change-classify, action-pin audit) and the publish-package job (needs `registry-url`) keep their inline setup-node.
- **SHA consolidation:** 3 distinct setup-node pins → 1 (v6.4.0). This bumps the per-PR hot path (01/02) v4→v6.4.0 (node 22 compatible). The composite pin sits outside `sync-action-pins`/INV-76, so a new render test (`setup-node-pnpm-render.test.ts`) asserts the canonical SHA; a new `01-pr-fast-render.test.ts` covers the most-rewired workflow.
