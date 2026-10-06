// Builds the Pad Summary workbook (Ownership + Title-Curative tabs) in the exact column layout of the
// CNX Pad Summary master so the rows can be copied straight into the unit's Pad Summary.

import ExcelJS from 'exceljs';
import type { PadData } from './types';
import { OWNERSHIP_COLUMNS, TITLE_CURATIVE_COLUMNS, OWNERSHIP_TOP_LABELS } from './pad-columns';

const FONT = { name: 'Times New Roman', size: 11 };
const THIN = { style: 'thin' as const };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const ALIGN = { wrapText: true, horizontal: 'left' as const, vertical: 'middle' as const };

const DATE_COLS = new Set(['M', 'O', 'R', 'S', 'BJ', 'BK']);
const NUMBER_COLS = new Set(['AD', 'AF', 'AG', 'AH', 'AM', 'BC']);
const OWN_HEADER_ROW = 21;

function asDate(v: string): Date | null {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
}

function asNumber(v: string): number | null {
  const s = v.trim().replace(/,/g, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return parseFloat(s);
}

/** Converts "1/2", "0.5", "=1/2" into an Excel value (formula for fractions, number for decimals). */
function asFraction(v: string): ExcelJS.CellValue {
  const s = v.trim();
  if (!s) return null;
  if (s.startsWith('=')) return { formula: s.slice(1) };
  if (/^\d+\s*\/\s*\d+$/.test(s)) return { formula: s.replace(/\s/g, '') };
  const n = asNumber(s);
  return n === null ? s : n;
}

function cellValue(col: string, raw: string | undefined): ExcelJS.CellValue {
  const v = (raw ?? '').toString();
  if (!v.trim()) return null;
  if (v.trim().startsWith('=')) return { formula: v.trim().slice(1) };
  if (col === 'AI' || col === 'AN') return asFraction(v);
  if (DATE_COLS.has(col)) {
    const d = asDate(v);
    if (d) return d;
  }
  if (NUMBER_COLS.has(col)) {
    const n = asNumber(v);
    if (n !== null) return n;
    if (/^[\d.+\s]+$/.test(v.trim()) && v.includes('+')) return { formula: v.replace(/\s/g, '') };
  }
  return v;
}

function styleHeader(cell: ExcelJS.Cell, fill: string) {
  cell.font = { ...FONT, bold: true };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.border = BORDER;
  cell.alignment = ALIGN;
}

function styleData(cell: ExcelJS.Cell, numFmt?: string) {
  cell.font = FONT;
  cell.border = BORDER;
  cell.alignment = ALIGN;
  if (numFmt) cell.numFmt = numFmt;
}

export async function buildPadXlsx(pad: PadData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BOP Abstract CAR Generator';
  wb.created = new Date();

  // ---------------- Ownership ----------------
  const ws = wb.addWorksheet('Ownership', {
    views: [{ state: 'frozen', ySplit: OWN_HEADER_ROW, xSplit: 0 }],
  });
  OWNERSHIP_COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  for (const [addr, label] of OWNERSHIP_TOP_LABELS) {
    const cell = ws.getCell(addr);
    cell.value = label;
    cell.font = { ...FONT, bold: ['A1', 'D1', 'A11', 'AS8'].includes(addr) };
    if (['A1', 'D1', 'A11', 'AS8'].includes(addr)) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    }
    cell.border = BORDER;
  }
  ws.mergeCells('A1:B1');
  ws.mergeCells('D1:E1');
  ws.mergeCells('A11:B11');
  ws.mergeCells('AS8:AT8');
  ws.getCell('B2').value = pad.unit.unitName || '';
  ws.getCell('B3').value = pad.unit.twpCountyState || '';
  const total = asNumber(pad.unit.totalAcres || '');
  ws.getCell('B4').value = total ?? (pad.unit.totalAcres || null);
  for (const a of ['B2', 'B3', 'B4']) { ws.getCell(a).font = FONT; ws.getCell(a).border = BORDER; }

  const hdr = ws.getRow(OWN_HEADER_ROW);
  hdr.height = 82.8;
  OWNERSHIP_COLUMNS.forEach((c, i) => {
    const cell = hdr.getCell(i + 1);
    cell.value = c.header;
    styleHeader(cell, c.fill);
  });

  pad.ownership.forEach((row, idx) => {
    const r = OWN_HEADER_ROW + 1 + idx;
    const xr = ws.getRow(r);
    xr.height = 55.2;
    OWNERSHIP_COLUMNS.forEach((c, i) => {
      const cell = xr.getCell(i + 1);
      const raw = row[c.col];
      if (c.formula && !(raw && raw.trim())) cell.value = { formula: c.formula.replace(/\{r\}/g, String(r)).slice(1) };
      else cell.value = cellValue(c.col, raw);
      styleData(cell, DATE_COLS.has(c.col) ? 'm/d/yyyy' : c.numFmt);
    });
  });
  ws.autoFilter = { from: { row: OWN_HEADER_ROW, column: 1 }, to: { row: OWN_HEADER_ROW, column: OWNERSHIP_COLUMNS.length } };

  // ---------------- Title-Curative ----------------
  const tc = wb.addWorksheet('Title-Curative ', { views: [{ state: 'frozen', ySplit: 1, xSplit: 0 }] });
  TITLE_CURATIVE_COLUMNS.forEach((c, i) => { tc.getColumn(i + 1).width = c.width; });
  const th = tc.getRow(1);
  th.height = 27.6;
  TITLE_CURATIVE_COLUMNS.forEach((c, i) => {
    const cell = th.getCell(i + 1);
    cell.value = c.header;
    styleHeader(cell, c.fill);
  });
  pad.titleCurative.forEach((row, idx) => {
    const xr = tc.getRow(2 + idx);
    TITLE_CURATIVE_COLUMNS.forEach((c, i) => {
      const cell = xr.getCell(i + 1);
      const raw = ((row as unknown as Record<string, string>)[c.key] ?? '').toString();
      const d = (c.col === 'D' || c.col === 'E') ? asDate(raw) : null;
      cell.value = d ?? (raw || null);
      styleData(cell, d ? 'm/d/yyyy' : undefined);
    });
  });
  tc.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TITLE_CURATIVE_COLUMNS.length } };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
