'use strict'

module.exports = {
  name: 'invariants-bad-plugin',
  apiVersion: '1',
  templateRoot: __dirname + '/templates',
  invariants: [
    {
      id: 'INV-99',
      tier: 'governance',
      title: 'collides with built-in namespace',
      description: 'must be rejected',
      alwaysActive: true,
    },
  ],
  generate(ctx) {
    return { files: [] }
  },
}
