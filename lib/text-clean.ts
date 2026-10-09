// Pure helpers that turn per-page PDF text into compact prompt text.

/** Remove lines that repeat at the top/bottom of many pages (letterhead, "Page N", addressee blocks). */
export function stripRunningHeaders(pages: string[]): string[] {
  const textPages = pages.filter((p) => p.trim().length > 40);
  if (textPages.length < 4) return pages.map((p) => p.replace(/^\s*Page \d+( of \d+)?\s*$/gim, ''));
  const counts = new Map<string, number>();
  const key = (l: string) => l.trim().toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  for (const p of textPages) {
    const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
    const edge = new Set([...lines.slice(0, 8), ...lines.slice(-4)].map(key));
    edge.forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
  }
  const threshold = Math.max(3, Math.floor(textPages.length * 0.4));
  const drop = new Set([...counts.entries()].filter(([k, n]) => n >= threshold && k.length < 90).map(([k]) => k));
  return pages.map((p) => {
    const lines = p.split('\n');
    const n = lines.length;
    return lines
      .filter((l, i) => {
        const t = l.trim();
        if (!t) return true;
        if (/^page #( of #)?$/.test(key(t))) return false;
        const nearEdge = i < 10 || i >= n - 5;
        return !(nearEdge && drop.has(key(t)));
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });
}

export interface PageText { page: number; text: string }

/** Join pages that actually contain text, tagging page numbers so Claude can cite them. */
export function joinPages(pages: string[], opts: { minChars?: number; maxChars?: number; filter?: (t: string, i: number) => boolean } = {}): string {
  const min = opts.minChars ?? 60;
  const max = opts.maxChars ?? 400000;
  let out = '';
  pages.forEach((t, i) => {
    if (t.trim().length < min) return;
    if (opts.filter && !opts.filter(t, i)) return;
    const chunk = `\n\n[Page ${i + 1}]\n${t.trim()}`;
    if (out.length + chunk.length <= max) out += chunk;
  });
  return out.trim();
}

/** Fraction of pages that have a usable text layer. */
export function textCoverage(pages: string[]): number {
  if (!pages.length) return 0;
  return pages.filter((p) => p.trim().length > 100).length / pages.length;
}

const WELL_RE = /\b(API|well|wells|permit|plugg|spud|operator|production|PADEP|DEP|completion|gas well|oil well)\b/i;

/** Abstract excerpts: cover sheet / certification pages, any page that talks about wells, plus the given extra pages. */
export function abstractExcerpt(pages: string[], maxChars = 150000, extra: number[] = []): string {
  const keep = new Set(extra);
  return joinPages(pages, {
    maxChars,
    minChars: 20,
    filter: (t, i) => i < 4 || keep.has(i) || (t.trim().length >= 60 && WELL_RE.test(t)),
  });
}

const WELL_TAB = /\bwells?\s*(map|info(rmation)?|research|records?|data|details?|search|report|list|history)\b/i;

/**
 * Scanned pages in the abstract's well section (e.g. a Daxton Irving "Well Information" sheet that is only an image).
 * Finds the "Well Map" / "Well Information" exhibit tab in the back part of the abstract and returns the following
 * pages that have no usable text, so they can be read from the page image. [] when there is no well section.
 */
export function wellSectionScannedPages(pages: string[], max = 10): number[] {
  let start = -1;
  for (let i = Math.floor(pages.length * 0.3); i < pages.length; i++) {
    if (WELL_TAB.test(pages[i].trim().slice(0, 300))) { start = i; break; }
  }
  if (start < 0) return [];
  const out: number[] = [];
  for (let i = start + 1; i < pages.length && out.length < max; i++) {
    if (pages[i].trim().length < 200) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Title Mapping Curative — "Resolved Mapping Acreage" (top of page 1)
// ---------------------------------------------------------------------------
export interface TmcAcreage { total: string; parts: string[]; line: string }

/**
 * Reads e.g. "Resolved Mapping Acreage: 0.29 acres (Lots 7 & 9) + 1.05 acres (Revised) = 1.34 acres (Surface, Oil and Gas)"
 * → { total: "1.34 acres", parts: ["0.29", "1.05"] }. Uses the FIRST occurrence (page 1 = most recent/revised TMC).
 */
export function tmcResolvedAcreage(text: string): TmcAcreage | null {
  if (!text) return null;
  const m = text.match(/(?:resolved|final|mapped)\s+(?:mapping\s+|mapped\s+)?acre(?:age|s)\s*[:\-–]?\s*([^\n]*(?:\n(?!\s*\n)[^\n]*)?)/i);
  if (!m) return null;
  let line = m[1].replace(/\s+/g, ' ').trim();
  // stop at the next field label on the same logical line
  line = line.replace(/\b(Tax Info|Township|County|State|Law Firm|Date of Opinion)\b.*$/i, '').trim();
  const num = (s: string) => (s.replace(/,/g, '').match(/\d*\.?\d+/) || [''])[0];
  let total = '';
  let parts: string[] = [];
  if (line.includes('=')) {
    const [lhs, rhs] = [line.slice(0, line.lastIndexOf('=')), line.slice(line.lastIndexOf('=') + 1)];
    total = num(rhs);
    parts = lhs.split('+').map(num).filter(Boolean);
  } else {
    total = num(line);
  }
  if (!total) return null;
  return { total: `${total} acres`, parts, line };
}

// ---------------------------------------------------------------------------
// Title opinion date (letter date near the top of page 1) — used to order multiple opinions
// ---------------------------------------------------------------------------
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function opinionDateFromText(text: string): { mdy: string; time: number } | null {
  const head = (text || '').slice(0, 4000);
  const re = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i');
  const m = head.match(re);
  if (m) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    return { mdy: `${mo + 1}/${parseInt(m[2], 10)}/${m[3]}`, time: Date.UTC(+m[3], mo, +m[2]) };
  }
  const n = head.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (n) return { mdy: `${+n[1]}/${+n[2]}/${n[3]}`, time: Date.UTC(+n[3], +n[1] - 1, +n[2]) };
  return null;
}

// ---------------------------------------------------------------------------
// Scanned-page detection (no text, or an OCR layer that is mostly garbage — e.g. cursive)
// ---------------------------------------------------------------------------
const COMMON = new Set(('the and of to in a is that for by with as be or on this said from at any all such lessor lessee ' +
  'oil gas lease land lands premises party parties hereby day year county township state pennsylvania acres more less ' +
  'which shall have has are it its his her their unto witness whereof deed book page recorded owner grantor grantee ' +
  'royalty well wells drilling production term years paid under herein thereof same being part tract').split(' '));

export function looksGarbled(text: string): boolean {
  const words = (text || '').toLowerCase().match(/[a-z]{2,}/g) || [];
  if (words.length < 40) return true;
  const hits = words.filter((w) => COMMON.has(w)).length;
  return hits / words.length < 0.12;
}

/**
 * Page numbers (0-based) that should be read from the page IMAGE instead of the text layer.
 * Returns [] when the document is mostly readable already (a few form pages with little text are normal),
 * so only genuinely scanned / handwritten documents pay for image reading.
 */
export function pagesNeedingVision(pages: string[], maxGoodChars = 15000): number[] {
  if (!pages.length) return [];
  const flagged = pages.map((p, i) => ({ p, i })).filter(({ p }) => p.trim().length < 200 || looksGarbled(p)).map(({ i }) => i);
  const flaggedSet = new Set(flagged);
  // plenty of readable text already (e.g. a typed opinion with scanned exhibits) → don't read images
  const goodChars = pages.reduce((n, p, i) => n + (flaggedSet.has(i) ? 0 : p.trim().length), 0);
  if (goodChars >= maxGoodChars) return [];
  return flagged.length / pages.length >= 0.3 ? flagged : [];
}

const OWN_RE = /\b(ownership report|current owner|run ?sheet|chain of title|vesting|grantor|grantee|deed book|record book|lease book|assignment|adverse|outsale|conveyance|tax (ticket|map|parcel)|assessment)\b/i;

/**
 * Abstract text for building a CAR WITHOUT the title opinion: cover pages, well pages and ownership / run-sheet /
 * adverse pages first, then the remaining text pages, up to maxChars. Pages are returned in their original order.
 */
export function abstractFull(pages: string[], maxChars = 200000, extra: number[] = []): string {
  const keep = new Set(extra);
  const usable = pages.map((t, i) => ({ t: t.trim(), i })).filter((p) => p.t.length >= 60 || keep.has(p.i));
  const rank = (p: { t: string; i: number }) => (p.i < 4 || keep.has(p.i) ? 0 : WELL_RE.test(p.t) || OWN_RE.test(p.t) ? 1 : 2);
  const chosen: { t: string; i: number }[] = [];
  let total = 0;
  for (const r of [0, 1, 2]) {
    for (const p of usable) {
      if (rank(p) !== r) continue;
      const len = p.t.length + 20;
      if (total + len > maxChars) continue;
      chosen.push(p);
      total += len;
    }
  }
  return chosen.sort((a, b) => a.i - b.i).map((p) => `[Page ${p.i + 1}]\n${p.t}`).join('\n\n');
}
