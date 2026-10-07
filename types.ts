// Shared data model for the CAR / Pad Summary generator.
// Everything the review screen edits lives in CarData (Word CAR) and PadData (Excel Pad Summary).

export type Row = string[];

export interface OpinionRow {
  lawFirm: string;      // "Bowles Rice" or "Internal Bringdown"
  certRange: string;    // "12/21/1846 to 5/14/2026"
  opinionDate: string;  // "6/25/2026"
}

export interface WiRow { owner: string; wi: string; nri: string; orri: string }
export interface WiTable { formation: string; rows: WiRow[] }

export interface CarOwnerRow {
  owner: string;
  execRights: string;
  royaltyOwnership: string;
  controlType: string;
  agreementQls: string;
  recording: string;
  royalty: string;
  poolingLimit: string;
  pugh: string;
  expiration: string;
  heldBy: string;
  formations: string;
}

export interface ParcelOwnership {
  label: string; // "As to Parcel One (240.06-01-11)" — blank when only one parcel
  owners: CarOwnerRow[];
}

export interface CurativeItem {
  defect: string;          // verbatim title defect text from the opinion
  recommendation: string;  // CNX Recommendation/Status
}

export interface CurativeSection {
  title: string; // "SPECIFIC CURATIVE ACTION ITEMS", "GENERAL CURATIVE ACTION ITEMS", ...
  items: CurativeItem[];
}

export interface CurativeBlock {
  heading: string;              // "6/25/2026 Bowles Rice - " (one block per title opinion, oldest first)
  sections: CurativeSection[];
}

export interface CarData {
  qls: string;
  tmp: string;
  twpCountyState: string;
  opinions: OpinionRow[];
  estates: string;
  acresTitle: string;
  acresResolved: string;

  curativeSummary: { land: string; mapping: string; title: string; divisionOrder: string };

  tractDescription: string;
  wiTables: WiTable[];
  parcels: ParcelOwnership[];

  amendments: Row[];   // 7 cols
  assignments: Row[];  // 10 cols
  orri: Row[];         // 5 cols

  units: Row[];        // 7 cols
  wellDateChecked: string;
  leaseWideGaps: string;
  wells: Row[];        // 7 cols: API, lease, lease acreage, unit, completion date, status, gaps/notes

  outsales: Row[];     // 6 cols
  liens: Row[];        // 6 cols
  taxFullyAssessed: string;
  taxDelinquent: string;
  unassessed: Row[];   // 4 cols
  delinquent: Row[];   // 4 cols
  contracts: { agreementNumber: string; name: string; stillValid: string; wellsDrilled: string; restrictions: string };

  curativeBlocks: CurativeBlock[];   // one "Title Defects and Analysis" table per title opinion, oldest → newest
  /** @deprecated kept so sessions saved before multi-opinion support still load */
  curativeHeading?: string;
  /** @deprecated */
  curativeSections?: CurativeSection[];
  miscNotes: string;

  analysisDate: string;
  analyst: string;
}

// ---------- Pad Summary ----------

export interface TitleCurativeRow {
  tract: string;
  tmp: string;
  qls: string;
  opinionDate: string;
  certDate: string;
  additionalProduct: string;
  additionalOrdered: string;
  heirship: string;
  heirshipName: string;
  land: string;
  thirdParty: string;
  mapping: string;
  title: string;
  analystReview: string;
  analystUpdate: string;
  initialReview: string;
  finalReview: string;
  notes: string;
}

// One row per owner per tract on the Ownership tab. Keys are the Pad Summary column letters.
export type PadOwnershipRow = Record<string, string>;

export interface PadUnitInfo {
  unitName: string;
  twpCountyState: string;
  totalAcres: string;
}

export interface PadData {
  unit: PadUnitInfo;
  titleCurative: TitleCurativeRow[];
  ownership: PadOwnershipRow[];
}

// ---------- AI extraction results ----------

