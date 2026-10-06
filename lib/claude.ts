import Anthropic from '@anthropic-ai/sdk';
import type {
  CoreExtract, CurativeExtract, LeaseInfo, OwnershipExtract,
} from './types';

// Model can be changed in Vercel without a code change (Settings → Environment Variables → CLAUDE_MODEL).
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY env var.');
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

const SYSTEM = `You are a senior oil and gas title analyst at BOP Abstract preparing CNX Curative Action Reports (CARs) and Pad Summaries.
You read attorney title opinions, Title Mapping Curative (TMC) survey documents, internal bringdowns, abstracts of title and oil and gas leases.
Accuracy matters more than completeness: never invent facts, instrument numbers, dates or fractions. If something is not in the documents, use an empty string.
Dates are always M/D/YYYY (e.g. 6/25/2026). Return ONLY valid JSON — no markdown, no code fences, no commentary.`;

function extractJson(text: string): unknown {
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = Math.min(...['{', '['].map((c) => clean.indexOf(c)).filter((i) => i >= 0));
    const end = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error('Claude did not return valid JSON');
  }
}

async function runJson<T>(prompt: string, maxTokens: number): Promise<T> {
  const client = getClient();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: maxTokens,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      });
      const msg = await stream.finalMessage();
      const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      if (msg.stop_reason === 'max_tokens') {
        throw new Error('Response was cut off (document too large for one pass). Try again or raise CLAUDE_MAX_TOKENS.');
      }
      return extractJson(text) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const MAX = parseInt(process.env.CLAUDE_MAX_TOKENS || '32000', 10);

function block(name: string, text: string | undefined): string {
  if (!text || !text.trim()) return `<${name}>\n(not provided)\n</${name}>`;
  return `<${name}>\n${text.trim()}\n</${name}>`;
}

export interface SourceTexts {
  opinion: string;
  tmc?: string;
  bringdown?: string;
  abstract?: string;
  leases?: LeaseInfo[];
  reviewDate?: string;
}

function leaseSummary(leases: LeaseInfo[] | undefined): string {
  if (!leases || !leases.length) return '(no lease documents were provided)';
  return JSON.stringify(leases.map((l, i) => ({
    lease_index: i,
    file: l.source_file,
    lessors: l.lessors,
    lessee: l.lessee,
    agreement_number: l.agreement_number,
    effective_date: l.effective_date,
    recording: l.recording,
    primary_term_expiration: l.primary_term_expiration,
    final_extension_expiration: l.final_extension_expiration,
    formations: l.formations,
    tmps_covered: l.tmps_covered,
    gross_acres: l.gross_acres,
    royalty_rate: l.royalty_rate,
  })), null, 1);
}

