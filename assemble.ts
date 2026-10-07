// Turns the AI extraction results into the two editable deliverables:
//   CarData  -> the Word Curative Action Report
//   PadData  -> the Pad Summary Ownership + Title-Curative rows
// Pure functions — runs in the browser so the review screen can rebuild instantly.

import type {
  CarData, PadData, CoreExtract, CurativeExtract, OwnershipExtract, LeaseInfo, FormInfo,
  CurativeSection, CarOwnerRow, PadOwnershipRow, TitleCurativeRow, CuratorItemExtract, CurativeBlock,
} from './types';

const ORDINALS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];

const SECTION_ORDER = [
  'SPECIFIC CURATIVE ACTION ITEMS',
  'GENERAL CURATIVE ACTION ITEMS',
  'NON-ACTION CURATIVE ITEMS',
  'COMMENTS AND LIMITATIONS',
  'INTERNAL BRINGDOWN ITEMS',
];

export function fractionToDecimal(f: string): number | null {
  const s = (f || '').trim().replace(/^=/, '');
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m) return parseFloat(m[1]) / parseFloat(m[2]);
  const pct = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) return parseFloat(pct[1]) / 100;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** 1 -> "1.0", 0.5 -> "0.5", 0.0454545 -> "0.04545455" */
export function decimalString(f: string): string {
  const d = fractionToDecimal(f);
  if (d === null) return f || '';
  if (Number.isInteger(d)) return d.toFixed(1);
  return parseFloat(d.toFixed(8)).toString();
}

/** CAR style: "0.15 (Gross)" */
function royaltyDisplay(rate: string, gross?: string): string {
  const d = fractionToDecimal(rate);
  if (d === null) return rate || '';
  const dec = d > 1 ? d / 100 : d;
  return `${parseFloat(dec.toFixed(6))}${/^y/i.test(gross || '') ? ' (Gross)' : ''}`;
}

function poolingDisplay(v: string): string {
  return /^unlimited$/i.test((v || '').trim()) ? 'No Limit' : v || '';
}

function pughDisplay(v: string): string {
  return /^no$/i.test((v || '').trim()) ? 'None' : v || '';
}

function heldByDisplay(v: string): string {
  return /primary\s*term/i.test(v || '') ? 'Term' : v || 'Term';
}

/**
 * - adds leases known only from the bringdown/opinion (record_leases) to the lease list
 * - merges parcels whose owners and interests are identical into one parcel (CNX shows them as one table)
 */
export function normalizeOwnership(own: OwnershipExtract, leases: LeaseInfo[]): { ownership: OwnershipExtract; leases: LeaseInfo[] } {
  const record = (own.record_leases || []).map((r): LeaseInfo => ({
    source_file: 'record', lessors: r.lessors || '', lessee: r.lessee || '', agreement_number: r.agreement_number || '',
    effective_date: r.effective_date || '', recording: r.recording || '', recorded_date: '', primary_term: '',
    primary_term_expiration: r.primary_term_expiration || '', extension_type: '', extension_terms: '',
    earliest_extension_expiration: '', final_extension_expiration: '', formations: r.formations || '',
    pooling_limitation: '', pugh: '', cross_unit_prohibited: '', gross_acres: '', tmps_covered: '',
    royalty_rate: r.royalty_rate || '', gross_royalty: '', deduct_language: '', market_enhancement: '', min_pay: '',
    recoupment_allowed: '', mwm: '', apportionment: '', notes_for_reviewer: '',
  }));
  const allLeases = [...leases, ...record];
  let owners = (own.owners || []).map((o) => {
    const ri = o.record_lease_index;
    if ((o.lease_index === null || o.lease_index === undefined) && ri !== null && ri !== undefined && record[ri]) {
      return { ...o, lease_index: leases.length + ri, lease_status: !o.lease_status || /^open$/i.test(o.lease_status) ? 'Primary Term' : o.lease_status };
    }
    return o;
  });
  let parcels = own.parcels || [];

  // merge parcels with identical ownership
  if (parcels.length > 1) {
    const sig = (pi: number) => owners.filter((o) => (o.parcel_index ?? 0) === pi)
      .map((o) => [o.owner_name.toLowerCase().replace(/[^a-z]/g, ''), fractionToDecimal(o.exec_fraction), fractionToDecimal(o.royalty_fraction), o.lease_index ?? ''].join('|'))
      .sort().join('#');
    const first = sig(0);
    if (first && parcels.every((_, i) => sig(i) === first)) {
      const sum = (k: 'deeded_acres' | 'resolved_acres') => {
        const vals = parcels.map((p) => parseFloat((p[k] || '').replace(/,/g, '')));
        return vals.every((v) => !isNaN(v)) ? String(parseFloat(vals.reduce((a, b) => a + b, 0).toFixed(4))) : '';
      };
      parcels = [{ label: 'Parcel One', tmp: parcels.map((p) => p.tmp).filter(Boolean).join(', '), deeded_acres: sum('deeded_acres'), resolved_acres: sum('resolved_acres') }];
      owners = owners.filter((o) => (o.parcel_index ?? 0) === 0).map((o) => ({ ...o, tmp: parcels[0].tmp }));
    }
  }
  return { ownership: { ...own, parcels, owners }, leases: allLeases };
}