export interface LeaseInfo {
  source_file: string;
  lessors: string;
  lessee: string;
  agreement_number: string;
  agreement_number_alt?: string;    // other number found (e.g. QLA # printed in the lease) — used if the first is the title QLS
  effective_date: string;
  recording: string;
  recorded_date: string;
  primary_term: string;
  primary_term_expiration: string;
  extension_type: string;           // Paid Up / Rental / None
  extension_terms: string;
  earliest_extension_expiration: string;
  final_extension_expiration: string;
  formations: string;
  pooling_limitation: string;
  pugh: string;
  cross_unit_prohibited: string;
  gross_acres: string;
  tmps_covered: string;
  royalty_rate: string;             // decimal, e.g. 0.15
  gross_royalty: string;            // Yes/No
  deduct_language: string;          // verbatim royalty / deduction clause
  market_enhancement: string;       // Yes/No
  min_pay: string;
  recoupment_allowed: string;       // Yes/No/Silent
  mwm: string;                      // Yes/No
  apportionment: string;            // Yes/No
  notes_for_reviewer: string;
}

export interface OwnerExtract {
  parcel_index: number;
  tmp: string;
  owner_name: string;
  address: string;
  exec_fraction: string;    // "1/2"
  royalty_fraction: string; // "1/2"
  vesting: string;
  lease_index: number | null; // index into the LeaseInfo list, null = unleased
  lease_status: string;     // Open / Primary Term / Extended Term / HBP
  qls_agreement: string;
  notes: string;
  record_lease_index?: number | null; // index into OwnershipExtract.record_leases (lease known only from the opinion/bringdown)
}

export interface RecordLease {
  lessors: string;
  lessee: string;
  effective_date: string;
  recording: string;
  agreement_number: string;
  primary_term_expiration: string;
  royalty_rate: string;
  formations: string;
}

export interface ParcelExtract {
  label: string;        // "Parcel One"
  tmp: string;
  deeded_acres: string;
  resolved_acres: string;
}

export interface OwnershipExtract {
  parcels: ParcelExtract[];
  owners: OwnerExtract[];
  title_notes: string;
  record_leases?: RecordLease[];
  bringdown_changes?: string;   // ownership changes applied from the internal bringdown (shown to the reviewer)
}

export interface CuratorItemExtract {
  section: string;
  defect: string;
  recommendation: string;
  status: string;       // open | satisfied | advisory | waived
  team: string;         // land | mapping | title | division_order | third_party | none
  action: string;       // short action wording for the Curative Summary / Pad Summary
}

export interface CurativeExtract {
  heading: string;
  items: CuratorItemExtract[];
  misc_notes?: string;
}

export interface OpinionExtract {
  law_firm: string;
  cert_start: string;
  cert_end: string;
  opinion_date: string;
}

export interface CoreExtract {
  opinions?: OpinionExtract[];  // every title opinion, oldest → newest (single-opinion fields below = newest)
  misc_notes?: string;          // Miscellaneous section of the opinion(s), "None" if empty
  qls: string;
  tmps: string[];
  township: string;
  county: string;
  state: string;
  law_firm: string;
  cert_start: string;
  cert_end: string;
  opinion_date: string;
  bringdown: { cert_start: string; cert_end: string; date: string } | null;
  estates: string;
  acres_title: string;
  acres_resolved: string;
  tract_description: string;
  wi_tables: WiTable[];
  amendments: Row[];
  assignments: Row[];
  orri: Row[];
  units: Row[];
  wells: Row[];
  well_date_checked: string;
  lease_wide_gaps: string;
  outsales: Row[];
  liens: Row[];
  tax_fully_assessed: string;
  tax_delinquent: string;
  unassessed: Row[];
  delinquent: Row[];
  contracts: { agreement_number: string; name: string; still_valid: string; wells_drilled: string; restrictions: string };
  heirship: string;
  heirship_name: string;
  additional_product_needed: string;
  notes_for_reviewer: string;
}

export interface FormInfo {
  analyst: string;
  analystInitials: string;
  reviewDate: string;
  tractNumbers: string;   // comma separated, one per parcel in order, e.g. "35A, 35B"
  unitName: string;
  unitTwpCountyState: string;
  totalUnitAcres: string;
}
