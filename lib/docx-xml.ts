// Small helpers for editing WordprocessingML (document.xml) with @xmldom/xmldom.
// Used to fill the CAR template while keeping all of its original formatting.

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export function parseXml(xml: string): El {
  return new DOMParser().parseFromString(xml, 'text/xml');
}

export function serializeXml(doc: El): string {
  return new XMLSerializer().serializeToString(doc);
}

export function kids(node: El, name?: string): El[] {
  const out: El[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (!name || c.nodeName === name)) out.push(c);
  }
  return out;
}

export function all(node: El, name: string): El[] {
  return Array.from(node.getElementsByTagName(name)) as El[];
}

export function textOf(node: El): string {
  return all(node, 'w:t').map((t: El) => t.textContent || '').join('');
}

export function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function rows(tbl: El): El[] {
  return kids(tbl, 'w:tr');
}

export function cells(tr: El): El[] {
  return kids(tr, 'w:tc');
}

/** All tables (any depth) whose first row text starts with `prefix` (case/space-insensitive). */
export function findTables(root: El, prefix: string): El[] {
  const p = norm(prefix);
  return all(root, 'w:tbl').filter((t: El) => {
    const r = rows(t)[0];
    return r ? norm(textOf(r)).startsWith(p) : false;
  });
}

export function findTable(root: El, prefix: string): El {
  const t = findTables(root, prefix)[0];
  if (!t) throw new Error(`CAR template: table "${prefix}" not found`);
  return t;
}

function el(doc: El, name: string): El {
  return doc.createElementNS(W_NS, name);
}

function firstTextRun(node: El): El | null {
  for (const r of all(node, 'w:r')) {
    if (kids(r, 'w:t').length) return r;
  }
  return null;
}

/** Run properties to use for new text in this cell/paragraph. */
function baseRunProps(container: El): El | null {
  const run = firstTextRun(container) || all(container, 'w:r')[0];
  if (run) {
    const rp = kids(run, 'w:rPr')[0];
    if (rp) return rp.cloneNode(true);
  }
  const p = container.nodeName === 'w:p' ? container : kids(container, 'w:p')[0];
  if (p) {
    const ppr = kids(p, 'w:pPr')[0];
    const mark = ppr ? kids(ppr, 'w:rPr')[0] : null;
    if (mark) return mark.cloneNode(true);
  }
  return null;
}

export interface TextOpts {
  color?: string;       // hex without #, e.g. "FF0000"; '' leaves as is
  bold?: boolean;       // force bold on/off
  boldFirstLine?: boolean;
  size?: number;        // half-points, e.g. 18 = 9pt
  underline?: boolean;  // false strips underline
}

function applyRunOpts(doc: El, rPr: El | null, opts: TextOpts, bold?: boolean): El {
  const rp = rPr ? rPr.cloneNode(true) : el(doc, 'w:rPr');
  // strip revision marks that would confuse Word
  for (const n of [...kids(rp, 'w:ins'), ...kids(rp, 'w:del')]) rp.removeChild(n);
  if (opts.color) {
    for (const c of kids(rp, 'w:color')) rp.removeChild(c);
    const c = el(doc, 'w:color');
    c.setAttributeNS(W_NS, 'w:val', opts.color);
    insertRPrChild(rp, c);
  }
  if (opts.underline === false) for (const n of kids(rp, 'w:u')) rp.removeChild(n);
  if (opts.size) {
    for (const n of [...kids(rp, 'w:sz'), ...kids(rp, 'w:szCs')]) rp.removeChild(n);
    const sz = el(doc, 'w:sz');
    sz.setAttributeNS(W_NS, 'w:val', String(opts.size));
    const szCs = el(doc, 'w:szCs');
    szCs.setAttributeNS(W_NS, 'w:val', String(opts.size));
    const ref = kids(rp).find((c: El) => ['w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath'].includes(c.nodeName)) || null;
    rp.insertBefore(sz, ref);
    rp.insertBefore(szCs, ref);
  }
  const b = bold ?? opts.bold;
  if (b !== undefined) {
    for (const n of [...kids(rp, 'w:b'), ...kids(rp, 'w:bCs')]) rp.removeChild(n);
    if (b) {
      const bn = el(doc, 'w:b');
      let ref = rp.firstChild;
      while (ref && (ref.nodeType !== 1 || ref.nodeName === 'w:rStyle' || ref.nodeName === 'w:rFonts')) ref = ref.nextSibling;
      rp.insertBefore(bn, ref);
    }
  }
  return rp;
}

// keep schema order roughly valid: w:color must come after fonts/b/i/caps etc and before w:sz
function insertRPrChild(rp: El, child: El) {
  const after = ['w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath'];
  for (let c = rp.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && after.includes(c.nodeName)) {
      rp.insertBefore(child, c);
      return;
    }
  }
  rp.appendChild(child);
}

