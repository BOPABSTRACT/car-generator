// Reads a completed CAR (.docx built on the NEW CAR FORM – 2023) back into CarData.
// Used by the "Pad Summary from an existing CAR" option. No AI involved — the CAR is already structured.

import JSZip from 'jszip';
import type { CarData, CarOwnerRow, CurativeBlock, CurativeSection, OpinionRow, ParcelOwnership, Row } from './types';
import { parseXml, findTables, rows, cells, textOf, norm, all } from './docx-xml';

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

/** Cell text with one line per paragraph. */
function cellText(tc: El): string {
  return all(tc, 'w:p').map((p: El) => textOf(p)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function rowTexts(tr: El): string[] {
  return cells(tr).map(cellText);
}

function first(root: El, prefix: string): El | null {
  return findTables(root, prefix)[0] || null;
}

/** Data rows of a simple table: skip `skip` header rows, drop blank rows and all-"N/A" rows. */
function dataRows(t: El | null, skip: number): Row[] {
  if (!t) return [];
  return rows(t).slice(skip).map(rowTexts)
    .filter((r) => r.some((v) => v.trim()) && !r.every((v) => !v.trim() || /^n\/a$/i.test(v.trim())));
}

/** Text of the first non-empty paragraph before a table (e.g. "As to Parcel One (240.06-01-11)"). */
function labelBefore(t: El): string {
  for (let n = t.previousSibling; n; n = n.previousSibling) {
    if (n.nodeType !== 1) continue;
    if (n.nodeName === 'w:tbl') return '';
    if (n.nodeName === 'w:p') {
      const s = textOf(n).trim();
      if (s) return /^as to/i.test(s) ? s : '';
    }
  }
  return '';
}

export async function parseCarDocx(buf: Buffer | ArrayBuffer): Promise<CarData> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('This file is not a Word .docx document');
  const doc = parseXml(await file.async('string'));
  const body = doc.getElementsByTagName('w:body')[0];

  const hdr = first(body, 'Title Opinion QLS #');
  if (!hdr) throw new Error('This does not look like a CAR — the "Title Opinion QLS #" header table was not found');

  // ---------- header ----------
  const hr = rows(hdr);
  const h1 = rowTexts(hr[1]);
  const opinions: OpinionRow[] = [];
  let estates = '';
  let acresTitle = '';
  let acresResolved = '';
  for (let i = 3; i < hr.length; i++) {
    const t = rowTexts(hr[i]);
    if (norm(t.join(' ')).startsWith('estates and formations')) {
      estates = rowTexts(hr[i + 1] || hr[i])[0] || '';
      const last = rowTexts(hr[hr.length - 1]);
      acresTitle = last[0] || '';
      acresResolved = last[1] || '';
      break;
    }
    if (t.some((v) => v.trim())) opinions.push({ lawFirm: t[0] || '', certRange: (t[1] || '').replace(/\s+/g, ' '), opinionDate: t[2] || '' });
  }

  // ---------- curative summary ----------
  const summaryVal = (label: string) => {
    const t = first(body, label);
    // one cloud per row (older CARs: several clouds in one row)
    return t ? rows(t).slice(1).map((r: El) => cellText(cells(r)[0])).filter(Boolean).join('\n') : '';
  };

  // ---------- ownership tables ----------
  const ownTables = findTables(body, 'Owner').filter((t: El) => norm(textOf(rows(t)[0])).includes('exec rights'));
  const parcels: ParcelOwnership[] = ownTables.map((t: El) => ({
    label: labelBefore(t),
    owners: dataRows(t, 1).map((r): CarOwnerRow => ({
      owner: r[0] || '', execRights: r[1] || '', royaltyOwnership: r[2] || '', controlType: r[3] || '',
      agreementQls: r[4] || '', recording: r[5] || '', royalty: r[6] || '', poolingLimit: r[7] || '',
      pugh: r[8] || '', expiration: r[9] || '', heldBy: r[10] || '', formations: r[11] || '',
    })),
  }));

  // ---------- WI tables ----------
  const wiTables = findTables(body, 'Working Interest Ownership').map((t: El) => ({
    formation: textOf(rows(t)[0]).replace(/^.*?FORMATION:?/i, '').trim(),
    rows: dataRows(t, 2).map((r) => ({ owner: r[0] || '', wi: r[1] || '', nri: r[2] || '', orri: r[3] || '' })),
  }));

  // ---------- curative items: one "Title Defects and Analysis" table per title opinion ----------
  const curTables = findTables(body, '').filter((t: El) => {
    const r0 = rows(t)[0];
    return r0 && all(r0, 'w:tbl').length === 0 && norm(textOf(r0)).includes('title defects and analysis');
  });
  const curativeBlocks: CurativeBlock[] = curTables.map((curT: El) => {
    const head = textOf(rows(curT)[0]);
    const idx = head.toLowerCase().indexOf('title defects');
    const sections: CurativeSection[] = [];
    let sec: CurativeSection | null = null;
    for (const tr of rows(curT).slice(2)) {
      const cs = cells(tr);
      const t0 = cs[0] ? cellText(cs[0]) : '';
      const t1 = cs[1] ? cellText(cs[1]) : '';
      if (!t0 && !t1) continue;
      const isHeading = t0 && !t1 && t0.length < 70 && t0 === t0.toUpperCase();
      if (isHeading) {
        sec = { title: t0.replace(/\s+/g, ' '), items: [] };
        sections.push(sec);
        continue;
      }
      if (!sec) { sec = { title: 'SPECIFIC CURATIVE ACTION ITEMS', items: [] }; sections.push(sec); }
      sec.items.push({ defect: t0, recommendation: t1 });
    }
    return { heading: idx > 0 ? head.slice(0, idx) : '', sections };
  });

  // ---------- misc tables ----------
  const wellT = first(body, 'Well History');
  const wellHdr = wellT ? rowTexts(rows(wellT)[1]) : [];
  const review = first(body, 'Analysis Review Completed');
  const reviewCells = review ? rowTexts(rows(review)[0]) : [];
  const misc = first(body, 'Miscellaneous/Additional Title Notes');

  return {
    qls: (h1[0] || '').trim(),
    tmp: (h1[1] || '').trim(),
    twpCountyState: (h1[2] || '').trim(),
    opinions,
    estates,
    acresTitle,
    acresResolved,
    curativeSummary: {
      land: summaryVal('LAND CURATIVE RECOMMENDATIONS'),
      mapping: summaryVal('MAPPING CURATIVE RECOMMENDATIONS'),
      title: summaryVal('TITLE CURATIVE RECOMMENDATIONS'),
      divisionOrder: summaryVal('DIVISION ORDER'),
    },
    tractDescription: (() => { const t = first(body, 'Tract Description'); return t && rows(t)[1] ? cellText(cells(rows(t)[1])[0]) : ''; })(),
    wiTables,
    parcels,
    amendments: dataRows(first(body, 'Amendments/Ratifications to Lease'), 2),
    assignments: dataRows(first(body, 'Assignment Chain'), 2),
    orri: dataRows(first(body, 'ORRI Ownership In Lease'), 2),
    units: dataRows(first(body, 'Existing Units/Pools'), 2),
    wellDateChecked: wellHdr[wellHdr.length - 2] || '',
    leaseWideGaps: wellHdr[wellHdr.length - 1] || '',
    wells: dataRows(wellT, 3),
    outsales: dataRows(first(body, 'Outsales Prior to Lease'), 2),
    liens: dataRows(first(body, 'Liens/Encumbrances/Judgments'), 2),
    taxFullyAssessed: '',
    taxDelinquent: '',
    unassessed: [],
    delinquent: [],
    contracts: { agreementNumber: '', name: '', stillValid: '', wellsDrilled: '', restrictions: '' },
    curativeBlocks: curativeBlocks.length ? curativeBlocks : [{ heading: '', sections: [] }],
    miscNotes: misc && rows(misc)[1] ? cellText(cells(rows(misc)[1])[0]) : '',
    analysisDate: (reviewCells[1] || '').replace(/\[DATE\]/i, '').trim(),
    analyst: reviewCells[3] || '',
  };
}

