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

/** Abstract excerpts: cover sheet / certification pages plus any page that talks about wells. */
export function abstractExcerpt(pages: string[]): string {
  return joinPages(pages, {
    maxChars: 60000,
    filter: (t, i) => i < 4 || WELL_RE.test(t),
  });
}
