// SPDX-License-Identifier: Apache-2.0
// Cucumber configuration for BDD behavioral tests (#1040).
// Uses tsx/esm loader for TypeScript step definitions (Node 22+ --import API).
export default {
  import: ['features/step_definitions/**/*.ts'],
  format: ['progress'],
}