export function makeRun(doc: El, text: string, rPr: El | null): El {
  const r = el(doc, 'w:r');
  if (rPr) r.appendChild(rPr);
  const t = el(doc, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  return r;
}

function stripParagraph(p: El) {
  for (const c of kids(p)) if (c.nodeName !== 'w:pPr') p.removeChild(c);
}

/** Replace all content of a table cell with `text` (newlines → separate paragraphs), keeping formatting. */
export function setCellText(tc: El, text: string, opts: TextOpts = {}) {
  const doc = tc.ownerDocument;
  const ps = kids(tc, 'w:p');
  const rPr = baseRunProps(tc);
  let proto = ps[0];
  if (!proto) {
    proto = el(doc, 'w:p');
    tc.appendChild(proto);
  }
  const protoClone = proto.cloneNode(true);
  stripParagraph(protoClone);
  // remove all existing paragraphs (and stray nested content except tcPr / tables)
  for (const c of kids(tc)) if (c.nodeName === 'w:p' || c.nodeName === 'w:sdt') tc.removeChild(c);
  const lines = (text ?? '').toString().replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, i) => {
    const p = protoClone.cloneNode(true);
    const bold = opts.boldFirstLine && i === 0 && lines.length > 1 ? true : undefined;
    if (line.length) p.appendChild(makeRun(doc, line, applyRunOpts(doc, rPr, opts, bold)));
    tc.appendChild(p);
  });
}

/** Append text (as a new run) to the end of the first paragraph of a cell. */
export function appendCellText(tc: El, text: string, opts: TextOpts = {}) {
  const doc = tc.ownerDocument;
  const p = kids(tc, 'w:p')[0];
  if (!p) return setCellText(tc, text, opts);
  const runs = kids(p, 'w:r');
  const last = runs[runs.length - 1];
  const rPr = last ? kids(last, 'w:rPr')[0] || null : baseRunProps(tc);
  p.appendChild(makeRun(doc, text, applyRunOpts(doc, rPr, opts)));
}

/** Insert text (as a new run) at the start of the first paragraph of a cell. */
export function prependCellText(tc: El, text: string, opts: TextOpts = {}) {
  const doc = tc.ownerDocument;
  const p = kids(tc, 'w:p')[0];
  if (!p) return setCellText(tc, text, opts);
  const first = kids(p, 'w:r')[0];
  const rPr = first ? kids(first, 'w:rPr')[0] || null : baseRunProps(tc);
  const run = makeRun(doc, text, applyRunOpts(doc, rPr, opts));
  if (first) p.insertBefore(run, first);
  else p.appendChild(run);
}

/** Keep the first paragraph (the question) and replace everything after it with `answer`. */
export function setCellAnswer(tc: El, answer: string) {
  const doc = tc.ownerDocument;
  const ps = kids(tc, 'w:p');
  if (!ps.length) return setCellText(tc, answer);
  const answerProto = (ps[1] || ps[0]).cloneNode(true);
  const rPr = baseRunProps(ps[1] || ps[0]);
  const bold = ps[1] ? undefined : false;
  ps.slice(1).forEach((p: El) => tc.removeChild(p));
  stripParagraph(answerProto);
  answerProto.appendChild(makeRun(doc, answer, applyRunOpts(doc, rPr, {}, bold)));
  tc.appendChild(answerProto);
}

export function setRowValues(tr: El, values: string[], opts: TextOpts | TextOpts[] = {}) {
  cells(tr).forEach((tc: El, i: number) => {
    const o = Array.isArray(opts) ? opts[i] || {} : opts;
    setCellText(tc, values[i] ?? '', o);
  });
}

/**
 * Replace `count` rows starting at `start` with one cloned prototype row per data entry.
 * `proto` defaults to the first replaced row.
 */
export function replaceRows(
  tbl: El,
  start: number,
  count: number,
  data: string[][],
  opts: TextOpts | TextOpts[] = {},
  proto?: El,
) {
  const rs = rows(tbl);
  const protoRow = (proto || rs[start]).cloneNode(true);
  const anchor = rs[start + count] || null;
  for (let i = start; i < Math.min(start + count, rs.length); i++) tbl.removeChild(rs[i]);
  for (const values of data) {
    const r = protoRow.cloneNode(true);
    setRowValues(r, values, opts);
    if (anchor) tbl.insertBefore(r, anchor);
    else tbl.appendChild(r);
  }
}

export function removeNode(n: El) {
  if (n && n.parentNode) n.parentNode.removeChild(n);
}

export function insertBefore(newNode: El, ref: El) {
  ref.parentNode.insertBefore(newNode, ref);
}

/** Find the first paragraph (any depth) whose text starts with `prefix`. */
export function findParagraph(root: El, prefix: string): El | null {
  const p = norm(prefix);
  return all(root, 'w:p').find((x: El) => norm(textOf(x)).startsWith(p)) || null;
}

/** Clone paragraph `proto`, give it new text, optional bold override. */
export function cloneParagraphWithText(proto: El, text: string, opts: TextOpts = {}): El {
  const doc = proto.ownerDocument;
  const rPr = baseRunProps(proto);
  const p = proto.cloneNode(true);
  stripParagraph(p);
  if (text) p.appendChild(makeRun(doc, text, applyRunOpts(doc, rPr, opts)));
  return p;
}

export function emptyParagraph(doc: El): El {
  return el(doc, 'w:p');
}
