// Turns the AI extraction results into the two editable deliverables:
//   CarData  -> the Word Curative Action Report
//   PadData  -> the Pad Summary Ownership + Title-Curative rows
// Pure functions — runs in the browser so the review screen can rebuild instantly.

import type {
  CarData, PadData, CoreExtract, CurativeExtract, OwnershipExtract, LeaseInfo, FormInfo,
  CurativeSection, CarOwnerRow, PadOwnershipRow, TitleCurativeRow, CuratorItemExtract,
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

function royaltyDisplay(rate: string): string {
  const d = fractionToDecimal(rate);
  if (d === null) return rate || '';
  const pct = d <= 1 ? d * 100 : d;
  return `${parseFloat(pct.toFixed(4))}%`;
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

export function buildCurativeSections(items: CuratorItemExtract[]): CurativeSection[] {
  const map = new Map<string, CurativeSection>();
  for (const it of items) {
    const title = normSection(it.section);
    if (!map.has(title)) map.set(title, { title, items: [] });
    map.get(title)!.items.push({ defect: it.defect, recommendation: it.recommendation });
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
    .map((i) => i.action || i.recommendation);
}

function splitTracts(s: string): string[] {
  return (s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

export interface AssembleInput {
  form: FormInfo;
  core: CoreExtract;
  curativeItems: CuratorItemExtract[];
  curativeHeading?: string;
  miscNotes?: string;
  ownership: OwnershipExtract;
  leases: LeaseInfo[];
}

export function assemble(input: AssembleInput): { car: CarData; pad: PadData } {
  const { form, core, ownership, leases } = input;
  const items = input.curativeItems || [];
  const parcels = ownership.parcels?.length ? ownership.parcels : [{ label: 'Parcel One', tmp: (core.tmps || []).join(', '), deeded_acres: core.acres_title, resolved_acres: core.acres_resolved }];
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
        agreementQls: o.qls_agreement || lease.agreement_number || '',
        recording: lease.recording || '',
        royalty: royaltyDisplay(lease.royalty_rate),
        poolingLimit: lease.pooling_limitation || '',
        pugh: lease.pugh || '',
        expiration: lease.final_extension_expiration || lease.primary_term_expiration || '',
        heldBy: o.lease_status || 'Primary Term',
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

  const opinions = [{
    lawFirm: core.law_firm || '',
    certRange: core.cert_start || core.cert_end ? `${core.cert_start} to ${core.cert_end}` : '',
    opinionDate: core.opinion_date || '',
  }];
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
    acresResolved: core.acres_resolved || '',
    curativeSummary: {
      land: numbered(land),
      mapping: numbered(mapping),
      title: numbered(title),
      divisionOrder: numbered(dor),
    },
    tractDescription: core.tract_description || '',
    wiTables: core.wi_tables?.length ? core.wi_tables : [{ formation: 'All formations', rows: [{ owner: 'Open', wi: '1.0', nri: 'Open', orri: 'Open' }] }],
    parcels: carParcels,
    amendments: core.amendments || [],
    assignments: core.assignments || [],
    orri: core.orri || [],
    units: core.units || [],
    wellDateChecked: core.well_date_checked || form.reviewDate || '',
    leaseWideGaps: core.lease_wide_gaps || 'N/A',
    wells: core.wells || [],
    outsales: core.outsales || [],
    liens: core.liens || [],
    taxFullyAssessed: core.tax_fully_assessed || '',
    taxDelinquent: core.tax_delinquent || 'N/A',
    unassessed: core.unassessed || [],
    delinquent: core.delinquent || [],
    contracts: {
      agreementNumber: core.contracts?.agreement_number || 'N/A',
      name: core.contracts?.name || '',
      stillValid: core.contracts?.still_valid || '',
      wellsDrilled: core.contracts?.wells_drilled || '',
      restrictions: core.contracts?.restrictions || '',
    },
    curativeHeading: input.curativeHeading ?? (core.opinion_date || core.law_firm ? `${core.opinion_date} ${core.law_firm} - `.trimStart() : ''),
    curativeSections: buildCurativeSections(items),
    miscNotes: input.miscNotes || 'None',
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
  const padRows: PadOwnershipRow[] = [];
  parcels.forEach((p, pi) => {
    const owners = (ownership.owners || []).filter((o) => (o.parcel_index ?? 0) === pi);
    for (const o of owners) {
      const lease = o.lease_index !== null && o.lease_index !== undefined ? leases[o.lease_index] : undefined;
      const r: PadOwnershipRow = {
        A: tractNos[pi] || '',
        B: p.tmp || '',
        C: car.qls,
        I: o.owner_name || '',
        J: o.address || '',
        AE: p.tmp || '',
        AF: p.deeded_acres || '',
        AG: p.resolved_acres || '',
        AI: o.exec_fraction ? `=${o.exec_fraction.replace(/^=/, '')}` : '',
        AL: 'RI',
        AN: o.royalty_fraction ? `=${o.royalty_fraction.replace(/^=/, '')}` : '',
        BJ: certDate,
        BN: [o.notes, ownership.title_notes].filter(Boolean).join('\n\n') || 'None',
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
          F: o.qls_agreement || lease.agreement_number || '',
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

  return {
    car,
    pad: {
      unit: { unitName: form.unitName, twpCountyState: form.unitTwpCountyState, totalAcres: form.totalUnitAcres },
      titleCurative: [tc],
      ownership: padRows,
    },
  };
}
