// SPDX-License-Identifier: Apache-2.0

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

// RFC-4180 cell quoting (same pattern as src/kit/csv.ts)
function csvCell(val: string | undefined | null): string {
  const s = val ?? ''
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
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

/** Convert parsed rows to xlsx buffer (exceljs, lazy-imported). */
export async function featureMatrixToXlsx(rows: FeatureMatrixRow[]): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Feature Matrix')

  ws.columns = [
    { header: 'feature_id', key: 'featureId', width: 12 },
    { header: 'capability', key: 'capability', width: 40 },
    { header: 'kit_dims', key: 'kitDims', width: 20 },
    { header: 'level', key: 'level', width: 8 },
    { header: 'status', key: 'status', width: 12 },
    { header: 'code_ref', key: 'codeRef', width: 40 },
    { header: 'test_ref', key: 'testRef', width: 40 },
    { header: 'doc_ref', key: 'docRef', width: 30 },
    { header: 'issue_ref', key: 'issueRef', width: 12 },
    { header: 'note', key: 'note', width: 50 },
  ]

  // Style header row
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  headerRow.commit()

  for (const row of rows) {
    ws.addRow({
      featureId: row.featureId,
      capability: row.capability,
      kitDims: row.kitDims.join(','),
      level: row.level,
      status: row.status,
      codeRef: row.codeRef,
      testRef: row.testRef,
      docRef: row.docRef,
      issueRef: row.issueRef,
      note: row.note,
    })
  }

  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>
}
