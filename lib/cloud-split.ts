// Splits a pasted "curative items" section of a title opinion into CAR curative items.
// Runs entirely in the browser with fixed text rules — no AI, nothing is sent anywhere.
// Used by "New CAR — without the title opinion" for clients that don't allow opinions to be processed by AI.

import type { CuratorItemExtract } from './types';

export const SEC_SPECIFIC = 'SPECIFIC CURATIVE ACTION ITEMS';
export const SEC_GENERAL = 'GENERAL CURATIVE ACTION ITEMS';
export const SEC_NONACTION = 'NON-ACTION CURATIVE ITEMS';
export const SEC_COMMENTS = 'COMMENTS AND LIMITATIONS';

type Style = 'label' | 'number' | 'roman' | 'letter';

const MONTH = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i;

// Item labels that name their own section, e.g. "Specific Curative Action Item 1:" / "Non-Action Curative Item No. 3"
const LABEL_RE = /^(specific|general|non[-\s]?action)\s+curative\s+(?:action\s+)?(?:item|requirement)s?\s*(?:no\.?\s*|#\s*)?(\d+)\s*[:.)-]?/i;

function headingSection(line: string): string | null {
  const t = line.trim().replace(/^(?:section\s+)?(?:[IVXL]+|[A-Z]|\d+)[.)]\s+/i, '').replace(/[:.\s]+$/, '');
  if (!t || t.length > 80 || LABEL_RE.test(t)) return null;
  if (/^specific\s+curative\s+(?:action\s+)?(?:items?|requirements?)$/i.test(t)) return SEC_SPECIFIC;
  if (/^general\s+curative\s+(?:action\s+)?(?:items?|requirements?)$/i.test(t)) return SEC_GENERAL;
  if (/^non[-\s]?(?:action|curative)\s+(?:curative\s+)?(?:action\s+)?items?$/i.test(t)) return SEC_NONACTION;
  if (/^comments?\s+(?:and|&)\s+limitations?$/i.test(t) || /^limitations?$/i.test(t)) return SEC_COMMENTS;
  if (/^(?:title\s+|curative\s+|specific\s+)?requirements?$/i.test(t) || /^(?:x\.?\s*)?action\s+items?$/i.test(t)) return SEC_SPECIFIC;
  if (/^(?:advisory\s+)?comments?$/i.test(t) || /^advisory\s+(?:notes?|items?)$/i.test(t) || /^non[-\s]?action\s+(?:notes?|comments?)$/i.test(t)) return SEC_NONACTION;
  if (/^general\s+(?:requirements?|comments?|exceptions?)$/i.test(t)) return SEC_GENERAL;
  return null;
}

function romanToInt(r: string): number {
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
  let n = 0;
  const s = r.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const a = v[s[i]] || 0;
    const b = v[s[i + 1]] || 0;
    n += a < b ? -a : a;
  }
  return n;
}

/** If the line starts a numbered item, returns its style and number. */
function itemStart(line: string): { style: Style; n: number; section?: string } | null {
  const t = line.trim();
  const lab = t.match(LABEL_RE);
  if (lab) {
    const w = lab[1].toLowerCase();
    const section = w.startsWith('spec') ? SEC_SPECIFIC : w.startsWith('gen') ? SEC_GENERAL : SEC_NONACTION;
    return { style: 'label', n: parseInt(lab[2], 10), section };
  }
  let m = t.match(/^(\d{1,2})[.)]\s+\S/);
  if (m) return { style: 'number', n: parseInt(m[1], 10) };
  m = t.match(/^([IVXL]{1,6})[.)]\s+\S/);
  if (m) return { style: 'roman', n: romanToInt(m[1]) };
  m = t.match(/^([A-Z])[.)]\s+\S/);
  if (m) return { style: 'letter', n: m[1].charCodeAt(0) - 64 };
  return null;
}

/** Drop page furniture: "Page 12", document ids, and short lines repeated on every page (addressee, date, client). */
function cleanLines(text: string): string[] {
  const lines = text.replace(/\r/g, '').replace(/ /g, ' ').split('\n');
  const count = new Map<string, number>();
  for (const l of lines) {
    const k = l.trim();
    if (k && k.length < 70) count.set(k, (count.get(k) || 0) + 1);
  }
  return lines.filter((l) => {
    const t = l.trim();
    if (!t) return true;
    if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(t)) return false;
    if (/^\d{5,}(\.\d+)?$/.test(t)) return false; // document management numbers like 15389261.1
    if ((count.get(t) || 0) >= 3) {
      const keep = /recommend|advisory|^none|requirement|comment/i.test(t) || /:$/.test(t) || itemStart(t) !== null;
      if (!keep && (MONTH.test(t) || t.length < 60)) return false;
    }
    return true;
  });
}

