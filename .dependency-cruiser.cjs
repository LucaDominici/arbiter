/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies create tight coupling (INV-01)',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'no-orphan',
      severity: 'warn',
      comment: 'Orphan modules are unreachable dead code',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)index\\.(ts|js|cjs|mjs)$',
          '\\.config\\.(ts|js|cjs|mjs)$',
          '\\.test\\.(ts|js)$',
          '\\.spec\\.(ts|js)$',
        ],
      },
      to: {},
    },
    // #1837 (F1): the three path-based layer rules previously here
    // (no-cross-layer, no-domain-to-infra, no-repositories-to-api) targeted
    // src/domain/, src/services/, src/repositories/, src/api/, src/infrastructure/ —
    // none of which exist in this repo (arbiter is a CLI + generator tool, not a
    // hexagonal-layered app; see `find src -maxdepth 1 -type d` for the real
    // tree). They were inert boilerplate that could never match, not enforced
    // architecture. Removed rather than forced onto a tree they don't fit.
    // INV-03 (layer boundaries) is enforced per-language in *generated* target
    // projects via their own arch-linter template/gate wiring, not here.
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
}
