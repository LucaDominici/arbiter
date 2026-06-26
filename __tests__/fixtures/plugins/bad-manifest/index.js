'use strict'

// Functionally valid plugin shape — the defect under test is the MANIFEST
// (package.json missing the mandatory `arbiter-plugin` keyword), so loadPlugin
// must reject before this module's shape is ever consulted (#1562).
module.exports = {
  name: 'bad-manifest-plugin',
  apiVersion: '1',
  templateRoot: __dirname + '/templates',
  generate() {
    return { files: [] }
  },
}