/** Join lines that were wrapped by the PDF back into paragraphs (one "\n" between paragraphs). */
function reflow(lines: string[]): string {
  const paras: string[] = [];
  let cur = '';
  const flush = () => { if (cur.trim()) paras.push(cur.trim()); cur = ''; };
  for (const raw of lines) {
    const t = raw.trim().replace(/[ \t]{2,}/g, ' ');
    if (!t) { flush(); continue; }
    const startsNew = itemStart(t) !== null || /^recommendations?\s*:?/i.test(t) || /^(comment|requirement|discussion|note)s?\s*:/i.test(t);
    if (startsNew) flush();
    cur = cur ? (/-$/.test(cur) ? cur.slice(0, -1) + t : `${cur} ${t}`) : t;
    if (/:\s*$/.test(t) && t.length < 80) flush();
  }
  flush();
  return paras.join('\n');
}

export interface SplitResult {
  items: CuratorItemExtract[];
  counts: { specific: number; general: number; nonAction: number; comments: number };
}

/**
 * Pasted curative section → CAR items in opinion order.
 * Section headings ("SPECIFIC CURATIVE ACTION ITEMS", "Requirements", "Comments and Limitations" ...) set the section;
 * items start at "Specific Curative Action Item 1:", "1.", "I.", or "A." — numbered in sequence within a section.
 * General / non-action items get "Advisory"; specific items are left for the analyst's recommendation.
 */
export function splitPastedClouds(text: string): SplitResult {
  const lines = cleanLines(text || '');
  type Raw = { section: string; lines: string[] };
  const raws: Raw[] = [];
  let section = SEC_SPECIFIC;
  let style: Style | null = null;
  let expect = 1;
  let cur: Raw | null = null;
  let commentsBlock: Raw | null = null;

  for (const line of lines) {
    const t = line.trim();
    let h = t ? headingSection(t) : null;
    // inside COMMENTS AND LIMITATIONS, sub-headings like "A. Comments" / "B. Limitations" stay in the block
    if (h && commentsBlock && (h === SEC_COMMENTS || /comment|limitation|exception/i.test(t))) h = null;
    if (h) {
      section = h;
      style = null;
      expect = 1;
      cur = null;
      if (h === SEC_COMMENTS) { commentsBlock = { section: h, lines: [] }; raws.push(commentsBlock); }
      else commentsBlock = null;
      continue;
    }
    if (commentsBlock) { commentsBlock.lines.push(line); continue; }
    const st = t ? itemStart(t) : null;
    const accept = st && (
      (st.style === 'label') ||
      (style === null && st.n === 1) ||
      (style === st.style && st.n === expect)
    );
    if (st && accept) {
      if (st.style === 'label' && st.section) section = st.section;
      if (st.style !== 'label' || style === null) style = st.style;
      expect = st.n + 1;
      cur = { section, lines: [line] };
      raws.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
    else if (t) { cur = { section, lines: [line] }; raws.push(cur); } // text before the first numbered item
  }

  const items: CuratorItemExtract[] = raws
    .map((r) => ({ section: r.section, defect: reflow(r.lines) }))
    .filter((r) => r.defect.length > 0)
    .map((r) => {
      const advisory = r.section === SEC_GENERAL || r.section === SEC_NONACTION;
      return {
        section: r.section,
        defect: r.defect,
        recommendation: advisory ? 'Advisory' : '',
        status: advisory ? 'advisory' : '',
        team: 'none',
        action: '',
      } as CuratorItemExtract;
    });

  const counts = { specific: 0, general: 0, nonAction: 0, comments: 0 };
  for (const it of items) {
    if (it.section === SEC_SPECIFIC) counts.specific++;
    else if (it.section === SEC_GENERAL) counts.general++;
    else if (it.section === SEC_NONACTION) counts.nonAction++;
    else counts.comments++;
  }
  return { items, counts };
}
