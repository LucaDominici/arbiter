// SPDX-License-Identifier: Apache-2.0

import { csvCell } from '../kit/csv.js'
import { writeXlsx } from './xlsx-writer.js'

const START_MARKER = '<!-- FEATURE_MATRIX_START -->'
const END_MARKER = '<!-- FEATURE_MATRIX_END -->'

export interface FeatureMatrixRow {
  featureId: string
  capability: string
  kitDims: string[]
  level: string
  status: string
  codeRef: string
  testRef: string
  docRef: string
  issueRef: string
  note: string
}

function parseCells(line: string): string[] {
  return line
    .trim()
    .split('|')
    .map((c) => c.trim())
    .filter((_, i) => i > 0)
}

function isDataRow(cells: string[]): boolean {
  const id = cells[0] ?? ''
  return id !== '' && id !== 'feature_id' && !/^-+$/.test(id)
}

function at(cells: string[], i: number): string {
  return cells[i] ?? ''
}

function cellsToRow(cells: string[]): FeatureMatrixRow {
  return {
    featureId: at(cells, 0),
    capability: at(cells, 1),
    kitDims: at(cells, 2)
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean),
    level: at(cells, 3),
    status: at(cells, 4),
    codeRef: at(cells, 5),
    testRef: at(cells, 6),
    docRef: at(cells, 7),
    issueRef: at(cells, 8),
    note: at(cells, 9),
  }
}

/** Parse feature matrix rows from the sentinel block in FEATURE_MATRIX.md. */
export function parseFeatureMatrixRows(text: string): FeatureMatrixRow[] {
  const start = text.indexOf(START_MARKER)
  const end = text.indexOf(END_MARKER)
  if (start === -1 || end === -1 || end <= start) return []

  const block = text.slice(start + START_MARKER.length, end)
  const rows: FeatureMatrixRow[] = []

  for (const line of block.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = parseCells(line)
    if (cells.length < 10 || !isDataRow(cells)) continue
    rows.push(cellsToRow(cells))
  }

  return rows
}

/** Convert parsed rows to RFC-4180 CSV string. */
export function featureMatrixToCsv(rows: FeatureMatrixRow[]): string {
  const headers = [
    'feature_id',
    'capability',
    'kit_dims',
    'level',
    'status',
    'code_ref',
    'test_ref',
    'doc_ref',
    'issue_ref',
    'note',
  ]

  const lines: string[] = [headers.map(csvCell).join(',')]

  for (const row of rows) {
    lines.push(
      [
        csvCell(row.featureId),
        csvCell(row.capability),
        csvCell(row.kitDims.join(',')),
        csvCell(row.level),
        csvCell(row.status),
        csvCell(row.codeRef),
        csvCell(row.testRef),
        csvCell(row.docRef),
        csvCell(row.issueRef),
        csvCell(row.note),
      ].join(','),
    )
  }

  return lines.join('\r\n') + '\r\n'
}

/** Convert parsed rows to an xlsx buffer (native zero-dependency writer). */
export async function featureMatrixToXlsx(rows: FeatureMatrixRow[]): Promise<Buffer> {
  // The native writer (`src/export/xlsx-writer.ts`) replaces the exceljs runtime
  // dependency: it produces a valid .xlsx (STORE zip + inline-string OOXML) with
  // no external supply-chain surface, eliminating the transitive uuid@8
  // (GHSA-w5hq-g745-h8pq) that npm overrides cannot protect consumers from
  // (#1670). Formula neutralization (CWE-1236) is applied by the writer to
  // every cell; values are passed raw and neutralized at emission.
  const headers = [
    'feature_id',
    'capability',
    'kit_dims',
    'level',
    'status',
    'code_ref',
    'test_ref',
    'doc_ref',
    'issue_ref',
    'note',
  ]
  const colWidths = [12, 40, 20, 8, 12, 40, 40, 30, 12, 50]
  const dataRows = rows.map((row) => [
    row.featureId,
    row.capability,
    row.kitDims.join(','),
    row.level,
    row.status,
    row.codeRef,
    row.testRef,
    row.docRef,
    row.issueRef,
    row.note,
  ])

  return Promise.resolve(writeXlsx({ name: 'Feature Matrix', headers, rows: dataRows, colWidths }))
}