function allSources(s: SourceTexts, includeAbstract: boolean): string {
  return [
    block('title_opinion', s.opinion),
    block('title_mapping_curative', s.tmc),
    block('internal_bringdown', s.bringdown),
    includeAbstract ? block('abstract_of_title_excerpts', s.abstract) : '',
    block('lease_summaries', leaseSummary(s.leases)),
  ].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// 1. LEASE
// ---------------------------------------------------------------------------
export async function extractLease(text: string, filename: string, reviewDate: string): Promise<LeaseInfo> {
  const prompt = `Extract the key terms of this oil and gas lease ("${filename}") for the CNX Pad Summary Ownership tab. Review date: ${reviewDate || 'today'}.

Return ONE JSON object with exactly these string fields:
- lessors: all lessor names as written (e.g. "Robert J. Keys, Jr. and Mary Keys, husband and wife")
- lessee: original lessee (e.g. "CNX Gas Company LLC")
- agreement_number: any lease / agreement / QLS / QLA number printed on the lease, else ""
- effective_date: effective date of the lease (M/D/YYYY)
- recording: recording reference of the lease or its memorandum as "Book/Page" (e.g. "5637/25") or "Instr. #202604910"; "" if not recorded in this copy
- recorded_date
- primary_term: e.g. "5 years"
- primary_term_expiration: effective_date + primary term (M/D/YYYY)
- extension_type: "Paid Up" or "Rental" (renewal/extension payment option), "None" if no extension option
- extension_terms: short description of the extension/renewal option(s) (e.g. "Option to extend for one 5-year term, paid up" or "Up to 9 one-year extensions by rental")
- earliest_extension_expiration: primary_term_expiration + the first extension period; "N/A" if none
- final_extension_expiration: primary_term_expiration + all extension periods; "N/A" if none
- formations: formations / depths leased, e.g. "All Formations" or "All formations below the top of the Onondaga"
- pooling_limitation: "Unlimited" if lessee may pool with no acreage cap, the cap if stated (e.g. "640 acres + 10% tolerance"), "Silent" if the lease is silent, "No pooling" if prohibited
- pugh: "Yes" if there is a Pugh / release-of-non-pooled-lands or depth-severance clause, else "No"
- cross_unit_prohibited: "Yes" if cross-unit drilling / development / overlapping units is prohibited, else "No"
- gross_acres: acreage stated in the lease description (number only)
- tmps_covered: tax map parcel numbers covered, comma separated
- royalty_rate: royalty as a decimal (0.125, 0.15, 0.18)
- gross_royalty: "Yes" if royalty is paid without deductions (gross proceeds / no post-production costs), else "No"
- deduct_language: copy VERBATIM the clause(s) that govern how royalty is calculated and whether post-production costs/deductions may be taken, including any addendum language that modifies it (this is pasted into the Pad Summary)
- market_enhancement: "Yes" if there is a market enhancement clause, else "No"
- min_pay: minimum royalty payment threshold if stated (e.g. "100"), else ""
- recoupment_allowed: "Yes" if lessee may recoup/offset bonus, delay rental or other payments against royalties, "No" if prohibited, "Silent" if not addressed
- mwm: "Yes" if a minimum $25 per well per month (MWM) payment is required, else "No"
- apportionment: "Yes" if the lease requires royalties to be apportioned among separately owned tracts (non-entireties), else "No"
- notes_for_reviewer: anything unusual — addenda that override printed terms, illegible pages, conflicting dates. "" if none.

<lease_text>
${text}
</lease_text>`;
  const out = await runJson<LeaseInfo>(prompt, 8000);
  return { ...out, source_file: filename };
}

// ---------------------------------------------------------------------------
// 2. CORE — CAR header, leasehold, units/wells, outsales/encumbrances, taxes
// ---------------------------------------------------------------------------
export async function extractCore(s: SourceTexts): Promise<CoreExtract> {
  const prompt = `Build the data for the CNX Curative Action Report (CAR) from the documents below. Analyst review date: ${s.reviewDate || 'today'}.

SOURCE PRIORITY: the title opinion is the primary source. Use the Title Mapping Curative (TMC) for resolved acreage, outsale locations and survey matters. Use the internal bringdown for anything recorded after the opinion's certification date (new conveyances, leases, mortgage satisfactions). Use abstract excerpts only for well information missing from the opinion. Use the lease summaries for lease terms.
If the TMC contains more than one version (e.g. an original and a "(Revised)" TMC), use the most recent / revised version.

Return ONE JSON object with these fields (strings unless noted). TABLES MUST BE ARRAYS OF ARRAYS OF STRINGS in the column order given — e.g. "liens": [["202508584\\n(5886/70)", "9/12/2025\\n9/19/2025", "...", "$113,900.00", "Yes", "..."]] — never arrays of objects. Use [] when the opinion reports none:
- qls: Title Opinion / QLS number, e.g. "306981-000"
- tmps: array of tax map parcel numbers WITHOUT county/district prefix, e.g. ["240.06-01-11","240.06-01-12"]
- township, county, state (state spelled out, e.g. "Pennsylvania")
- law_firm: short firm name, e.g. "Bowles Rice"
- cert_start, cert_end: certification / search period of the opinion (from "Materials Examined" or the certification), M/D/YYYY
- opinion_date: date of the opinion letter
- bringdown: {"cert_start","cert_end","date"} from the internal bringdown (period searched; date = end of period) or null if no bringdown provided
- estates: estates certified, sentence case, e.g. "Surface, oil and gas" or "Oil and gas only"
- acres_title: total acreage covered by the opinion, e.g. "1.167 acres"
- acres_resolved: FINAL resolved acreage total from the TMC, e.g. "1.34 acres" ("" if no TMC)
- tract_description: "<tax parcels comma separated>, containing <acres_title>"
- wi_tables: array of {"formation","rows":[{"owner","wi","nri","orri"}]} — Working Interest Ownership by formation. A lease shown in the internal bringdown or the lease summaries (recorded after the opinion) counts — the tract is then leased to that lessee. NRI = WI × (1 − royalty) − any ORRI, as a decimal (e.g. 15% royalty → "0.85"). If UNLEASED use [{"formation":"All formations","rows":[{"owner":"Open","wi":"1.0","nri":"Open","orri":"Open"}]}]. Otherwise owner = current working-interest owner (lessee/assignee), wi and nri as decimals, orri "Yes"/"No".
- amendments: [Lessor/Grantor, Lessee/Grantee, Date of Instr., Recording, Date Recorded, Term, Explanation of Modified Terms]
- assignments: [Assignor, Assignee, Date of Instr., Recording, Date Recorded, Term, Formations Assigned, ORRI Reserved, Pugh, Other Restrictions]
- orri: [Current Owner, ORRI, Formations Subject to ORRI, Instrument Creating ORRI, Instrument Vesting ORRI]
- units: existing units/pools [Book/Page, Date Formed, Declarant, Unit Name, Acreage Contributed, Total Acreage, Depths Unitized]
- wells: [Well API#, Associated Lease, Associated Lease Acreage, Associated Unit, Well Completion Date, Well Status (Active, P&A, Dry Hole, etc.), Gaps in Production / Production Notes] — ONLY wells located ON the subject tract or drilled under a lease that covers it (as reported in the opinion's "Relevant Well Ownership" or the abstract's well info for the subject tract). Abstract well searches usually list every well within a radius of the tract — do NOT list those nearby wells. If the opinion says there are no wells on the Subject Tract, return [].
- well_date_checked: the analyst review date
- lease_wide_gaps: "N/A" unless production gaps are reported
- outsales: severances/outsales prior to lease [Book/Page, Acres, Date, Grantee, Located (Yes/No — Yes if the TMC mapped/located it; if the TMC says it lies outside the subject tract, write "Yes – outside subject tract per TMC"), Separate T/O #]
- liens: liens, mortgages, judgments [Instrument Number (put the book/page on a second line in parentheses, e.g. "202508584\\n(5886/70)"), Date ("executed\\nrecorded"), Parties Involved ("Mortgagor(s)\\nTo\\nMortgagee"), Amount (e.g. "$113,900.00"), Released (Yes/No — check the bringdown for a satisfaction/release), Release Instrument (instrument/book-page of the release if known, else describe e.g. "Satisfaction dated 6/29/2026, recorded 7/6/2026")]
- tax_fully_assessed: answer to "Is O&G in place fully assessed according to the Title Opinion?" — for Pennsylvania use exactly "N/A, oil and gas interests are not separately assessed for real estate tax purposes in the Commonwealth of Pennsylvania"
- tax_delinquent: answer to "Are any assessments listed as delinquent?" — "N/A" if none, else describe
- unassessed: [Owner Name, TMP, Property Acreage, Unassessed Interest]
- delinquent: [Owner Name, Property Assessment, Year(s) taxes delinquent, Sold (Yes/No)]
- contracts: {"agreement_number","name","still_valid","wells_drilled","restrictions"} — internal contracts (F/Os, JOAs) affecting the tract; agreement_number "N/A" if none
- heirship: "Yes" if title is vested in an heirship / unknown heirs / unprobated estate, else "No"
- heirship_name: decedent name(s) if heirship = Yes, else "N/A"
- additional_product_needed: "No" unless the opinion is incomplete and a supplemental/revised opinion or abstract is required (then describe)
- notes_for_reviewer: anything the analyst should double-check ("" if none)

${allSources(s, true)}`;
  return runJson<CoreExtract>(prompt, 12000);
}

// ---------------------------------------------------------------------------
// 3. CURATIVE ITEMS — title defects + CNX recommendation/status
// ---------------------------------------------------------------------------
const CURATIVE_RULES = `For each item return:
- section: "SPECIFIC CURATIVE ACTION ITEMS" | "GENERAL CURATIVE ACTION ITEMS" | "NON-ACTION CURATIVE ITEMS" | "COMMENTS AND LIMITATIONS" | "INTERNAL BRINGDOWN ITEMS" (map the law firm's own headings — e.g. "Requirements", "Title Requirements", "Advisory Comments" — onto the closest of these)
- defect: the item VERBATIM from the opinion, starting with its label exactly as the opinion prints it (e.g. "Specific Curative Action Item 1:" or "1." — never invent a label) followed by "\\n", then the body, then "\\nRecommendations:\\n" and the recommendation text if the opinion has one. Keep paragraph breaks as "\\n". Remove page headers/footers that interrupt the text (letter addressee, date and "Page N" lines) and footnote markers. Do not summarize.
- recommendation: the CNX Recommendation/Status, written the way a CNX title analyst would (see conventions)
- status: "open" (work remains), "satisfied", "advisory" or "waived"
- team: who must act on an OPEN item — "land" (leasing, subordinations, releases, well checks, heirship/affidavits), "mapping" (survey / Title Mapping Curative), "title" (attorney/title professional review, supplemental opinion, quiet title), "division_order" (pay/suspense/ownership-for-payment issues), "third_party" (outside operators/lessees), or "none" when not open
- action: for OPEN items, one concise sentence for the Curative Summary and Pad Summary (e.g. "Obtain a subordination from First Commonwealth Bank for the mortgage recorded at 5886/70."); "" otherwise

CNX ANALYST CONVENTIONS (follow these closely):
- Survey / vague description / plats do not close: if a TMC is provided that resolves the tract → recommendation "Satisfied by Title Mapping Curative", status satisfied. If no TMC → "Obtain Title Mapping Curative.", status open, team mapping.
- Roads / alleys / centerline of road: "Advisory. Typically, the oil and gas runs to the centerline of an adjacent roadway unless otherwise specifically stated." status advisory.
- No current lease in favor of CNX: if the lease summaries show leases covering ALL current oil and gas owners → "Satisfied. See lease(s) <recording/agreement>." Otherwise status open, team land, recommendation "Leasehold is open.  Land to execute a new lease with current oil and gas owners, <owner names with tenancy per parcel, e.g. 'Glenn L Nolan and Victoria L Burkett, JTWROS, in 240.06-01-11 and as tenants in common in 240.06-01-12'>, and place of record in <County> County." (if some owners are leased, name only the unleased owners). Use the same sentence as the action.
- Old / unreleased prior leases possibly held by production or storage: if the opinion and abstract report no wells on or near the tract → "Satisfied.  A review of PADEP and <County> Recorder indicates that there are no old wells or leases holding the subject parcel by production or storage." Otherwise open, team land: request well spot checks / affidavit of non-production for the specific leases/wells.
- Unreleased mortgage / lien prior to lease: if the internal bringdown shows a satisfaction or release → "Satisfied. Mtg was satisfied and released in <instrument or recording>" (status satisfied). Otherwise open, team land: obtain a subordination, consent, or release from the named lender.
- Township/school taxes or municipal liens not certified: "Advisory."
- Gaps in chain of title, incomplete tax sale records, ancient documents rule issues that are over 30 years old with no adverse claims: "Waived based on passage of time and lack of adverse claims against the subject parcels." status waived.
- Name variations / aliases / identity assumptions: "Advisory".
- Heirship / unprobated estates / unknown heirs: open, team land: obtain death and heirship affidavit and lease from heirs.
- Items needing a legal judgment call (questionable reservation, unclear vesting, quiet title validity): open, team title, recommendation beginning "Title Professional Review requested to determine ...".
- GENERAL curative items and NON-ACTION items: recommendation is exactly "Advisory" (status advisory) — do not add explanations, even for road or gap items in these sections.
- COMMENTS AND LIMITATIONS: return ONE item whose defect contains all of the numbered comments/limitations (each on its own line, keep numbering) and recommendation "".
- INTERNAL BRINGDOWN ITEMS: only if the internal bringdown shows conveyances, leases, easements or encumbrances recorded after the opinion's certification date that are NOT already addressed by an opinion item (a mortgage satisfaction is addressed under the mortgage item instead). Defect = description from the bringdown; give a recommendation.`;

export async function extractCurative(s: SourceTexts, part: 'specific' | 'other'): Promise<CurativeExtract> {
  const scope = part === 'specific'
    ? 'Return ONLY the SPECIFIC curative action items / title requirements (the tract-specific requirements), plus any INTERNAL BRINGDOWN ITEMS. Do NOT include general items, non-action items or comments/limitations — another pass handles those. Each opinion item appears exactly once.'
    : 'Return ONLY the GENERAL curative action items, the NON-ACTION curative items, and the COMMENTS AND LIMITATIONS. Do NOT include specific items. Each opinion item appears exactly once — never repeat an item. Also return "misc_notes": "None" unless there is an important title matter that is not covered by any curative item.';
  const prompt = `List the curative items from the title opinion for the "CURATIVE ITEMS AND RECOMMENDATIONS" table of the CNX Curative Action Report, in the order they appear in the opinion. Analyst review date: ${s.reviewDate || 'today'}.

${scope}

Return JSON: {"heading": "<opinion date> <law firm short name> - " (e.g. "6/25/2026 Bowles Rice - "), "items": [ ... ]${part === 'other' ? ', "misc_notes": "..."' : ''}}

${CURATIVE_RULES}

${allSources(s, part === 'specific')}`;
  return runJson<CurativeExtract>(prompt, MAX);
}

// ---------------------------------------------------------------------------
// 4. OWNERSHIP — owners per parcel, matched to leases
// ---------------------------------------------------------------------------
export async function extractOwnership(s: SourceTexts): Promise<OwnershipExtract> {
  const prompt = `Build the current OIL AND GAS ownership (not surface) for every tax parcel in the title opinion, for the CAR "Leasehold Control and Ownership Summary" and the Pad Summary Ownership tab. Analyst review date: ${s.reviewDate || 'today'}.

Rules:
- Use the opinion's current oil and gas ownership tables / certification. Apply any conveyances in the internal bringdown that changed ownership after the certification date.
- Create separate parcels ONLY when ownership differs between tax parcels (e.g. the opinion lists different owners or interests "As to Parcel One / Parcel Two"). If every tax parcel has the same owners and interests, return ONE parcel whose tmp lists all tax parcels comma-separated (e.g. "240.05-01-01, 240.05-01-03, 240.06-01-18") and whose acres are the totals.
- One owner entry per owner per parcel. Keep the owner's name as written in the opinion and add the tenancy where stated (", JTWROS" for "with rights of survivorship", "husband and wife, as tenants by the entireties" → ", TBE").
- exec_fraction = leasing / executive rights fraction; royalty_fraction = oil and gas royalty (mineral) fraction. Keep exact fractions as written (e.g. "1/2", "1/22", "1"). Never round.
- address: street on line 1, city/state/zip on line 2 (use "\\n").
- vesting: vesting instrument (e.g. "Instr. #201304047 (4430/171), dated 4/3/2013").
- lease_index: the lease_index from <lease_summaries> whose lessor is this owner AND which covers this parcel; null if none.
- record_leases / record_lease_index: if an owner is leased by a lease that is NOT in <lease_summaries> but IS shown in the internal bringdown or the opinion (e.g. a Memorandum of Lease recorded after the certification date), add it to "record_leases" as {"lessors","lessee","effective_date","recording","agreement_number","primary_term_expiration","royalty_rate","formations"} (use "" for unknown values; recording = instrument number or book/page) and set that owner's record_lease_index to its position. Otherwise record_lease_index is null.
- lease_status: "Open" when the owner is unleased; otherwise "Primary Term" if the review date is before the primary term expiration, "Extended Term" if within an extension, or "HBP" if held by production.
- qls_agreement: CNX QLS/QLA agreement number for that owner's lease if shown, else "".
- notes: "" unless something specific to this owner needs review.
- parcels: [{"label":"Parcel One","tmp":"240.06-01-11","deeded_acres":"0.217","resolved_acres":"0.29"}] — deeded/assessed acres from the opinion (number only); resolved acres per parcel from the most recent TMC (number only, "" if no TMC).
- title_notes: 1-3 sentences for the Pad Summary "Title Notes" column describing how the current owners hold title (vesting instrument, date, tenancy, name changes).

Return JSON: {"parcels":[...], "owners":[{"parcel_index":0,"tmp":"","owner_name":"","address":"","exec_fraction":"","royalty_fraction":"","vesting":"","lease_index":null,"record_lease_index":null,"lease_status":"","qls_agreement":"","notes":""}], "record_leases":[], "title_notes":""}
Keep output compact — there may be hundreds of owners.

${allSources(s, false)}`;
  return runJson<OwnershipExtract>(prompt, MAX);
}