function numbered(lines: string[]): string {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (!clean.length) return 'None';
  return clean.map((l, i) => `${i + 1}. ${l.replace(/^\d+\.\s*/, '')}`).join('\n');
}

function normSection(s: string): string {
  const u = (s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (u.includes('SPECIFIC')) return SECTION_ORDER[0];
  if (u.includes('GENERAL')) return SECTION_ORDER[1];
  if (u.includes('NON-ACTION') || u.includes('NON ACTION')) return SECTION_ORDER[2];
  if (u.includes('COMMENT') || u.includes('LIMITATION')) return SECTION_ORDER[3];
  if (u.includes('BRINGDOWN') || u.includes('BRING DOWN')) return SECTION_ORDER[4];
  return u || 'OTHER ITEMS';
}

/** Claude sometimes returns table rows as objects keyed by header — convert everything to string[][]. */
export function toRows(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  return v
    .map((r) => {
      if (Array.isArray(r)) return r.map((x) => (x === null || x === undefined ? '' : String(x)));
      if (r && typeof r === 'object') return Object.values(r as Record<string, unknown>).map((x) => (x === null || x === undefined ? '' : String(x)));
      if (typeof r === 'string') return [r];
      return [];
    })
    .filter((r) => r.length > 0);
}

/** Makes a CarData safe to export (also repairs sessions saved by older versions). */
export function normalizeCar(car: CarData): CarData {
  const c = { ...car };
  c.amendments = toRows(c.amendments);
  c.assignments = toRows(c.assignments);
  c.orri = toRows(c.orri);
  c.units = toRows(c.units);
  c.wells = toRows(c.wells);
  c.outsales = toRows(c.outsales);
  c.liens = toRows(c.liens);
  c.unassessed = toRows(c.unassessed);
  c.delinquent = toRows(c.delinquent);
  c.opinions = Array.isArray(c.opinions) ? c.opinions : [];
  c.wiTables = Array.isArray(c.wiTables) ? c.wiTables : [];
  c.parcels = Array.isArray(c.parcels) ? c.parcels : [];
  const cleanSections = (secs: CurativeSection[] | undefined) => (Array.isArray(secs) ? secs : []).map((sec) => ({
    title: sec.title || '',
    items: (sec.items || []).map((i) => ({ defect: String(i.defect ?? ''), recommendation: String(i.recommendation ?? '') })),
  }));
  if (!Array.isArray(c.curativeBlocks) || !c.curativeBlocks.length) {
    // sessions saved before multi-opinion support
    c.curativeBlocks = [{ heading: c.curativeHeading || '', sections: cleanSections(c.curativeSections) }];
  } else {
    c.curativeBlocks = c.curativeBlocks.map((b) => ({ heading: b.heading || '', sections: cleanSections(b.sections) }));
  }
  delete c.curativeHeading;
  delete c.curativeSections;
  return c;
}

const SPECIFIC_SECTIONS = new Set([SECTION_ORDER[0], SECTION_ORDER[4]]);

function dedupeKey(defect: string): string {
  return (defect || '')
    .replace(/^\s*((specific|general|non-action|non action)[^:\n]*item\s*\d+\s*:|\d+\.)\s*/i, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
}

/**
 * Merge the two curative passes: the "specific" pass owns SPECIFIC + BRINGDOWN items, the "other" pass owns
 * GENERAL / NON-ACTION / COMMENTS. Anything a pass returned outside its scope is dropped, then exact repeats removed.
 */
export function mergeCurative(specific: CuratorItemExtract[], other: CuratorItemExtract[]): CuratorItemExtract[] {
  const a = (specific || []).filter((i) => SPECIFIC_SECTIONS.has(normSection(i.section)));
  const b = (other || []).filter((i) => !SPECIFIC_SECTIONS.has(normSection(i.section)));
  const seen = new Set<string>();
  const out: CuratorItemExtract[] = [];
  for (const it of [...a, ...b]) {
    const k = normSection(it.section) + '|' + dedupeKey(it.defect);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/** Remove repeated items (same section + same text), keeping the first. */
export function dedupeCurative(items: CuratorItemExtract[]): CuratorItemExtract[] {
  const seen = new Set<string>();
  return (items || []).filter((it) => {
    const k = normSection(it.section) + '|' + dedupeKey(it.defect);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function todayMDY(): string {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function buildCurativeSections(items: CuratorItemExtract[]): CurativeSection[] {
  const map = new Map<string, CurativeSection>();
  for (const it of items) {
    const title = normSection(it.section);
    if (!map.has(title)) map.set(title, { title, items: [] });
    // collapse blank lines the AI sometimes leaves inside an item (e.g. right after the label)
    const defect = (it.defect || '').replace(/\n[ \t]*\n+/g, '\n').trim();
    map.get(title)!.items.push({ defect, recommendation: it.recommendation });
  }
  return [...map.values()].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a.title);
    const ib = SECTION_ORDER.indexOf(b.title);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function openActions(items: CuratorItemExtract[], team: string): string[] {
  return items
    .filter((i) => (i.status || '').toLowerCase() === 'open' && (i.team || '').toLowerCase() === team)
    .map((i) => i.action || i.recommendation)
    // the same cloud raised by several opinions → one row
    .filter((v, idx, arr) => arr.findIndex((x) => x.toLowerCase().replace(/[^a-z0-9]/g, '') === v.toLowerCase().replace(/[^a-z0-9]/g, '')) === idx);
}

function splitTracts(s: string): string[] {
  return (s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

const digits = (v: string) => (v || '').replace(/\D/g, '');

/** The lease QLS # — never the title opinion's QLS number. */
function leaseQls(titleQls: string, ...candidates: (string | undefined)[]): string {
  const t = digits(titleQls);
  for (const c of candidates) {
    const v = (c || '').trim();
    if (!v) continue;
    const d = digits(v);
    if (t && d && (d === t || d.startsWith(t) || t.startsWith(d))) continue;
    return v;
  }
  return '';
}

/** Normalised API number for de-duplication: "37-005-20051" / "005-20051" / "3700520051" → "00520051". */
function apiKey(api: string): string {
  let d = digits(api);
  if (d.length >= 10 && d.startsWith('37')) d = d.slice(2);
  if (d.length > 8) d = d.slice(0, 8);
  return d;
}

/** Merge well rows that share an API number, keeping the most complete value in each column. */
export function dedupeWells(rows: string[][]): string[][] {
  const out: string[][] = [];
  const byKey = new Map<string, string[]>();
  for (const r of rows) {
    const row = Array.from({ length: 7 }, (_, i) => (r[i] ?? '').toString().trim());
    if (!row.some(Boolean)) continue;
    const k = apiKey(row[0]);
    const prev = k ? byKey.get(k) : undefined;
    if (!prev) { out.push(row); if (k) byKey.set(k, row); continue; }
    for (let i = 0; i < 7; i++) {
      const a = prev[i];
      const b = row[i];
      if (!a || /^n\/a$/i.test(a)) prev[i] = b || a;
      else if (b && b !== a && i === 6 && !a.includes(b)) prev[i] = `${a}; ${b}`;
    }
  }
  return out;
}

/** Normalised book/page (or instrument) key for outsale de-duplication. */
function bookPageKey(v: string): string {
  const nums = (v || '').match(/\d+/g) || [];
  return nums.length >= 2 ? `${nums[nums.length - 2]}/${nums[nums.length - 1]}` : nums.join('');
}

export function dedupeOutsales(rows: string[][]): string[][] {
  const out: string[][] = [];
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    const row = Array.from({ length: 6 }, (_, i) => (r[i] ?? '').toString().trim());
    if (!row.some(Boolean) || row.every((v) => !v || /^n\/a$/i.test(v))) continue;
    const k = bookPageKey(row[0]);
    const prev = k ? seen.get(k) : undefined;
    if (!prev) { out.push(row); if (k) seen.set(k, row); continue; }
    for (let i = 0; i < 6; i++) if (!prev[i] && row[i]) prev[i] = row[i];
  }
  return out;
}

export interface CurativeByOpinion {
  heading: string;                 // "6/25/2026 Bowles Rice - "
  items: CuratorItemExtract[];
}

export interface AssembleInput {
  form: FormInfo;
  core: CoreExtract;
  /** one entry per title opinion, oldest → newest */
  curativeByOpinion?: CurativeByOpinion[];
  /** @deprecated single-opinion form */
  curativeItems?: CuratorItemExtract[];
  curativeHeading?: string;
  miscNotes?: string;
  ownership: OwnershipExtract;
  leases: LeaseInfo[];
  wells?: string[][];                                  // from the wells pass
  tmcAcreage?: { total: string; parts: string[] } | null; // parsed from the TMC page 1
}

function miscText(v: string | undefined): string {
  const t = (v || '').trim();
  if (!t || /^(none|none of record\.?|n\/a)$/i.test(t)) return '';
  return t;
}

function cleanItems(raw: CuratorItemExtract[]): CuratorItemExtract[] {
  // CNX convention: general and non-action items are simply "Advisory" unless work is still open
  return dedupeCurative(splitNumberedItems(raw || [])).map((it) => {
    const sec = normSection(it.section);
    if ((sec === SECTION_ORDER[1] || sec === SECTION_ORDER[2]) && (it.status || '').toLowerCase() !== 'open') {
      return { ...it, recommendation: 'Advisory', status: 'advisory' };
    }
    return it;
  });
}

export function assemble(input: AssembleInput): { car: CarData; pad: PadData } {
  const { core } = input;
  const { ownership, leases } = normalizeOwnership(input.ownership, input.leases || []);
  const form: FormInfo = {
    ...input.form,
    reviewDate: /^\d{1,2}\/\d{1,2}\/\d{4}$/.test((input.form.reviewDate || '').trim()) ? input.form.reviewDate.trim() : todayMDY(),
  };
  const byOpinion: CurativeByOpinion[] = (input.curativeByOpinion && input.curativeByOpinion.length
    ? input.curativeByOpinion
    : [{ heading: input.curativeHeading ?? '', items: input.curativeItems || [] }]
  ).map((b) => ({ heading: b.heading, items: cleanItems(b.items) }));
  const items = byOpinion.flatMap((b) => b.items);

  // FINAL resolved acreage: the TMC's page-1 "Resolved Mapping Acreage" line wins over the AI
  const tmcTotal = input.tmcAcreage?.total || '';
  const acresResolved = tmcTotal || core.acres_resolved || '';
  const tmcParts = input.tmcAcreage?.parts || [];
  const parcels = (ownership.parcels?.length ? ownership.parcels : [{ label: 'Parcel One', tmp: (core.tmps || []).join(', '), deeded_acres: core.acres_title, resolved_acres: '' }])
    .map((p, i, all) => {
      if ((p.resolved_acres || '').trim()) return p;
      const num = (v: string) => ((v || '').replace(/,/g, '').match(/\d*\.?\d+/) || [''])[0];
      if (all.length === 1) return { ...p, resolved_acres: num(acresResolved) };
      if (tmcParts.length === all.length) return { ...p, resolved_acres: tmcParts[i] };
      return p;
    });
  const titleQls = core.qls || '';
  const multi = parcels.length > 1;
  const tractNos = splitTracts(form.tractNumbers);
  const bdDate = core.bringdown?.date || '';
  const certDate = bdDate || core.cert_end || '';

  // ---------- CAR owner tables ----------
  const carParcels = parcels.map((p, pi) => {
    const owners = (ownership.owners || []).filter((o) => (o.parcel_index ?? 0) === pi);
    const rowsOut: CarOwnerRow[] = owners.map((o) => {
      const lease = o.lease_index !== null && o.lease_index !== undefined ? leases[o.lease_index] : undefined;
      if (!lease) {
        return {
          owner: o.owner_name, execRights: decimalString(o.exec_fraction), royaltyOwnership: decimalString(o.royalty_fraction),
          controlType: 'Open', agreementQls: 'Open', recording: 'Open', royalty: 'Open', poolingLimit: 'Open',
          pugh: 'Open', expiration: 'Open', heldBy: 'Open', formations: 'Open',
        };
      }
      return {
        owner: o.owner_name,
        execRights: decimalString(o.exec_fraction),
        royaltyOwnership: decimalString(o.royalty_fraction),
        controlType: 'Lease',
        agreementQls: leaseQls(titleQls, o.qls_agreement, lease.agreement_number, lease.agreement_number_alt),
        recording: (lease.recording || '').replace(/^\s*(instr(ument)?\.?\s*(no\.?|number)?\s*#?\s*)/i, ''),
        royalty: royaltyDisplay(lease.royalty_rate, lease.gross_royalty),
        poolingLimit: poolingDisplay(lease.pooling_limitation),
        pugh: pughDisplay(lease.pugh),
        expiration: lease.primary_term_expiration || lease.final_extension_expiration || '',
        heldBy: heldByDisplay(o.lease_status),
        formations: lease.formations || '',
      };
    });
    const label = multi ? `As to Parcel ${ORDINALS[pi] || pi + 1} (${p.tmp})` : '';
    return { label, owners: rowsOut };
  });

  const land = openActions(items, 'land');
  const mapping = openActions(items, 'mapping');
  const title = openActions(items, 'title');
  const dor = openActions(items, 'division_order');
  const third = openActions(items, 'third_party');

  const opList = core.opinions && core.opinions.length
    ? core.opinions
    : [{ law_firm: core.law_firm, cert_start: core.cert_start, cert_end: core.cert_end, opinion_date: core.opinion_date }];
  const opinions = opList.map((o) => ({
    lawFirm: o.law_firm || '',
    certRange: o.cert_start || o.cert_end ? `${o.cert_start} to ${o.cert_end}` : '',
    opinionDate: o.opinion_date || '',
  }));
  if (core.bringdown && (core.bringdown.date || core.bringdown.cert_end)) {
    opinions.push({
      lawFirm: 'Internal Bringdown',
      certRange: `${core.bringdown.cert_start || core.cert_end} to ${core.bringdown.cert_end || core.bringdown.date}`,
      opinionDate: core.bringdown.date || core.bringdown.cert_end,
    });
  }

  const car: CarData = {
    qls: core.qls || '',
    tmp: (core.tmps || []).join(', '),
    twpCountyState: [core.township, core.county, core.state].filter(Boolean).join(' / '),
    opinions,
    estates: core.estates || '',
    acresTitle: core.acres_title || '',
    acresResolved,
    curativeSummary: {
      land: numbered(land),
      mapping: numbered(mapping),
      title: numbered(title),
      divisionOrder: numbered(dor),
    },
    tractDescription: core.tract_description || '',
    wiTables: wiFromLeases(core.wi_tables, ownership, leases),
    parcels: carParcels,
    amendments: toRows(core.amendments),
    assignments: toRows(core.assignments),
    orri: toRows(core.orri),
    units: toRows(core.units),
    wellDateChecked: core.well_date_checked || form.reviewDate || '',
    leaseWideGaps: core.lease_wide_gaps || 'N/A',
    wells: dedupeWells([...toRows(input.wells), ...toRows(core.wells)]),
    outsales: dedupeOutsales(toRows(core.outsales)),
    liens: toRows(core.liens),
    taxFullyAssessed: core.tax_fully_assessed || '',
    taxDelinquent: core.tax_delinquent || 'N/A',
    unassessed: toRows(core.unassessed),
    delinquent: toRows(core.delinquent),
    contracts: {
      agreementNumber: core.contracts?.agreement_number || 'N/A',
      name: core.contracts?.name || '',
      stillValid: core.contracts?.still_valid || '',
      wellsDrilled: core.contracts?.wells_drilled || '',
      restrictions: core.contracts?.restrictions || '',
    },
    curativeBlocks: byOpinion.map((b, i): CurativeBlock => ({
      heading: b.heading || (i === byOpinion.length - 1 && (core.opinion_date || core.law_firm) ? `${core.opinion_date} ${core.law_firm} - `.trimStart() : ''),
      sections: buildCurativeSections(b.items),
    })),
    miscNotes: miscText(core.misc_notes) || miscText(input.miscNotes) || 'None',
    analysisDate: form.reviewDate || '',
    analyst: form.analyst || '',
  };

  // ---------- Pad Summary: Title-Curative ----------
  const tc: TitleCurativeRow = {
    tract: tractNos.join(', '),
    tmp: car.tmp,
    qls: car.qls,
    opinionDate: core.opinion_date || '',
    certDate: bdDate ? `${bdDate} (BD)` : certDate,
    additionalProduct: core.additional_product_needed || 'No',
    additionalOrdered: 'N/A',
    heirship: core.heirship || 'No',
    heirshipName: core.heirship_name || 'N/A',
    land: numbered(land),
    thirdParty: numbered(third),
    mapping: numbered(mapping),
    title: numbered(title),
    analystReview: [form.analystInitials, form.reviewDate].filter(Boolean).join('\n'),
    analystUpdate: '',
    initialReview: '',
    finalReview: '',
    notes: dor.length ? `DIVISION ORDER RECOMMENDATIONS\n${numbered(dor)}` : 'None',
  };

  // ---------- Pad Summary: Ownership ----------
  const padRows = buildPadOwnershipRows({
    parcels, owners: ownership.owners || [], leases, tractNos, qls: car.qls, certDate, titleNotes: ownership.title_notes,
  });

  return {
    car,
    pad: {
      unit: { unitName: form.unitName, twpCountyState: form.unitTwpCountyState, totalAcres: form.totalUnitAcres },
      titleCurative: [tc],
      ownership: padRows,
    },
  };
}

// ===========================================================================
// Shared Pad Summary Ownership-row builder (used by both "New CAR" and "Pad Summary from existing CAR")
// ===========================================================================
export function buildPadOwnershipRows(args: {
  parcels: OwnershipExtract['parcels'];
  owners: OwnershipExtract['owners'];
  leases: LeaseInfo[];
  tractNos: string[];
  qls: string;
  certDate: string;
  titleNotes: string;
}): PadOwnershipRow[] {
  const { parcels, owners, leases, tractNos, qls, certDate, titleNotes } = args;
  const padRows: PadOwnershipRow[] = [];
  parcels.forEach((p, pi) => {
    for (const o of owners.filter((x) => (x.parcel_index ?? 0) === pi)) {
      const lease = o.lease_index !== null && o.lease_index !== undefined ? leases[o.lease_index] : undefined;
      const r: PadOwnershipRow = {
        A: tractNos[pi] || '',
        B: p.tmp || '',
        C: qls,
        I: o.owner_name || '',
        J: o.address || '',
        AE: p.tmp || '',
        AF: p.deeded_acres || '',
        AG: p.resolved_acres || '',
        AI: o.exec_fraction ? `=${o.exec_fraction.replace(/^=/, '')}` : '',
        AL: 'RI',
        AN: o.royalty_fraction ? `=${o.royalty_fraction.replace(/^=/, '')}` : '',
        BJ: certDate,
        BN: [o.notes, titleNotes].filter(Boolean).join('\n\n') || 'None',
      };
      if (!lease) {
        for (const c of ['D', 'E', 'F', 'G', 'H', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
          'AA', 'AB', 'AC', 'AD', 'AZ', 'BA', 'BB', 'BC', 'BF', 'BG', 'BI']) r[c] = 'OPEN';
        r.Y = 'No';
      } else {
        const rate = fractionToDecimal(lease.royalty_rate);
        Object.assign(r, {
          D: lease.lessee || '',
          E: o.lease_status || 'Primary Term',
          F: leaseQls(qls, o.qls_agreement, lease.agreement_number, lease.agreement_number_alt),
          G: lease.lessors || '',
          H: lease.lessee || '',
          M: lease.effective_date || '',
          N: lease.recording || '',
          O: lease.primary_term_expiration || '',
          P: 'No',
          Q: lease.extension_type || '',
          R: lease.earliest_extension_expiration || 'N/A',
          S: lease.final_extension_expiration || 'N/A',
          T: 'N/A', U: 'N/A', V: 'N/A',
          W: lease.formations || '',
          X: lease.formations || '',
          Y: 'No',
          AA: lease.pooling_limitation || '',
          AB: lease.pugh || '',
          AC: lease.cross_unit_prohibited || '',
          AD: lease.gross_acres || '',
          AE: lease.tmps_covered || p.tmp || '',
          AM: rate === null ? '' : String(rate > 1 ? rate / 100 : rate),
          AZ: lease.gross_royalty || '',
          BA: lease.deduct_language || '',
          BB: lease.market_enhancement || '',
          BC: lease.min_pay || '',
          BF: lease.recoupment_allowed || '',
          BG: lease.mwm || '',
          BI: lease.apportionment || '',
        });
      }
      padRows.push(r);
    }
  });
  return padRows;
}

// ===========================================================================
// "Pad Summary from an existing CAR"
// ===========================================================================

/** "0.5" -> "1/2", "1.0" -> "1", "0.04545455" -> "1/22". Leaves fractions and text alone. */
export function decimalToFraction(v: string): string {
  const s = (v || '').trim().replace(/^=/, '');
  if (!s || /\//.test(s)) return s;
  const x = parseFloat(s);
  if (isNaN(x) || !/^\d*\.?\d+$/.test(s)) return s;
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  // continued fractions, denominators up to 1,000,000
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = x;
  for (let i = 0; i < 25; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0; const k2 = a * k1 + k0;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (k1 > 1e6) break;
    if (Math.abs(x - h1 / k1) < 5e-8) return `${h1}/${k1}`;
    b = 1 / (b - a);
    if (!isFinite(b)) break;
  }
  return s;
}

function acresNumber(s: string): string {
  const m = (s || '').replace(/,/g, '').match(/\d*\.?\d+/);
  return m ? m[0] : '';
}

const isOpen = (v: string) => !v || /^open$/i.test(v.trim());

/** Owners per parcel straight from the CAR's Leasehold Control and Ownership tables. */
export function ownershipFromCar(car: CarData): { ownership: OwnershipExtract; carLeases: LeaseInfo[] } {
  const ps = car.parcels || [];
  const single = ps.length <= 1;
  const carLeases: LeaseInfo[] = [];
  const wiOwner = (car.wiTables || []).flatMap((w) => w.rows).map((r) => r.owner).find((o) => !isOpen(o)) || '';
  const parcels = ps.map((p, i) => {
    const m = (p.label || '').match(/\(([^)]+)\)/);
    return {
      label: `Parcel ${i + 1}`,
      tmp: m ? m[1].trim() : (single ? car.tmp : ''),
      deeded_acres: single ? acresNumber(car.acresTitle) : '',
      resolved_acres: single ? acresNumber(car.acresResolved) : '',
    };
  });
  const owners: OwnershipExtract['owners'] = [];
  ps.forEach((p, pi) => {
    for (const o of p.owners || []) {
      let leaseIndex: number | null = null;
      if (!isOpen(o.controlType) || !isOpen(o.recording)) {
        // carry the lease terms that are on the CAR so leased owners aren't marked OPEN
        carLeases.push({
          source_file: 'CAR', lessors: o.owner, lessee: wiOwner, agreement_number: isOpen(o.agreementQls) ? '' : o.agreementQls,
          effective_date: '', recording: isOpen(o.recording) ? '' : o.recording, recorded_date: '', primary_term: '',
          primary_term_expiration: '', extension_type: '', extension_terms: '', earliest_extension_expiration: '',
          final_extension_expiration: isOpen(o.expiration) ? '' : o.expiration, formations: isOpen(o.formations) ? '' : o.formations,
          pooling_limitation: isOpen(o.poolingLimit) ? '' : o.poolingLimit, pugh: isOpen(o.pugh) ? '' : o.pugh,
          cross_unit_prohibited: '', gross_acres: '', tmps_covered: parcels[pi]?.tmp || '', royalty_rate: isOpen(o.royalty) ? '' : o.royalty,
          gross_royalty: '', deduct_language: '', market_enhancement: '', min_pay: '', recoupment_allowed: '', mwm: '',
          apportionment: '', notes_for_reviewer: '',
        });
        leaseIndex = -carLeases.length; // placeholder, resolved in padFromCar
      }
      owners.push({
        parcel_index: pi, tmp: parcels[pi]?.tmp || '', owner_name: o.owner, address: '',
        exec_fraction: decimalToFraction(o.execRights), royalty_fraction: decimalToFraction(o.royaltyOwnership),
        vesting: '', lease_index: leaseIndex, lease_status: isOpen(o.heldBy) ? (leaseIndex === null ? 'Open' : 'Primary Term') : o.heldBy,
        qls_agreement: isOpen(o.agreementQls) ? '' : o.agreementQls, notes: '',
      });
    }
  });
  return { ownership: { parcels, owners, title_notes: '' }, carLeases };
}

function nameTokens(s: string): string[] {
  return (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 2 && !['and', 'the', 'his', 'her', 'wife', 'husband', 'jtwros', 'tbe', 'aka', 'fka', 'single', 'married', 'widow', 'estate', 'trust', 'llc', 'inc'].includes(t));
}

/** Pick the uploaded lease whose lessor names and recording best match this owner/parcel. */
export function matchLease(owner: { owner_name: string; tmp: string }, recording: string, leases: LeaseInfo[]): number | null {
  let best = -1;
  let bestScore = 0;
  const ot = nameTokens(owner.owner_name);
  leases.forEach((l, i) => {
    // a lease that lists its parcels must cover this owner's parcel
    if (owner.tmp && l.tmps_covered && l.tmps_covered.trim() && !l.tmps_covered.includes(owner.tmp)) return;
    let score = 0;
    if (recording && l.recording && recording.replace(/\s/g, '') === l.recording.replace(/\s/g, '')) score += 5;
    const lt = new Set(nameTokens(l.lessors));
    const hits = ot.filter((t) => lt.has(t)).length;
    if (hits) score += hits;
    if (owner.tmp && l.tmps_covered && l.tmps_covered.includes(owner.tmp)) score += 1;
    if (score > bestScore && (hits >= 1 || score >= 5)) { best = i; bestScore = score; }
  });
  return best >= 0 && bestScore >= 2 ? best : null;
}

/**
 * Build the Pad Summary from a parsed CAR.
 * `aiOwnership` (from the title opinion, optional) supplies addresses, per-parcel acres and lease matches.
 */
export function padFromCar(
  car: CarData, formIn: FormInfo, leases: LeaseInfo[], aiOwnership?: OwnershipExtract | null,
  tmcAcreage?: { total: string; parts: string[] } | null,
): PadData {
  const form = { ...formIn };
  const tractNos = splitTracts(form.tractNumbers);
  const ops = car.opinions || [];
  const bd = ops.find((o) => /bring\s*down/i.test(o.lawFirm));
  const titleOps = ops.filter((o) => !/bring\s*down/i.test(o.lawFirm));
  const opinion = titleOps[titleOps.length - 1] || ops[0];   // newest title opinion (CAR lists oldest → newest)
  const certEnd = (opinion?.certRange || '').split(/\s+to\s+/i)[1] || '';
  const bdDate = bd?.opinionDate || ((bd?.certRange || '').split(/\s+to\s+/i)[1] || '');
  const certDate = bdDate || certEnd;

  let ownership: OwnershipExtract;
  let allLeases: LeaseInfo[] = [...leases];
  if (aiOwnership && aiOwnership.owners?.length) {
    const n = normalizeOwnership(aiOwnership, leases);
    ownership = n.ownership;
    allLeases = n.leases;
  } else {
    const fromCar = ownershipFromCar(car);
    ownership = fromCar.ownership;
    const base = allLeases.length;
    allLeases = [...allLeases, ...fromCar.carLeases];
    const carRows = (car.parcels || []).flatMap((p) => p.owners || []);
    ownership.owners = ownership.owners.map((o, i) => {
      const rec = carRows[i]?.recording && !isOpen(carRows[i].recording) ? carRows[i].recording : '';
      const uploaded = matchLease({ owner_name: o.owner_name, tmp: o.tmp }, rec, leases);
      if (uploaded !== null) return { ...o, lease_index: uploaded, lease_status: o.lease_status === 'Open' ? 'Primary Term' : o.lease_status };
      if (o.lease_index !== null && o.lease_index < 0) return { ...o, lease_index: base + (-o.lease_index - 1) };
      return o;
    });
  }

  // resolved acres per parcel: TMC page 1 → CAR "FINAL Resolved Acreage"
  {
    const num = (v: string) => ((v || '').replace(/,/g, '').match(/\d*\.?\d+/) || [''])[0];
    const total = num(tmcAcreage?.total || '') || num(car.acresResolved);
    const parts = tmcAcreage?.parts || [];
    ownership = {
      ...ownership,
      parcels: ownership.parcels.map((p, i, all) => {
        if ((p.resolved_acres || '').trim()) return p;
        if (all.length === 1) return { ...p, resolved_acres: total };
        if (parts.length === all.length) return { ...p, resolved_acres: parts[i] };
        return p;
      }),
    };
  }

  const sum = car.curativeSummary || { land: '', mapping: '', title: '', divisionOrder: '' };
  const none = (v: string) => (v || '').trim() || 'None';
  const heir = /heir/i.test(`${sum.land} ${sum.title}`);
  const tc: TitleCurativeRow = {
    tract: tractNos.join(', '),
    tmp: car.tmp,
    qls: car.qls,
    opinionDate: opinion?.opinionDate || '',
    certDate: bdDate ? `${bdDate} (BD)` : certEnd,
    additionalProduct: 'No',
    additionalOrdered: 'N/A',
    heirship: heir ? 'Yes' : 'No',
    heirshipName: 'N/A',
    land: none(sum.land),
    thirdParty: 'None',
    mapping: none(sum.mapping),
    title: none(sum.title),
    analystReview: [form.analystInitials, form.reviewDate || car.analysisDate].filter(Boolean).join('\n'),
    analystUpdate: '',
    initialReview: '',
    finalReview: '',
    notes: none(sum.divisionOrder) === 'None' ? 'None' : `DIVISION ORDER RECOMMENDATIONS\n${sum.divisionOrder}`,
  };

  return {
    unit: { unitName: form.unitName, twpCountyState: form.unitTwpCountyState, totalAcres: form.totalUnitAcres },
    titleCurative: [tc],
    ownership: buildPadOwnershipRows({
      parcels: ownership.parcels, owners: ownership.owners, leases: allLeases, tractNos, qls: car.qls, certDate,
      titleNotes: ownership.title_notes || '',
    }),
  };
}

/** If every owner is leased to the same lessee but the WI table still says "Open", fill it from the lease. */
function wiFromLeases(wi: CoreExtract['wi_tables'], own: OwnershipExtract, leases: LeaseInfo[]): CarData['wiTables'] {
  const tables = wi?.length ? wi : [{ formation: 'All formations', rows: [{ owner: 'Open', wi: '1.0', nri: 'Open', orri: 'Open' }] }];
  const allOpen = tables.every((t) => t.rows.every((r) => /^open$/i.test((r.owner || '').trim())));
  const owners = own.owners || [];
  if (!allOpen || !owners.length) return tables;
  const ls = owners.map((o) => (o.lease_index !== null && o.lease_index !== undefined ? leases[o.lease_index] : undefined));
  if (ls.some((l) => !l)) return tables;
  const lessees = new Set(ls.map((l) => (l!.lessee || '').trim()).filter(Boolean));
  if (lessees.size !== 1) return tables;
  const rates = new Set(ls.map((l) => fractionToDecimal(l!.royalty_rate)));
  const rate = rates.size === 1 ? [...rates][0] : null;
  const nri = rate === null ? '' : String(parseFloat((1 - (rate > 1 ? rate / 100 : rate)).toFixed(6)));
  return [{ formation: tables[0].formation || 'All formations', rows: [{ owner: [...lessees][0], wi: '1.0', nri, orri: 'No' }] }];
}

/**
 * Non-action items are numbered "1.", "2.", ... in the opinion and each gets its own CAR row.
 * If the AI returned several of them in one item, split them back apart.
 */
export function splitNumberedItems(items: CuratorItemExtract[]): CuratorItemExtract[] {
  const out: CuratorItemExtract[] = [];
  for (const it of items) {
    if (normSection(it.section) !== SECTION_ORDER[2]) { out.push(it); continue; }
    const lines = (it.defect || '').split('\n');
    const starts: number[] = [];
    let expect = 1;
    lines.forEach((l, i) => {
      const m = l.trim().match(/^(\d+)\.\s/);
      if (m && parseInt(m[1], 10) === expect) { starts.push(i); expect++; }
    });
    if (starts.length < 2 || starts[0] !== 0) { out.push(it); continue; }
    starts.forEach((st, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
      out.push({ ...it, defect: lines.slice(st, end).join('\n').trim() });
    });
  }
  return out;
}
