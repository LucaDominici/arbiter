// #1761: exercises the worker's `rawMod['plugin']` fallback. Node's CJS/ESM
// interop always synthesizes a truthy `default` for `module.exports`, so a
// real ES module with a named `plugin` export (and no default) is the only
// way to reach this branch — `rawMod['default']` is genuinely `undefined`.
export const plugin = {
  name: 'plugin-key-export-plugin',
  apiVersion: '1',
  detect() {
    return true
  },
}
