'use strict'

module.exports = {
  name: 'bad-verify-rules-plugin',
  apiVersion: '1',
  templateRoot: __dirname,
  verifyPlanRules: 'not-an-array',
  generate() {
    return { files: [] }
  },
}
