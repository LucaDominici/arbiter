// SPDX-License-Identifier: Apache-2.0
// @ts-check
import noRawCliStrings from './no-raw-cli-strings.js'
import fsErrnoTranslation from './fs-errno-translation.js'

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: 'arbiter-i18n',
    version: '1.0.0',
  },
  rules: {
    'no-raw-cli-strings': noRawCliStrings,
    'fs-errno-translation': fsErrnoTranslation,
  },
}

export default plugin
