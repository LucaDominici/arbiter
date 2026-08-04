'use strict'

module.exports = {
  name: 'invariants-plugin',
  apiVersion: '1',
  templateRoot: __dirname + '/templates',
  invariants: [
    {
      id: 'PROJ-01',
      tier: 'governance',
      title: 'Tenancy isolation is a product contract',
      description: 'Every tenant-scoped resource must carry owner_id.',
      alwaysActive: true,
      enforcement: 'CI (constraint scan); code review',
    },
  ],
  generate(ctx) {
    return { files: [] }
  },
}
