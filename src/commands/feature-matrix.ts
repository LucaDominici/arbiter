// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parseFeatureMatrixRows,
  featureMatrixToCsv,
  featureMatrixToXlsx,
} from '../export/feature-matrix-export.js'

export interface FeatureMatrixExportOptions {
  format: 'csv' | 'xlsx'
  out: string
  matrixPath?: string
}

/**
 * Export docs/FEATURE_MATRIX.md to CSV or xlsx.
 *
 * arbiter feature-matrix export --format csv|xlsx --out <path>
 */
export async function runFeatureMatrixExport(opts: FeatureMatrixExportOptions): Promise<void> {
  const matrixPath =
    opts.matrixPath ?? resolve(process.cwd(), 'docs', 'PRODUCT', 'FEATURE_MATRIX.md')

  if (!existsSync(matrixPath)) {
    throw new Error(`FEATURE_MATRIX.md not found at ${matrixPath}`)
  }

  const text = readFileSync(matrixPath, 'utf-8')
  const rows = parseFeatureMatrixRows(text)

  if (opts.format === 'xlsx') {
    const buf = await featureMatrixToXlsx(rows)
    writeFileSync(opts.out, buf)
    return
  }

  const csv = featureMatrixToCsv(rows)
  writeFileSync(opts.out, csv, 'utf-8')
}
