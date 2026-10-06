// Fills the official CNX "NEW CAR FORM - 2023" Word template with CarData.
// The template lives in /templates/car-template.docx so it can be swapped without code changes.

import JSZip from 'jszip';
import type { CarData, Row } from './types';
import { normalizeCar } from './assemble';
import {
  parseXml, serializeXml, findTable, findTables, rows, cells, setCellText, appendCellText,
  prependCellText, setCellAnswer, replaceRows, removeNode, insertBefore, findParagraph,
  cloneParagraphWithText, emptyParagraph, kids, textOf, norm,
} from './docx-xml';

const RED = 'FF0000';

function orNA(data: Row[], width: number, firstOnly = false): Row[] {
  const clean = (data || []).filter((r) => r && r.some((v) => (v || '').trim() !== ''));
  if (clean.length) return clean.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  return [Array.from({ length: width }, (_, i) => (firstOnly && i > 0 ? '' : 'N/A'))];
}

export async function buildCarDocx(template: Buffer | ArrayBuffer, input: CarData): Promise<Buffer> {
  const car = normalizeCar(input);
  const zip = await JSZip.loadAsync(template);
  const xml = await zip.file('word/document.xml')!.async('string');
  const doc = parseXml(xml);
  const body = doc.getElementsByTagName('w:body')[0];

  // ---------- Header block ----------
  const hdr = findTable(body, 'Title Opinion QLS #');
  {
    const r = rows(hdr);
    const c1 = cells(r[1]);
    setCellText(c1[0], car.qls);
    setCellText(c1[1], car.tmp);
    setCellText(c1[2], car.twpCountyState);
    const ops = (car.opinions || []).filter((o) => o.lawFirm || o.certRange || o.opinionDate);
    replaceRows(hdr, 3, 2, (ops.length ? ops : [{ lawFirm: '', certRange: '', opinionDate: '' }])
      .map((o) => [o.lawFirm, o.certRange, o.opinionDate]));
    const r2 = rows(hdr);
    const n = r2.length;
    // last three rows: Estates value (n-3), acres labels (n-2), acres values (n-1)
    setCellText(cells(r2[n - 3])[0], car.estates);
    const acres = cells(r2[n - 1]);
    setCellText(acres[0], car.acresTitle);
    setCellText(acres[1], car.acresResolved, { color: RED });
  }

  // ---------- Curative summary ----------
  const summary: [string, string][] = [
    ['LAND CURATIVE RECOMMENDATIONS', car.curativeSummary.land],
    ['MAPPING CURATIVE RECOMMENDATIONS', car.curativeSummary.mapping],
    ['TITLE CURATIVE RECOMMENDATIONS', car.curativeSummary.title],
    ['DIVISION ORDER', car.curativeSummary.divisionOrder],
  ];
  // CNX analysts title the 4th box "DIVISION ORDER RECOMMENDATIONS" (the 2023 form says "ITEMS")
  {
    const t = findTable(body, 'DIVISION ORDER');
    setCellText(cells(rows(t)[0])[0], 'DIVISION ORDER RECOMMENDATIONS');
  }
  for (const [label, value] of summary) {
    const t = findTable(body, label);
    const v = (value || '').trim() || 'None';
    setCellText(cells(rows(t)[1])[0], v, { color: v === 'None' ? '000000' : RED });
  }

  // ---------- Final operating leasehold summary ----------
  setCellText(cells(rows(findTable(body, 'Tract Description'))[1])[0], car.tractDescription, { bold: false, underline: false, size: 18 });

  const wiProtos = findTables(body, 'Working Interest Ownership');
  if (wiProtos.length) {
    const proto = wiProtos[0];
    const wiTables = car.wiTables?.length ? car.wiTables : [{ formation: '', rows: [] }];
    const built = wiTables.map((w) => {
      const t = proto.cloneNode(true);
      appendCellText(cells(rows(t)[0])[0], ' ' + (w.formation || ''), { bold: false });
      const data = (w.rows || []).map((r) => [r.owner, r.wi, r.nri, r.orri]);
      replaceRows(t, 2, rows(t).length - 2, data.length ? data : [['', '', '', '']]);
      return t;
    });
    // collect the template WI tables plus any empty paragraphs sitting between them
    const last = wiProtos[wiProtos.length - 1];
    const toRemove: unknown[] = [];
    for (let n = proto; n; n = n.nextSibling) {
      if (n.nodeType === 1) {
        if (wiProtos.includes(n) || (n.nodeName === 'w:p' && !textOf(n).trim())) toRemove.push(n);
        else break;
      }
      if (n === last) break;
    }
    for (const t of wiProtos) if (!toRemove.includes(t)) toRemove.push(t);
    built.forEach((t, i) => {
      if (i > 0) insertBefore(emptyParagraph(doc), proto);
      insertBefore(t, proto);
    });
    toRemove.forEach((n) => removeNode(n));
  }

  // ownership tables — one per parcel
  {
    const ownProto = findTable(body, 'Owner');
    const heading = findParagraph(body, 'LEASEHOLD CONTROL AND OWNERSHIP SUMMARY');
    const parcels = car.parcels?.length ? car.parcels : [{ label: '', owners: [] }];
    const multi = parcels.length > 1;
    parcels.forEach((parcel, i) => {
      if (multi || parcel.label) {
        if (i > 0) insertBefore(emptyParagraph(doc), ownProto);
        if (heading) insertBefore(cloneParagraphWithText(heading, parcel.label, { bold: false }), ownProto);
      }
      const t = ownProto.cloneNode(true);
      const data = (parcel.owners || []).map((o) => [
        o.owner, o.execRights, o.royaltyOwnership, o.controlType, o.agreementQls, o.recording,
        o.royalty, o.poolingLimit, o.pugh, o.expiration, o.heldBy, o.formations,
      ]);
      replaceRows(t, 1, rows(t).length - 1, data.length ? data : [Array(12).fill('')]);
      insertBefore(t, ownProto);
    });
    removeNode(ownProto);
  }

  // ---------- Amendments / assignments / ORRI ----------
  replaceRows(findTable(body, 'Amendments/Ratifications to Lease'), 2, 99, orNA(car.amendments, 7));
  replaceRows(findTable(body, 'Assignment Chain'), 2, 99, orNA(car.assignments, 10));
  replaceRows(findTable(body, 'ORRI Ownership In Lease'), 2, 99, orNA(car.orri, 5));

  // ---------- Units & wells ----------
  replaceRows(findTable(body, 'Existing Units/Pools'), 2, 99, orNA(car.units, 7));
  {
    const t = findTable(body, 'Well History');
    const c = cells(rows(t)[1]);
    setCellText(c[c.length - 2], car.wellDateChecked);
    setCellText(c[c.length - 1], car.leaseWideGaps || 'N/A');
    const wells = (car.wells || []).filter((r) => r.some((v) => (v || '').trim()));
    replaceRows(t, 3, rows(t).length - 3, wells.length ? wells : [Array(7).fill('')]);
  }

  // ---------- Outsales & encumbrances ----------
  replaceRows(findTable(body, 'Outsales Prior to Lease'), 2, 99, orNA(car.outsales, 6, true));
  replaceRows(findTable(body, 'Liens/Encumbrances/Judgments'), 2, 99, orNA(car.liens, 6));
  {
    const t = findTable(body, 'Real-Estate Taxes');
    const r = rows(t);
    const q = cells(r[1]);
    setCellAnswer(q[0], car.taxFullyAssessed || 'N/A');
    setCellAnswer(q[1], car.taxDelinquent || 'N/A');
    // delinquent rows (index 7) first so the unassessed index (4) stays valid
    replaceRows(t, 7, 1, orNA(car.delinquent, 4));
    replaceRows(t, 4, 1, orNA(car.unassessed, 4));
  }
  {
    const t = findTable(body, 'Internal Contracts/Records');
    const r = rows(t);
    const c = cells(r[1]);
    const ct = car.contracts || { agreementNumber: '', name: '', stillValid: '', wellsDrilled: '', restrictions: '' };
    setCellText(c[0], `Agreement Number: ${ct.agreementNumber || 'N/A'}`);
    setCellText(c[1], `Name: ${ct.name || ''}`);
    setCellText(c[2], `Still Valid: ${ct.stillValid || ''}`);
    setCellText(cells(r[2])[0], `Wells Drilled Under Agreement: ${ct.wellsDrilled || ''}`);
    setCellText(cells(r[3])[0], `Restrictions that affect operations: ${ct.restrictions || ''}`);
  }

  // ---------- Curative items ----------
  {
    const t = findTable(body, car.curativeHeading ? 'Title Defects and Analysis' : 'Title Defects and Analysis');
    const r = rows(t);
    if (car.curativeHeading) prependCellText(cells(r[0])[0], car.curativeHeading);
    const sectionProto = r[2].cloneNode(true);
    // item prototype: first 2-cell row whose 2nd cell is red in the template, else row 3
    const itemProto = (r.slice(3).find((x) => cells(x).length === 2 && /FF0000/i.test(serializeXml(cells(x)[1])))
      || r[3]).cloneNode(true);
    for (let i = r.length - 1; i >= 2; i--) removeNode(r[i]);
    for (const sec of car.curativeSections || []) {
      if (!sec.items?.length && !sec.title) continue;
      const s = sectionProto.cloneNode(true);
      setCellText(cells(s)[0], sec.title);
      t.appendChild(s);
      for (const it of sec.items || []) {
        const row = itemProto.cloneNode(true);
        const c = cells(row);
        const defect = it.defect || '';
        const firstLine = defect.split('\n')[0] || '';
        const boldLabel = firstLine.length < 70 && /:\s*$/.test(firstLine);
        setCellText(c[0], defect, { color: '000000', boldFirstLine: boldLabel, bold: boldLabel ? false : undefined });
        setCellText(c[1], it.recommendation || '', { color: RED, bold: false });
        t.appendChild(row);
      }
    }
  }
  setCellText(cells(rows(findTable(body, 'Miscellaneous/Additional Title Notes'))[1])[0], car.miscNotes || 'None');

  // ---------- Review & approval ----------
  {
    const t = findTable(body, 'Analysis Review Completed');
    const c = cells(rows(t)[0]);
    if (car.analysisDate) setCellText(c[1], car.analysisDate);
    if (car.analyst) setCellText(c[3], car.analyst);
  }

  zip.file('word/document.xml', serializeXml(doc));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// exported for tests
export const _internal = { kids, norm };
