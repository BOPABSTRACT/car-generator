'use client';
// Browser-side PDF text extraction with pdf.js (loaded from cdnjs so nothing has to be bundled).
// Title opinions, TMCs and abstracts are text-based PDFs, so they never have to be uploaded —
// only scanned (image-only) leases are sent to the server for OCR.

/* eslint-disable @typescript-eslint/no-explicit-any */
const VERSION = '3.11.174';
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VERSION}/pdf.min.js`;
const WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VERSION}/pdf.worker.min.js`;

let loading: Promise<any> | null = null;

function loadPdfJs(): Promise<any> {
  const w = window as any;
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_URL;
    s.async = true;
    s.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (!lib) return reject(new Error('pdf.js failed to load'));
      lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      resolve(lib);
    };
    s.onerror = () => reject(new Error('Could not load pdf.js from cdnjs'));
    document.head.appendChild(s);
  });
  return loading;
}

/** Returns the text of every page (empty string for image-only pages). */
export async function pdfPages(file: File, onPage?: (done: number, total: number) => void): Promise<string[]> {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await lib.getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(layoutText(content.items as any[]));
    page.cleanup();
    onPage?.(i, pdf.numPages);
  }
  await pdf.destroy();
  return pages;
}

/**
 * Renders the given pages (0-based) to JPEG for reading by Claude (scanned / handwritten pages).
 * Long side is capped at `maxSide` px so a batch of pages stays under Vercel's 4.5 MB request limit.
 */
export async function pdfPageImages(
  file: File,
  pageIndexes: number[],
  opts: { maxSide?: number; quality?: number; onPage?: (done: number, total: number) => void } = {},
): Promise<{ page: number; data: string }[]> {
  const lib = await loadPdfJs();
  const maxSide = opts.maxSide ?? 1600;
  const quality = opts.quality ?? 0.72;
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, isEvalSupported: false }).promise;
  const out: { page: number; data: string }[] = [];
  let done = 0;
  for (const idx of pageIndexes) {
    if (idx < 0 || idx >= pdf.numPages) continue;
    const page = await pdf.getPage(idx + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, maxSide / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const url = canvas.toDataURL('image/jpeg', quality);
    out.push({ page: idx + 1, data: url.slice(url.indexOf(',') + 1) });
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
    opts.onPage?.(++done, pageIndexes.length);
  }
  await pdf.destroy();
  return out;
}

/**
 * Rebuild reading order line-by-line (like `pdftotext -layout`) so table rows stay on one line.
 * Items are grouped by baseline, sorted left→right, and wide gaps become runs of spaces.
 */
export function layoutText(items: any[]): string {
  const rows: { y: number; h: number; items: { x: number; w: number; s: string }[] }[] = [];
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str.length || !it.transform) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, h * 0.35));
    if (!row) { row = { y, h, items: [] }; rows.push(row); }
    row.items.push({ x, w: it.width || 0, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  const out: string[] = [];
  let prevY: number | null = null;
  let prevH = 10;
  for (const r of rows) {
    if (prevY !== null && prevY - r.y > prevH * 1.9) out.push('');
    r.items.sort((a, b) => a.x - b.x);
    let line = '';
    let end: number | null = null;
    for (const it of r.items) {
      const cw = it.s.length ? Math.max(it.w / it.s.length, 2) : 4;
      if (end !== null) {
        const gap = it.x - end;
        const n = gap > cw * 2.5 ? Math.max(3, Math.round(gap / cw)) : gap > cw * 0.3 ? 1 : 0;
        line += ' '.repeat(Math.min(n, 40));
      }
      line += it.s;
      end = it.x + it.w;
    }
    out.push(line.replace(/\s+$/, ''));
    prevY = r.y;
    prevH = r.h;
  }
  return out.join('\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
