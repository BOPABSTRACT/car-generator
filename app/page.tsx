'use client';

import { useMemo, useState } from 'react';
import { splitPastedClouds } from '@/lib/cloud-split';
import { pdfPages, pdfPageImages } from '@/lib/pdf-text';
import {
  stripRunningHeaders, joinPages, abstractExcerpt, pagesNeedingVision, tmcResolvedAcreage, opinionDateFromText,
  wellSectionScannedPages, abstractFull,
} from '@/lib/text-clean';
import type { OpinionText } from '@/lib/claude';
import { assemble, mergeCurative, normalizeCar, padFromCar } from '@/lib/assemble';
import { OWNERSHIP_COLUMNS, TITLE_CURATIVE_COLUMNS } from '@/lib/pad-columns';
import type {
  CarData, PadData, FormInfo, LeaseInfo, CoreExtract, CurativeExtract, OwnershipExtract, ChainExtract,
  CarOwnerRow, WiRow, PadOwnershipRow, CuratorItemExtract,
} from '@/lib/types';
import { Field, Section, RowsTable, ObjTable, StepList, type Step, type StepStatus } from './ui';

const LOGO = 'https://i.imgur.com/szjzoxt.png';
/** specific curative items are read in two parts (1–SPLIT and SPLIT+1 onward) so long opinions stay under the time limit */
const SPLIT = 8;

const OWNER_COLS = [
  { key: 'owner', label: 'Owner', wide: true }, { key: 'execRights', label: 'Exec Rights Ownership' },
  { key: 'royaltyOwnership', label: 'Royalty Ownership' }, { key: 'controlType', label: 'CNX Control Type' },
  { key: 'agreementQls', label: 'Agreement QLS #' }, { key: 'recording', label: 'Recording Info' },
  { key: 'royalty', label: 'Royalty' }, { key: 'poolingLimit', label: 'Pooling Limit' }, { key: 'pugh', label: 'Pugh' },
  { key: 'expiration', label: 'Expiration Date' }, { key: 'heldBy', label: 'Held by' },
  { key: 'formations', label: 'Formations Controlled' },
];
const WI_COLS = [
  { key: 'owner', label: 'WI Owner', wide: true }, { key: 'wi', label: 'WI' }, { key: 'nri', label: 'NRI' },
  { key: 'orri', label: 'Subject to ORRI (Yes/No)' },
];
const blankOwner = (): CarOwnerRow => ({
  owner: '', execRights: '', royaltyOwnership: '', controlType: '', agreementQls: '', recording: '', royalty: '',
  poolingLimit: '', pugh: '', expiration: '', heldBy: '', formations: '',
});

type Mode = 'choose' | 'car' | 'pad' | 'car-manual';

/** Title-opinion facts typed in by the analyst ("without the title opinion" mode) */
interface ManualOpinion { qls: string; lawFirm: string; certStart: string; certEnd: string; opinionDate: string; estates: string; acresTitle: string }
const emptyManual: ManualOpinion = { qls: '', lawFirm: '', certStart: '', certEnd: '', opinionDate: '', estates: '', acresTitle: '' };

const emptyForm: FormInfo = {
  analyst: '', analystInitials: '', reviewDate: '', tractNumbers: '', unitName: '', unitTwpCountyState: '', totalUnitAcres: '',
};

function todayMDY() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let data: { error?: string } & Record<string, unknown>;
  try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status}): ${text.slice(0, 300)}`); }
  if (!res.ok || data.error) throw new Error(data.error || `Server error (${res.status})`);
  return data as T;
}

async function download(url: string, body: unknown, filename: string) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Export failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const [mode, setMode] = useState<Mode>('choose');
  const [manualOp, setManualOp] = useState<ManualOpinion>({ ...emptyManual });
  const [pastedClouds, setPastedClouds] = useState('');
  const cloudPreview = useMemo(() => splitPastedClouds(pastedClouds), [pastedClouds]);
  const setM = (k: keyof ManualOpinion) => (v: string) => setManualOp((m) => ({ ...m, [k]: v }));
  const [form, setForm] = useState<FormInfo>({ ...emptyForm });
  const [carDocFile, setCarDocFile] = useState<File | null>(null);
  const [opinionFiles, setOpinionFiles] = useState<File[]>([]);
  const [tmcFile, setTmcFile] = useState<File | null>(null);
  const [bringdownFiles, setBringdownFiles] = useState<File[]>([]);
  const [abstractFile, setAbstractFile] = useState<File | null>(null);
  const [leaseFiles, setLeaseFiles] = useState<File[]>([]);

  const [steps, setSteps] = useState<Step[]>([]);
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<string[]>([]);

  const [car, setCar] = useState<CarData | null>(null);
  const [pad, setPad] = useState<PadData | null>(null);

  function handlePasswordSubmit() {
    if (passwordInput === 'BOP2026') { setAuthenticated(true); setPasswordError(false); } else setPasswordError(true);
  }
  const showStatus = (message: string, type: 'success' | 'error' | 'info') => setStatus({ message, type });
  const setF = (k: keyof FormInfo) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function updateCar(fn: (d: CarData) => void) {
    setCar((prev) => { if (!prev) return prev; const d = structuredClone(prev); fn(d); return d; });
  }
  function updatePad(fn: (d: PadData) => void) {
    setPad((prev) => { if (!prev) return prev; const d = structuredClone(prev); fn(d); return d; });
  }

  // ---------------- pipeline ----------------
  function stepSet(id: string, status: StepStatus, detail?: string) {
    setSteps((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const t = Date.now();
      return {
        ...s, status, detail: detail ?? s.detail,
        started: s.started ?? (status === 'running' ? t : undefined),
        ended: status === 'done' || status === 'error' ? (s.ended ?? t) : undefined,
      };
    }));
  }

  /** Reads scanned / handwritten pages with Claude (page images rendered in the browser, sent a few at a time). */
  async function readPagesWithVision(file: File, pageIdx: number[], id: string, opts: { batch?: number; maxSide?: number } = {}): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const BATCH = opts.batch || 4;
    const batches: number[][] = [];
    for (let i = 0; i < pageIdx.length; i += BATCH) batches.push(pageIdx.slice(i, i + BATCH));
    let done = 0;
    const worker = async (batch: number[]) => {
      const images = await pdfPageImages(file, batch, opts.maxSide ? { maxSide: opts.maxSide, quality: 0.8 } : undefined);
      const { text } = await postJson<{ text: string }>('/api/vision', { filename: file.name, images });
      // split "[Page N]" markers back out
      const parts = text.split(/\[Page (\d+)\]/);
      if (parts.length < 3) out.set(batch[0], text);
      for (let k = 1; k < parts.length; k += 2) out.set(parseInt(parts[k], 10) - 1, (parts[k + 1] || '').trim());
      done += batch.length;
      stepSet(id, 'running', `reading scanned pages with AI — ${done} of ${pageIdx.length}`);
    };
    // up to 4 batches at a time
    const queue = [...batches];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) await worker(queue.shift()!);
    }));
    return out;
  }

  /** Text of a PDF. Scanned or handwritten pages (no usable text layer) are read from the page image by Claude. */
  async function readPdf(file: File, id: string, mode: 'full' | 'abstract' | 'abstract-full'): Promise<string> {
    stepSet(id, 'running', 'reading text…');
    const pages = await pdfPages(file, (d, t) => stepSet(id, 'running', `page ${d} of ${t}`));
    if (mode === 'abstract' || mode === 'abstract-full') {
      // a well section that is only a scanned image (e.g. Daxton Irving "Well Information") is read from the page image
      const wellPages = wellSectionScannedPages(pages);
      if (wellPages.length) {
        stepSet(id, 'running', `reading ${wellPages.length} scanned well page(s) with AI…`);
        try {
          const read = await readPagesWithVision(file, wellPages, id, { batch: 2, maxSide: 2400 });
          read.forEach((t, i) => { pages[i] = t; });
        } catch { /* well pages are optional */ }
      }
      const text = mode === 'abstract-full'
        ? abstractFull(stripRunningHeaders(pages), 200000, wellPages)
        : abstractExcerpt(stripRunningHeaders(pages), 150000, wellPages);
      stepSet(id, 'done', text
        ? `${pages.length} pages, ${Math.round(text.length / 1000)}k chars used${wellPages.length ? ` (${wellPages.length} well page(s) read from images)` : ''}`
        : 'scanned — skipped (abstract is optional)');
      return text;
    }
    // leases: read images unless there's plenty of good text; other documents: only when essentially no text layer
    const need = pagesNeedingVision(pages, /lease-/.test(id) ? 15000 : 3000);
    if (need.length) {
      const MAX = 60;
      const use = need.slice(0, MAX);
      stepSet(id, 'running', `scanned/handwritten — reading ${use.length} page(s) with AI…`);
      const read = await readPagesWithVision(file, use, id);
      read.forEach((t, i) => { pages[i] = t; });
      const text = joinPages(stripRunningHeaders(pages), { minChars: 20 });
      stepSet(id, 'done', `${pages.length} pages (${use.length} read from images${need.length > MAX ? `; first ${MAX} only` : ''})`);
      return text;
    }
    const text = joinPages(stripRunningHeaders(pages));
    stepSet(id, 'done', `${pages.length} pages, ${Math.round(text.length / 1000)}k chars`);
    return text;
  }

  async function readBringdown(file: File, id: string): Promise<string> {
    if (/\.pdf$/i.test(file.name)) return readPdf(file, id, 'full');
    stepSet(id, 'running', 'reading Word file…');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/doc-text', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Could not read bringdown');
    stepSet(id, 'done', `${Math.round((data.text || '').length / 1000)}k chars`);
    return data.text as string;
  }

  /** Reads every bringdown, orders them oldest → newest (date in the file name, else the first date in the text). */
  async function readBringdowns(files: File[]): Promise<{ text: string; order: string[] }> {
    const read = await Promise.all(files.map(async (file, i) => {
      const id = `bringdown-${i}`;
      try {
        const text = await readBringdown(file, id);
        const m = file.name.match(/(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{4})/);
        const fromName = m ? { mdy: `${+m[1]}/${+m[2]}/${m[3]}`, time: Date.UTC(+m[3], +m[1] - 1, +m[2]) } : null;
        const d = fromName || opinionDateFromText(text);
        if (d) stepSet(id, 'done', `dated ${d.mdy}`);
        return { label: file.name, date: d?.mdy || '', time: d?.time ?? i, text };
      } catch (e) {
        stepSet(id, 'error', e instanceof Error ? e.message : String(e));
        return null;
      }
    }));
    const ok = read.filter(Boolean) as { label: string; date: string; time: number; text: string }[];
    ok.sort((a, b) => a.time - b.time);
    const order = ok.map((b) => `${b.date || '?'} (${b.label})`);
    if (ok.length <= 1) return { text: ok[0]?.text || '', order };
    return { order, text: ok.map((b, i) => `<bringdown number="${i + 1} of ${ok.length}" file="${b.label}" date="${b.date || 'unknown'}"${i === ok.length - 1 ? ' newest="true"' : ''}>\n${b.text.trim()}\n</bringdown>`).join('\n\n') };
  }

  /** Reads every title opinion and orders them oldest → newest by the letter date on page 1. */
  async function readOpinions(files: File[]): Promise<OpinionText[]> {
    const read = await Promise.all(files.map(async (file, i) => {
      const text = await readPdf(file, `opinion-${i}`, 'full');
      const d = opinionDateFromText(text);
      if (d) stepSet(`opinion-${i}`, 'done', `dated ${d.mdy}`);
      return { label: file.name, date: d?.mdy || '', time: d?.time ?? i, text };
    }));
    return read.sort((a, b) => a.time - b.time).map(({ label, date, text }) => ({ label, date, text }));
  }

  async function readLeases(reviewDate: string): Promise<LeaseInfo[]> {
    const leaseResults = await Promise.all(leaseFiles.map(async (lf, i) => {
      const id = `lease-${i}`;
      try {
        const text = await readPdf(lf, id, 'full');
        stepSet(id, 'running', 'extracting lease terms…');
        const { result } = await postJson<{ result: LeaseInfo }>('/api/analyze', { task: 'lease', text, filename: lf.name, reviewDate });
        stepSet(id, 'done', `${result.lessors || 'lease'} — ${result.effective_date || ''}`);
        return result;
      } catch (e) {
        stepSet(id, 'error', e instanceof Error ? e.message : String(e));
        return null;
      }
    }));
    return leaseResults.filter(Boolean) as LeaseInfo[];
  }

  async function generate() {
    if (!opinionFiles.length) { showStatus('Please upload the Title Opinion PDF(s)', 'error'); return; }
    const reviewDate = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(form.reviewDate.trim()) ? form.reviewDate.trim() : todayMDY();
    const f: FormInfo = { ...form, reviewDate };
    setForm(f);

    const initial: Step[] = [
      ...opinionFiles.map((of, i) => ({ id: `opinion-${i}`, label: `Title Opinion — ${of.name}`, status: 'pending' as StepStatus })),
      { id: 'tmc', label: tmcFile ? `Title Mapping Curative — ${tmcFile.name}` : 'Title Mapping Curative (not provided)', status: tmcFile ? 'pending' : 'skipped' },
      ...(bringdownFiles.length
        ? bringdownFiles.map((bf, i) => ({ id: `bringdown-${i}`, label: `Bringdown — ${bf.name}`, status: 'pending' as StepStatus }))
        : [{ id: 'bringdown-none', label: 'Bringdown (not provided)', status: 'skipped' as StepStatus }]),
      { id: 'abstract', label: abstractFile ? `Abstract — ${abstractFile.name}` : 'Abstract (not provided)', status: abstractFile ? 'pending' : 'skipped' },
      ...leaseFiles.map((lf, i) => ({ id: `lease-${i}`, label: `Lease — ${lf.name}`, status: 'pending' as StepStatus })),
      { id: 'core', label: 'Header, leasehold, outsales, encumbrances', status: 'pending' },
      { id: 'chain', label: 'Leasehold chain — amendments, assignments, ORRI', status: 'pending' },
      { id: 'wells', label: 'Wells — title opinion(s)', status: 'pending' },
      { id: 'wells-ab', label: 'Wells — abstract', status: abstractFile ? 'pending' : 'skipped' },
      ...opinionFiles.flatMap((_, i) => [
        { id: `cur1a-${i}`, label: `Specific curative items 1–${SPLIT} — opinion ${i + 1}`, status: 'pending' as StepStatus },
        { id: `cur1b-${i}`, label: `Specific curative items ${SPLIT + 1}+ — opinion ${i + 1}`, status: 'pending' as StepStatus },
        { id: `cur2-${i}`, label: `General / non-action items, comments & limitations — opinion ${i + 1}`, status: 'pending' as StepStatus },
      ]),
      { id: 'own', label: 'Owners by parcel — newest opinion + bringdown changes', status: 'pending' },
    ];
    setSteps(initial);
    setIsProcessing(true);
    setCar(null);
    setPad(null);
    setReviewNotes([]);
    showStatus('Reading documents in your browser…', 'info');

    try {
      // 1. text — runs in the browser; scanned/handwritten pages are read from images by Claude
      const [opinions, tmc, bdRead, abstract] = await Promise.all([
        readOpinions(opinionFiles),
        tmcFile ? readPdf(tmcFile, 'tmc', 'full').catch((e) => { stepSet('tmc', 'error', e.message); return ''; }) : Promise.resolve(''),
        bringdownFiles.length ? readBringdowns(bringdownFiles) : Promise.resolve({ text: '', order: [] as string[] }),
        abstractFile ? readPdf(abstractFile, 'abstract', 'abstract').catch((e) => { stepSet('abstract', 'error', e.message); return ''; }) : Promise.resolve(''),
      ]);
      const newest = opinions[opinions.length - 1];
      const bringdown = bdRead.text;
      const tmcAcreage = tmcResolvedAcreage(tmc);
      if (tmcFile) stepSet('tmc', 'done', tmcAcreage ? `resolved acreage ${tmcAcreage.total}` : 'resolved acreage line not found — check the CAR');

      // 2. leases (parallel)
      showStatus('Analyzing leases…', 'info');
      const leases = await readLeases(reviewDate);

      // 3. CAR + Pad analysis (parallel)
      showStatus('Building the CAR and Pad Summary (this usually takes 2–4 minutes)…', 'info');
      const base = { opinions, tmc, bringdown, abstract, leases, reviewDate };
      const run = async <T,>(id: string, task: string, sources: object, extra: object = {}): Promise<T> => {
        stepSet(id, 'running', 'analyzing…');
        try {
          const { result } = await postJson<{ result: T }>('/api/analyze', { task, sources, ...extra });
          stepSet(id, 'done', '');
          return result;
        } catch (e) {
          stepSet(id, 'error', e instanceof Error ? e.message : String(e));
          throw e;
        }
      };
      const coreP = run<CoreExtract>('core', 'core', { ...base, opinion: newest.text });
      const wellsP = run<{ wells: string[][]; notes: string }>('wells', 'wells', { ...base, opinion: newest.text });
      const wellsAbP = abstract
        ? run<{ wells: string[][]; notes: string }>('wells-ab', 'wells-abstract', { ...base, opinions: undefined, opinion: '', tmc: '', bringdown: '', leases: [] })
        : (stepSet('wells-ab', 'skipped', abstractFile ? 'no usable abstract text' : ''), Promise.resolve({ wells: [], notes: '' }));
      const chainP = run<ChainExtract>('chain', 'chain', { ...base, opinion: newest.text, tmc: '', abstract: '', leases: [] });
      const curP = opinions.map((op, i) => {
        const src = { ...base, opinions: undefined, opinion: op.text, newerOpinion: i < opinions.length - 1 ? newest.text : undefined };
        return Promise.allSettled([
          run<CurativeExtract>(`cur1a-${i}`, 'curative-specific', src, { range: { from: 1, to: SPLIT } }),
          run<CurativeExtract>(`cur1b-${i}`, 'curative-specific', src, { range: { from: SPLIT + 1, to: null } }),
          run<CurativeExtract>(`cur2-${i}`, 'curative-other', src),
        ]);
      });
      const titleQls = (newest.text.slice(0, 6000).match(/\b(\d{6}-\d{3})\b/) || opinionFiles[0].name.match(/(\d{6}-\d{3})/) || ['', ''])[1];
      const ownP = run<OwnershipExtract>('own', 'ownership', { ...base, opinions: undefined, opinion: newest.text, titleQls });
      const [coreR, wellsR, wellsAbR, chainR, ownR, ...curR] = await Promise.allSettled([coreP, wellsP, wellsAbP, chainP, ownP, ...curP]);
      const core = coreR.status === 'fulfilled' ? coreR.value : null;
      if (!core) throw new Error('The header/leasehold step failed — see the error above and try again.');
      const wellsOut = wellsR.status === 'fulfilled' ? wellsR.value : null;
      const wellsAb = wellsAbR.status === 'fulfilled' ? wellsAbR.value : null;
      const chain = chainR.status === 'fulfilled' ? chainR.value : null;
      const own = ownR.status === 'fulfilled' ? ownR.value : null;

      const curativeByOpinion = opinions.map((op, i) => {
        const pair = curR[i].status === 'fulfilled' ? (curR[i] as PromiseFulfilledResult<PromiseSettledResult<CurativeExtract>[]>).value : [];
        const c1 = pair[0]?.status === 'fulfilled' ? pair[0].value : null;
        const c1b = pair[1]?.status === 'fulfilled' ? pair[1].value : null;
        const c2 = pair[2]?.status === 'fulfilled' ? pair[2].value : null;
        const items: CuratorItemExtract[] = mergeCurative([...(c1?.items || []), ...(c1b?.items || [])], c2?.items || []);
        const fallbackHeading = core.opinions?.[i] ? `${core.opinions[i].opinion_date} ${core.opinions[i].law_firm} - ` : (op.date ? `${op.date} - ` : '');
        return { heading: c1?.heading || c1b?.heading || c2?.heading || fallbackHeading, items };
      });

      const built = assemble({
        form: f,
        core,
        curativeByOpinion,
        ownership: own || { parcels: [], owners: [], title_notes: '' },
        leases,
        wells: [...(wellsOut?.wells || []), ...(wellsAb?.wells || [])],
        chain,
        tmcAcreage,
      });
      setCar(built.car);
      setPad(built.pad);
      const notes = [
        opinions.length > 1 ? `Title opinions ordered oldest → newest: ${opinions.map((o) => `${o.date || '?'} (${o.label})`).join(', ')}. Ownership uses the newest.` : '',
        own?.bringdown_changes ? `Ownership changed per bringdown: ${own.bringdown_changes}` : '',
        tmcFile && !tmcAcreage ? 'Could not find the "Resolved Mapping Acreage" line on the TMC — check FINAL Resolved Acreage.' : '',
        bdRead.order.length > 1 ? `Bringdowns ordered oldest → newest: ${bdRead.order.join(', ')} — check the order on the CAR header.` : '',
        wellsOut?.notes ? `Wells (opinion): ${wellsOut.notes}` : '',
        wellsAb?.notes ? `Wells (abstract): ${wellsAb.notes}` : '',
        chain?.notes ? `Assignment chain: ${chain.notes}` : '',
        core.notes_for_reviewer,
        ...leases.map((l) => (l.notes_for_reviewer ? `${l.source_file}: ${l.notes_for_reviewer}` : '')),
      ].filter((n) => n && n.trim());
      setReviewNotes(notes);
      const failed = [wellsR, wellsAbR, chainR, ownR].filter((x) => x.status === 'rejected').length
        + curR.reduce((n, r) => n + (r.status === 'fulfilled' ? (r.value as PromiseSettledResult<unknown>[]).filter((x) => x.status === 'rejected').length : 3), 0);
      showStatus(failed
        ? `Done with ${failed} step(s) failing — those sections are empty. Review below, fill gaps, then export.`
        : 'Done. Review and edit everything below (red text in the CAR = analyst entries), then export.', failed ? 'info' : 'success');
    } catch (e) {
      showStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  }

  // ---------------- New CAR WITHOUT the title opinion ----------------
  // The opinion is never uploaded. Clouds pasted by the analyst are split in the browser (no AI);
  // TMC, bringdowns, abstract and leases are analyzed as usual.
  async function generateManual() {
    if (!abstractFile && !leaseFiles.length && !tmcFile) { showStatus('Upload at least the abstract, TMC or leases', 'error'); return; }
    const reviewDate = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(form.reviewDate.trim()) ? form.reviewDate.trim() : todayMDY();
    const f: FormInfo = { ...form, reviewDate };
    setForm(f);
    const initial: Step[] = [
      { id: 'clouds', label: 'Pasted curative items — split in your browser (not sent to AI)', status: pastedClouds.trim() ? 'pending' : 'skipped' },
      { id: 'tmc', label: tmcFile ? `Title Mapping Curative — ${tmcFile.name}` : 'Title Mapping Curative (not provided)', status: tmcFile ? 'pending' : 'skipped' },
      ...(bringdownFiles.length
        ? bringdownFiles.map((bf, i) => ({ id: `bringdown-${i}`, label: `Bringdown — ${bf.name}`, status: 'pending' as StepStatus }))
        : [{ id: 'bringdown-none', label: 'Bringdown (not provided)', status: 'skipped' as StepStatus }]),
      { id: 'abstract', label: abstractFile ? `Abstract — ${abstractFile.name}` : 'Abstract (not provided)', status: abstractFile ? 'pending' : 'skipped' },
      ...leaseFiles.map((lf, i) => ({ id: `lease-${i}`, label: `Lease — ${lf.name}`, status: 'pending' as StepStatus })),
      { id: 'core', label: 'Header, leasehold, outsales, encumbrances — from abstract, TMC, bringdown, leases', status: 'pending' },
      { id: 'chain', label: 'Leasehold chain — from abstract run sheet + bringdown', status: abstractFile || bringdownFiles.length ? 'pending' : 'skipped' },
      { id: 'wells-ab', label: 'Wells — abstract', status: abstractFile ? 'pending' : 'skipped' },
      { id: 'own', label: 'Owners by parcel — from abstract, bringdown, leases (verify against opinion)', status: 'pending' },
    ];
    setSteps(initial);
    setIsProcessing(true);
    setCar(null);
    setPad(null);
    setReviewNotes([]);
    showStatus('Reading documents in your browser…', 'info');
    try {
      const split = splitPastedClouds(pastedClouds);
      if (pastedClouds.trim()) {
        const c = split.counts;
        stepSet('clouds', 'done', `${split.items.length} item(s): ${c.specific} specific, ${c.general} general, ${c.nonAction} non-action${c.comments ? ', comments & limitations' : ''}`);
      }
      const [tmc, bdRead, abstract] = await Promise.all([
        tmcFile ? readPdf(tmcFile, 'tmc', 'full').catch((e) => { stepSet('tmc', 'error', e.message); return ''; }) : Promise.resolve(''),
        bringdownFiles.length ? readBringdowns(bringdownFiles) : Promise.resolve({ text: '', order: [] as string[] }),
        abstractFile ? readPdf(abstractFile, 'abstract', 'abstract-full').catch((e) => { stepSet('abstract', 'error', e.message); return ''; }) : Promise.resolve(''),
      ]);
      const bringdown = bdRead.text;
      const tmcAcreage = tmcResolvedAcreage(tmc);
      if (tmcFile) stepSet('tmc', 'done', tmcAcreage ? `resolved acreage ${tmcAcreage.total}` : 'resolved acreage line not found — check the CAR');

      showStatus('Analyzing leases…', 'info');
      const leases = await readLeases(reviewDate);

      showStatus('Building the CAR and Pad Summary (this usually takes 2–4 minutes)…', 'info');
      const fileQls = [tmcFile, abstractFile, ...bringdownFiles, ...leaseFiles].map((x) => x?.name.match(/\b(\d{6})-?(\d{3})\b/)).find(Boolean);
      const titleQls = manualOp.qls.trim() || (fileQls ? `${fileQls[1]}-${fileQls[2]}` : '');
      const base = { opinion: '', noOpinion: true, tmc, bringdown, abstract, leases, reviewDate, titleQls };
      const run = async <T,>(id: string, task: string, sources: object): Promise<T> => {
        stepSet(id, 'running', 'analyzing…');
        try {
          const { result } = await postJson<{ result: T }>('/api/analyze', { task, sources });
          stepSet(id, 'done', '');
          return result;
        } catch (e) {
          stepSet(id, 'error', e instanceof Error ? e.message : String(e));
          throw e;
        }
      };
      const coreP = run<CoreExtract>('core', 'core', base);
      const chainP = abstract || bringdown ? run<ChainExtract>('chain', 'chain', { ...base, tmc: '' }) : Promise.resolve(null);
      const wellsAbP = abstract
        ? run<{ wells: string[][]; notes: string }>('wells-ab', 'wells-abstract', { ...base, tmc: '', bringdown: '', leases: [] })
        : Promise.resolve({ wells: [], notes: '' });
      const ownP = run<OwnershipExtract>('own', 'ownership', base);
      const [coreR, chainR, wellsAbR, ownR] = await Promise.allSettled([coreP, chainP, wellsAbP, ownP]);
      const core = coreR.status === 'fulfilled' ? coreR.value : null;
      if (!core) throw new Error('The header/leasehold step failed — see the error above and try again.');
      const chain = chainR.status === 'fulfilled' ? chainR.value : null;
      const wellsAb = wellsAbR.status === 'fulfilled' ? wellsAbR.value : null;
      const own = ownR.status === 'fulfilled' ? ownR.value : null;

      // the analyst's typed opinion facts win over anything the AI found
      const m = manualOp;
      const qls = m.qls.trim() || core.qls || (fileQls ? `${fileQls[1]}-${fileQls[2]}` : '');
      const coreM: CoreExtract = {
        ...core,
        qls,
        law_firm: m.lawFirm.trim(), cert_start: m.certStart.trim(), cert_end: m.certEnd.trim(), opinion_date: m.opinionDate.trim(),
        opinions: [{ law_firm: m.lawFirm.trim(), cert_start: m.certStart.trim(), cert_end: m.certEnd.trim(), opinion_date: m.opinionDate.trim() }],
        estates: m.estates.trim() || '',
        acres_title: m.acresTitle.trim() || core.acres_title || '',
        misc_notes: '',
      };
      if (m.acresTitle.trim() && coreM.tract_description) {
        coreM.tract_description = coreM.tract_description.replace(/containing .*$/i, `containing ${m.acresTitle.trim()}`);
      }
      const heading = [m.opinionDate.trim(), m.lawFirm.trim()].filter(Boolean).join(' ');
      const built = assemble({
        form: f,
        core: coreM,
        curativeByOpinion: [{ heading: heading ? `${heading} - ` : '', items: split.items }],
        ownership: own || { parcels: [], owners: [], title_notes: '' },
        leases,
        wells: wellsAb?.wells || [],
        chain,
        tmcAcreage,
      });
      setCar(built.car);
      setPad(built.pad);
      const notes = [
        'Built WITHOUT the title opinion. Enter or verify against the opinion: header (law firm, cert dates, opinion date, estates, title acres), Curative Summary (page 1), CNX recommendations for the specific curative items, ownership fractions, assignment chain, liens, and the Miscellaneous section.',
        pastedClouds.trim() ? `Curative items were split from the pasted text — check that each cloud starts and ends in the right place (${split.items.length} found).` : 'No curative items were pasted — add them on the review screen under "Curative Items and Recommendations".',
        own?.bringdown_changes ? `Ownership changed per bringdown: ${own.bringdown_changes}` : '',
        tmcFile && !tmcAcreage ? 'Could not find the "Resolved Mapping Acreage" line on the TMC — check FINAL Resolved Acreage.' : '',
        bdRead.order.length > 1 ? `Bringdowns ordered oldest → newest: ${bdRead.order.join(', ')} — check the order on the CAR header.` : '',
        wellsAb?.notes ? `Wells (abstract): ${wellsAb.notes}` : '',
        chain?.notes ? `Assignment chain: ${chain.notes}` : '',
        core.notes_for_reviewer,
        ...leases.map((l) => (l.notes_for_reviewer ? `${l.source_file}: ${l.notes_for_reviewer}` : '')),
      ].filter((n) => n && n.trim());
      setReviewNotes(notes);
      const failed = [chainR, wellsAbR, ownR].filter((x) => x.status === 'rejected').length;
      showStatus(failed
        ? `Done with ${failed} step(s) failing — those sections are empty. Fill the title-opinion sections by hand, then export.`
        : 'Done. Fill in the title-opinion sections by hand (see notes), review everything, then export.', 'info');
    } catch (e) {
      showStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  }

  // ---------------- Pad Summary from an existing CAR ----------------
  async function generatePad() {
    if (!carDocFile) { showStatus('Please upload the completed CAR (.docx)', 'error'); return; }
    const reviewDate = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(form.reviewDate.trim()) ? form.reviewDate.trim() : todayMDY();
    const f: FormInfo = { ...form, reviewDate };
    setForm(f);
    const initial: Step[] = [
      { id: 'cardoc', label: `CAR — ${carDocFile.name}`, status: 'pending' },
      ...(opinionFiles.length
        ? opinionFiles.map((of, i) => ({ id: `opinion-${i}`, label: `Title Opinion — ${of.name}`, status: 'pending' as StepStatus }))
        : [{ id: 'opinion-none', label: 'Title Opinion (not provided — owners taken from the CAR)', status: 'skipped' as StepStatus }]),
      { id: 'tmc', label: tmcFile ? `Title Mapping Curative — ${tmcFile.name}` : 'Title Mapping Curative (not provided)', status: tmcFile ? 'pending' : 'skipped' },
      ...leaseFiles.map((lf, i) => ({ id: `lease-${i}`, label: `Lease — ${lf.name}`, status: 'pending' as StepStatus })),
      ...(opinionFiles.length ? [{ id: 'own', label: 'Owners, addresses and acres by parcel (newest opinion)', status: 'pending' as StepStatus }] : []),
    ];
    setSteps(initial);
    setIsProcessing(true);
    setCar(null);
    setPad(null);
    setReviewNotes([]);
    showStatus('Reading the CAR…', 'info');
    try {
      stepSet('cardoc', 'running', 'reading tables…');
      const fd = new FormData();
      fd.append('file', carDocFile);
      const res = await fetch('/api/parse-car', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Could not read the CAR');
      const parsed = normalizeCar(data.car as CarData);
      const ownerCount = parsed.parcels.reduce((n, p) => n + p.owners.length, 0);
      stepSet('cardoc', 'done', `${parsed.qls} — ${parsed.parcels.length} parcel(s), ${ownerCount} owner row(s)`);

      const [opinion, tmc] = await Promise.all([
        opinionFiles.length ? readOpinions(opinionFiles).then((ops) => ops[ops.length - 1]?.text || '').catch((e) => { stepSet('opinion-0', 'error', e.message); return ''; }) : Promise.resolve(''),
        tmcFile ? readPdf(tmcFile, 'tmc', 'full').catch((e) => { stepSet('tmc', 'error', e.message); return ''; }) : Promise.resolve(''),
      ]);

      const tmcAcreage = tmcResolvedAcreage(tmc);
      if (tmcFile) stepSet('tmc', 'done', tmcAcreage ? `resolved acreage ${tmcAcreage.total}` : 'resolved acreage line not found');

      showStatus('Analyzing leases…', 'info');
      const leases = await readLeases(reviewDate);

      let aiOwnership: OwnershipExtract | null = null;
      if (opinion) {
        showStatus('Matching owners, addresses and acreage from the title opinion…', 'info');
        stepSet('own', 'running', 'analyzing…');
        try {
          const { result } = await postJson<{ result: OwnershipExtract }>('/api/analyze', {
            task: 'ownership', sources: { opinion, tmc, bringdown: '', abstract: '', leases, reviewDate, titleQls: parsed.qls },
          });
          aiOwnership = result;
          stepSet('own', 'done', `${result.owners?.length || 0} owner row(s)`);
        } catch (e) {
          stepSet('own', 'error', `${e instanceof Error ? e.message : String(e)} — using the CAR's owner tables instead`);
        }
      }

      if (!f.analyst && parsed.analyst) setForm((x) => ({ ...x, analyst: parsed.analyst }));
      setCar(parsed);
      setPad(padFromCar(parsed, f, leases, aiOwnership, tmcAcreage));
      const notes: string[] = [];
      if (!aiOwnership) notes.push('Owner addresses (column J) and per-parcel acres (AF/AG) are not on the CAR — add the Title Opinion and TMC to fill them, or type them in below.');
      leases.forEach((l) => { if (l.notes_for_reviewer) notes.push(`${l.source_file}: ${l.notes_for_reviewer}`); });
      setReviewNotes(notes);
      showStatus('Pad Summary rows are ready. Review and edit below, then export.', 'success');
    } catch (e) {
      showStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  }

  function startOver(next: Mode) {
    setMode(next);
    setSteps([]);
    setStatus(null);
    setReviewNotes([]);
    setCar(null);
    setPad(null);
  }

  async function exportCar() {
    if (!car) return;
    setIsExporting(true);
    try {
      const name = `${car.qls || 'CAR'} - CAR - ${(car.analysisDate || todayMDY()).replace(/\//g, '.')}.docx`;
      await download('/api/export-car', { car }, name);
      showStatus(`Exported ${name}`, 'success');
    } catch (e) { showStatus(e instanceof Error ? e.message : String(e), 'error'); } finally { setIsExporting(false); }
  }

  async function exportPad() {
    if (!pad || !car) return;
    setIsExporting(true);
    try {
      const name = `${car.qls || 'QLS'} - Pad Summary Rows.xlsx`;
      await download('/api/export-pad', { pad }, name);
      showStatus(`Exported ${name}`, 'success');
    } catch (e) { showStatus(e instanceof Error ? e.message : String(e), 'error'); } finally { setIsExporting(false); }
  }

  function saveSession() {
    const blob = new Blob([JSON.stringify({ mode, form, car, pad }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${car?.qls || 'CAR'} - review session.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function loadSession(file: File | undefined) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.mode === 'car' || data.mode === 'pad' || data.mode === 'car-manual') setMode(data.mode);
      if (data.form) setForm({ ...emptyForm, ...data.form });
      if (data.car) setCar(normalizeCar(data.car));
      if (data.pad) setPad(data.pad);
      showStatus(`Loaded ${file.name}`, 'success');
    } catch { showStatus('That file is not a saved review session', 'error'); }
  }

  // ---------------- render ----------------
  if (!authenticated) {
    return (
      <main style={{
        minHeight: '100vh', background: '#0f1117', fontFamily: 'Georgia, serif',
        color: '#e8e0d0', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ background: '#0d0f14', border: '1px solid #2a2a3a', borderRadius: 12, padding: '48px 40px', width: '100%', maxWidth: 400, textAlign: 'center' }}>
          <img src={LOGO} alt="BOP Abstract Logo" style={{ width: 140, height: 140, objectFit: 'contain', margin: '0 auto 24px', display: 'block' }} />
          <div style={{ fontSize: 20, fontWeight: 600, color: '#c8a96e', marginBottom: 4 }}>BOP ABSTRACT</div>
          <div style={{ fontSize: 12, color: '#666', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 32 }}>CAR &amp; Pad Summary Generator</div>
          <input
            type="password" placeholder="Enter password" value={passwordInput}
            onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
            onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
            style={{ width: '100%', padding: '12px 16px', background: '#0f1117', border: `1px solid ${passwordError ? '#8b2020' : '#2a2a3a'}`, borderRadius: 6, color: '#e8e0d0', fontSize: 15, fontFamily: 'Georgia, serif', boxSizing: 'border-box', marginBottom: 12, outline: 'none' }}
          />
          {passwordError && <div style={{ color: '#e07070', fontSize: 13, marginBottom: 12 }}>Incorrect password. Please try again.</div>}
          <button onClick={handlePasswordSubmit} style={{ width: '100%', padding: '12px 32px', background: 'linear-gradient(135deg, #c8a96e, #8b6914)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 15, fontFamily: 'Georgia, serif', cursor: 'pointer', letterSpacing: '0.04em' }}>Enter</button>
        </div>
      </main>
    );
  }

  if (mode === 'choose') {
    return (
      <div className="container">
        <a href="/user-guide.html" target="_blank" rel="noopener noreferrer" className="help-btn">User Guide</a>
        <h1>{'Curative Action Report & Pad Summary Generator'}</h1>
        <p style={{ textAlign: 'center', color: '#4B5563', marginTop: -10, marginBottom: 28 }}>{'What would you like to do?'}</p>
        <div className="mode-grid">
          <button className="mode-card" onClick={() => startOver('car')}>
            <span className="mode-title">{'Create a new CAR'}</span>
            <span className="mode-desc">{'Build the Curative Action Report and the Pad Summary rows from the title opinion, TMC, bringdown, abstract and leases.'}</span>
          </button>
          <button className="mode-card" onClick={() => startOver('car-manual')}>
            <span className="mode-title">{'New CAR — without the title opinion'}</span>
            <span className="mode-desc">{'For clients who don’t allow title opinions to go through AI. The opinion is never uploaded: paste its curative items (split in your browser) and type the header; everything else is built from the TMC, bringdown, abstract and leases.'}</span>
          </button>
          <button className="mode-card" onClick={() => startOver('pad')}>
            <span className="mode-title">{'Pad Summary from an existing CAR'}</span>
            <span className="mode-desc">{'Upload a completed CAR (.docx) and the leases to build only the Pad Summary Ownership and Title-Curative rows.'}</span>
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <label className="btn-small" style={{ cursor: 'pointer' }}>
            {'Load saved session'}
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => { setMode('car'); loadSession(e.target.files?.[0]); }} />
          </label>
        </div>
      </div>
    );
  }

  const done = steps.filter((s) => ['done', 'error', 'skipped'].includes(s.status)).length;
  const padOnly = mode === 'pad';
  const manual = mode === 'car-manual';

  return (
    <div className="container">
      <a href="/user-guide.html" target="_blank" rel="noopener noreferrer" className="help-btn">User Guide</a>
      <h1>{padOnly ? 'Pad Summary from an Existing CAR' : manual ? 'New CAR — Without the Title Opinion' : 'Create a New CAR & Pad Summary'}</h1>
      <div style={{ textAlign: 'center', marginTop: -18, marginBottom: 10 }}>
        <button className="btn-small" onClick={() => startOver('choose')} disabled={isProcessing}>{'← Back to start'}</button>
      </div>

      <h2>{'1. Analyst & Unit'}</h2>
      <div className="grid-2">
        <Field label="Analyst Name *" value={form.analyst} onChange={setF('analyst')} placeholder="e.g., Michael Sposito" />
        <Field label="Analyst Initials" value={form.analystInitials} onChange={setF('analystInitials')} placeholder="e.g., MJS" />
        <Field label="Analysis Review Date" value={form.reviewDate} onChange={setF('reviewDate')} placeholder={`blank = today (${todayMDY()})`} />
        <Field label="Pad Summary Tract #(s) — one per parcel, in order" value={form.tractNumbers} onChange={setF('tractNumbers')} placeholder="e.g., 35A, 35B" />
        <Field label="Unit Name" value={form.unitName} onChange={setF('unitName')} placeholder="e.g., MAM17U South" />
        <Field label="Total Acres in Unit" value={form.totalUnitAcres} onChange={setF('totalUnitAcres')} placeholder="e.g., 1546.22" />
      </div>
      <Field label="Unit Township/County/State" value={form.unitTwpCountyState} onChange={setF('unitTwpCountyState')} placeholder="e.g., Kiskiminetas/Armstrong/PA" />

      <h2>{'2. Source Documents'}</h2>
      {padOnly ? (
        <>
          <div className="grid-2">
            <div className="form-group">
              <label>{'Completed CAR (.docx) *'}</label>
              <input type="file" accept=".docx" onChange={(e) => setCarDocFile(e.target.files?.[0] || null)} />
              <div className="hint">{'Title-Curative tab and the owners/interests by parcel come from the CAR.'}</div>
            </div>
            <div className="form-group">
              <label>{'Long Form Lease(s) (PDF, one file per lease)'}</label>
              <input type="file" accept=".pdf" multiple onChange={(e) => setLeaseFiles(Array.from(e.target.files || []))} />
              <div className="hint">{'Lease dates, extensions, royalty, deduct language, pooling, Pugh, etc.'}</div>
            </div>
            <div className="form-group">
              <label>{'Title Opinion (PDF) — optional'}</label>
              <input type="file" accept=".pdf" multiple onChange={(e) => setOpinionFiles(Array.from(e.target.files || []))} />
              <div className="hint">{'Adds owner addresses and per-parcel deeded acres (not on the CAR).'}</div>
            </div>
            <div className="form-group">
              <label>{'Title Mapping Curative (PDF) — optional'}</label>
              <input type="file" accept=".pdf" onChange={(e) => setTmcFile(e.target.files?.[0] || null)} />
              <div className="hint">{'Adds resolved acres per parcel (used with the Title Opinion).'}</div>
            </div>
          </div>
          <div className="button-group">
            <button className="btn-real" onClick={generatePad} disabled={isProcessing}>
              {isProcessing ? 'Processing…' : 'Generate Pad Summary'}
            </button>
            <label className="btn-load">
              {'Load saved session'}
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => loadSession(e.target.files?.[0])} />
            </label>
          </div>
        </>
      ) : manual ? (<>
      <div className="status info" style={{ marginTop: 0 }}>
        {'The title opinion is not uploaded and nothing from it is sent to AI. Type the opinion header below and paste the curative section — it is split into items here in your browser.'}
      </div>
      <h3 style={{ marginBottom: 6 }}>{'Title opinion header (typed by the analyst)'}</h3>
      <div className="grid-3">
        <Field label="Title Opinion QLS #" value={manualOp.qls} onChange={setM('qls')} placeholder="e.g., 296808-000" />
        <Field label="Law Firm" value={manualOp.lawFirm} onChange={setM('lawFirm')} placeholder="e.g., Bowles Rice" />
        <Field label="Title Opinion Date" value={manualOp.opinionDate} onChange={setM('opinionDate')} placeholder="M/D/YYYY" />
        <Field label="Certification Start" value={manualOp.certStart} onChange={setM('certStart')} placeholder="M/D/YYYY" />
        <Field label="Certification End" value={manualOp.certEnd} onChange={setM('certEnd')} placeholder="M/D/YYYY" />
        <Field label="Estates Certified" value={manualOp.estates} onChange={setM('estates')} placeholder="e.g., Surface, oil and gas" />
        <Field label="Acres per Title Opinion" value={manualOp.acresTitle} onChange={setM('acresTitle')} placeholder="e.g., 38.451 acres" />
      </div>
      <div className="form-group">
        <label>{'Paste the opinion’s curative section (optional)'}</label>
        <textarea rows={8} value={pastedClouds} onChange={(e) => setPastedClouds(e.target.value)}
          placeholder={'Copy from the PDF everything from "SPECIFIC CURATIVE ACTION ITEMS" (or "Requirements") through "COMMENTS AND LIMITATIONS" and paste it here.'} />
        <div className="hint">
          {pastedClouds.trim()
            ? `Found ${cloudPreview.items.length} item(s): ${cloudPreview.counts.specific} specific, ${cloudPreview.counts.general} general, ${cloudPreview.counts.nonAction} non-action${cloudPreview.counts.comments ? ', plus comments & limitations' : ''}. Split here in your browser — not sent anywhere. General / non-action items get "Advisory"; add the CNX recommendation for each specific item on the review screen.`
            : 'Items are recognized by labels like "Specific Curative Action Item 1:", "1.", "I." or "A.", and by section headings.'}
        </div>
      </div>
      <h3 style={{ marginBottom: 6 }}>{'Other documents (analyzed with AI as usual)'}</h3>
      <div className="grid-2">
        <div className="form-group">
          <label>{'Title Mapping Curative (PDF)'}</label>
          <input type="file" accept=".pdf" onChange={(e) => setTmcFile(e.target.files?.[0] || null)} />
          <div className="hint">{'Resolved acreage, outsales and survey clouds.'}</div>
        </div>
        <div className="form-group">
          <label>{'Internal Bringdown(s) (DOC, DOCX or PDF)'}</label>
          <input type="file" accept=".doc,.docx,.pdf" multiple onChange={(e) => setBringdownFiles(Array.from(e.target.files || []))} />
          <div className="hint">{'Select all bringdowns at once — ordered oldest → newest by the date in the file name.'}</div>
        </div>
        <div className="form-group">
          <label>{'Abstract of Title (PDF) — recommended'}</label>
          <input type="file" accept=".pdf" onChange={(e) => setAbstractFile(e.target.files?.[0] || null)} />
          <div className="hint">{'Stands in for the opinion: ownership report, run sheet, assignments, taxes and wells.'}</div>
        </div>
        <div className="form-group">
          <label>{'Long Form Lease(s) (PDF, one file per lease)'}</label>
          <input type="file" accept=".pdf" multiple onChange={(e) => setLeaseFiles(Array.from(e.target.files || []))} />
          <div className="hint">{'Lease terms for the ownership / WI tables and the Pad Summary.'}</div>
        </div>
      </div>
      <div className="button-group">
        <button className="btn-real" onClick={generateManual} disabled={isProcessing}>
          {isProcessing ? 'Processing…' : 'Generate CAR & Pad Summary'}
        </button>
        <label className="btn-load">
          {'Load saved session'}
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => loadSession(e.target.files?.[0])} />
        </label>
      </div>
      </>) : (<>
      <div className="grid-2">
        <div className="form-group">
          <label>{'Title Opinion (PDF) *'}</label>
          <input type="file" accept=".pdf" multiple onChange={(e) => setOpinionFiles(Array.from(e.target.files || []))} />
          <div className="hint">{'Main source for almost every section of the CAR.'}</div>
        </div>
        <div className="form-group">
          <label>{'Title Mapping Curative (PDF)'}</label>
          <input type="file" accept=".pdf" onChange={(e) => setTmcFile(e.target.files?.[0] || null)} />
          <div className="hint">{'Resolved acreage and survey/acreage clouds.'}</div>
        </div>
        <div className="form-group">
          <label>{'Internal Bringdown(s) (DOC, DOCX or PDF)'}</label>
          <input type="file" accept=".doc,.docx,.pdf" multiple onChange={(e) => setBringdownFiles(Array.from(e.target.files || []))} />
          <div className="hint">{'Select all bringdowns at once — they are ordered oldest → newest by the date in the file name.'}</div>
        </div>
        <div className="form-group">
          <label>{'Abstract of Title (PDF)'}</label>
          <input type="file" accept=".pdf" onChange={(e) => setAbstractFile(e.target.files?.[0] || null)} />
          <div className="hint">{'Optional — used for well info missing from the opinion.'}</div>
        </div>
      </div>
      <div className="form-group">
        <label>{'Long Form Lease(s) (PDF, one file per lease)'}</label>
        <input type="file" accept=".pdf" multiple onChange={(e) => setLeaseFiles(Array.from(e.target.files || []))} />
        <div className="hint">{'Lease terms for the ownership / WI tables and the Pad Summary Ownership tab. Scanned leases are OCR’d automatically.'}</div>
      </div>

      <div className="button-group">
        <button className="btn-real" onClick={generate} disabled={isProcessing}>
          {isProcessing ? 'Processing…' : 'Generate CAR & Pad Summary'}
        </button>
        <label className="btn-load">
          {'Load saved session'}
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => loadSession(e.target.files?.[0])} />
        </label>
      </div>
      </>)}

      {steps.length > 0 && (
        <>
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
            <span className="progress-label">{done} of {steps.length} steps</span>
          </div>
          <StepList steps={steps} />
        </>
      )}

      {status && <div className={`status ${status.type}`}>{status.message}</div>}

      {reviewNotes.length > 0 && (
        <div className="status info">
          <strong>{'Notes for reviewer:'}</strong>
          <ul>{reviewNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}

      {car && pad && (
        <div>
          {!padOnly && (<>
          <h2>{'3. Review & Edit — Curative Action Report'}</h2>

          <Section title="Header">
            <div className="grid-3">
              <Field label="Title Opinion QLS #" value={car.qls} onChange={(v) => updateCar((d) => { d.qls = v; })} />
              <Field label="Tax Map & Parcel(s)" value={car.tmp} onChange={(v) => updateCar((d) => { d.tmp = v; })} />
              <Field label="Township, County & State" value={car.twpCountyState} onChange={(v) => updateCar((d) => { d.twpCountyState = v; })} />
            </div>
            <label>{'Law Firm(s) / Certification Date Range / Title Opinion Date(s)'}</label>
            <RowsTable
              headers={['Law Firm(s)', 'Certification Date Range', 'Title Opinion Date(s)']}
              rows={car.opinions.map((o) => [o.lawFirm, o.certRange, o.opinionDate])}
              onChange={(rows) => updateCar((d) => { d.opinions = rows.map((r) => ({ lawFirm: r[0], certRange: r[1], opinionDate: r[2] })); })}
            />
            <div className="grid-3">
              <Field label="Estates and Formations Certified" value={car.estates} onChange={(v) => updateCar((d) => { d.estates = v; })} />
              <Field label="Acres Covered by Title Opinion" value={car.acresTitle} onChange={(v) => updateCar((d) => { d.acresTitle = v; })} />
              <Field label="FINAL Resolved Acreage" value={car.acresResolved} onChange={(v) => updateCar((d) => { d.acresResolved = v; })} />
            </div>
          </Section>

          <Section title="Curative Summary (page 1)" note="each numbered line prints as its own row in the CAR">
            <Field textarea label="Land Curative Recommendations" value={car.curativeSummary.land} onChange={(v) => updateCar((d) => { d.curativeSummary.land = v; })} />
            <Field textarea label="Mapping Curative Recommendations" value={car.curativeSummary.mapping} onChange={(v) => updateCar((d) => { d.curativeSummary.mapping = v; })} />
            <Field textarea label="Title Curative Recommendations" value={car.curativeSummary.title} onChange={(v) => updateCar((d) => { d.curativeSummary.title = v; })} />
            <Field textarea label="Division Order Items" value={car.curativeSummary.divisionOrder} onChange={(v) => updateCar((d) => { d.curativeSummary.divisionOrder = v; })} />
          </Section>

          <Section title="Final Operating Leasehold Summary">
            <Field label="Tract Description" value={car.tractDescription} onChange={(v) => updateCar((d) => { d.tractDescription = v; })} />
            {car.wiTables.map((w, wi) => (
              <div key={wi} className="sub-block">
                <Field label={`Working Interest Ownership – FORMATION (table ${wi + 1})`} value={w.formation} onChange={(v) => updateCar((d) => { d.wiTables[wi].formation = v; })} />
                <ObjTable<Record<string, string>> columns={WI_COLS} rows={w.rows as unknown as Record<string, string>[]}
                  blank={() => ({ owner: '', wi: '', nri: '', orri: '' })}
                  onChange={(rows) => updateCar((d) => { d.wiTables[wi].rows = rows as unknown as WiRow[]; })} />
              </div>
            ))}
            <button className="btn-small" onClick={() => updateCar((d) => { d.wiTables.push({ formation: '', rows: [] }); })}>{'+ Add formation table'}</button>
            {car.wiTables.length > 1 && <button className="btn-small" onClick={() => updateCar((d) => { d.wiTables.pop(); })}>{'Remove last formation table'}</button>}

            <h3>{'Leasehold Control and Ownership Summary'}</h3>
            {car.parcels.map((p, pi) => (
              <div key={pi} className="sub-block">
                <Field label="Parcel heading (blank when only one parcel)" value={p.label} onChange={(v) => updateCar((d) => { d.parcels[pi].label = v; })} />
                <ObjTable<Record<string, string>> columns={OWNER_COLS} rows={p.owners as unknown as Record<string, string>[]}
                  blank={() => blankOwner() as unknown as Record<string, string>}
                  onChange={(rows) => updateCar((d) => { d.parcels[pi].owners = rows as unknown as CarOwnerRow[]; })} />
              </div>
            ))}
          </Section>

          <Section title="Leasehold Amendments / Assignment Chain / ORRI" open={false}>
            <label>{'Amendments/Ratifications to Lease'}</label>
            <RowsTable headers={['Lessor/Grantor', 'Lessee/Grantee', 'Date of Instr.', 'Recording', 'Date Recorded', 'Term', 'Explanation of Modified Terms']} wide={[6]}
              rows={car.amendments} onChange={(r) => updateCar((d) => { d.amendments = r; })} />
            <label>{'Assignment Chain'}</label>
            <RowsTable headers={['Assignor', 'Assignee', 'Date of Instr.', 'Recording', 'Date Recorded', 'Term', 'Formations Assigned', 'ORRI Reserved', 'Pugh', 'Other Restrictions']}
              rows={car.assignments} onChange={(r) => updateCar((d) => { d.assignments = r; })} />
            <label>{'ORRI Ownership In Lease'}</label>
            <RowsTable headers={['Current Owner', 'ORRI', 'Formations Subject to ORRI', 'Instrument Creating ORRI', 'Instrument Vesting ORRI']}
              rows={car.orri} onChange={(r) => updateCar((d) => { d.orri = r; })} />
          </Section>

          <Section title="Unitization & Well Information" open={false}>
            <label>{'Existing Units/Pools'}</label>
            <RowsTable headers={['Book/Page', 'Date Formed', 'Declarant', 'Unit Name', 'Acreage Contributed', 'Total Acreage', 'Depths Unitized']}
              rows={car.units} onChange={(r) => updateCar((d) => { d.units = r; })} />
            <div className="grid-2">
              <Field label="Most Recent Date Checked" value={car.wellDateChecked} onChange={(v) => updateCar((d) => { d.wellDateChecked = v; })} />
              <Field label="Lease-wide Gaps" value={car.leaseWideGaps} onChange={(v) => updateCar((d) => { d.leaseWideGaps = v; })} />
            </div>
            <label>{'Well History'}</label>
            <RowsTable headers={['Well API#', 'Associated Lease', 'Associated Lease Acreage', 'Associated Unit', 'Well Completion Date', 'Well Status', 'Gaps in Production / Notes']} wide={[6]}
              emptyHint="No wells — the table prints blank" rows={car.wells} onChange={(r) => updateCar((d) => { d.wells = r; })} />
          </Section>

          <Section title="Outsales & Encumbrances" open={false}>
            <label>{'Outsales Prior to Lease'}</label>
            <RowsTable headers={['Book/Page', 'Acres', 'Date', 'Grantee', 'Located (Yes/No)', 'Separate T/O #']}
              rows={car.outsales} onChange={(r) => updateCar((d) => { d.outsales = r; })} />
            <label>{'Liens/Encumbrances/Judgments'}</label>
            <RowsTable headers={['Instrument Number', 'Date', 'Parties Involved', 'Amount', 'Released (Yes/No)', 'Release Instrument']} wide={[2]}
              rows={car.liens} onChange={(r) => updateCar((d) => { d.liens = r; })} />
            <div className="grid-2">
              <Field textarea rows={2} label="Is O&G in place fully assessed?" value={car.taxFullyAssessed} onChange={(v) => updateCar((d) => { d.taxFullyAssessed = v; })} />
              <Field textarea rows={2} label="Any assessments listed as delinquent?" value={car.taxDelinquent} onChange={(v) => updateCar((d) => { d.taxDelinquent = v; })} />
            </div>
            <label>{'Unassessed Interests'}</label>
            <RowsTable headers={['Owner Name', 'TMP', 'Property Acreage', 'Unassessed Interest']} rows={car.unassessed} onChange={(r) => updateCar((d) => { d.unassessed = r; })} />
            <label>{'Delinquent Interests'}</label>
            <RowsTable headers={['Owner Name', 'Property Assessment', 'Year(s) taxes delinquent', 'Sold (Yes/No)']} rows={car.delinquent} onChange={(r) => updateCar((d) => { d.delinquent = r; })} />
            <div className="grid-3">
              <Field label="Internal Contract — Agreement Number" value={car.contracts.agreementNumber} onChange={(v) => updateCar((d) => { d.contracts.agreementNumber = v; })} />
              <Field label="Name" value={car.contracts.name} onChange={(v) => updateCar((d) => { d.contracts.name = v; })} />
              <Field label="Still Valid" value={car.contracts.stillValid} onChange={(v) => updateCar((d) => { d.contracts.stillValid = v; })} />
            </div>
            <div className="grid-2">
              <Field label="Wells Drilled Under Agreement" value={car.contracts.wellsDrilled} onChange={(v) => updateCar((d) => { d.contracts.wellsDrilled = v; })} />
              <Field label="Restrictions that affect operations" value={car.contracts.restrictions} onChange={(v) => updateCar((d) => { d.contracts.restrictions = v; })} />
            </div>
          </Section>

          <Section title="Curative Items and Recommendations"
            note={`${car.curativeBlocks.length} title opinion table(s), ${car.curativeBlocks.reduce((n, b) => n + b.sections.reduce((m, s) => m + s.items.length, 0), 0)} items — oldest opinion first`}>
            {car.curativeBlocks.map((block, bi) => (
              <div key={bi} className="cur-block">
                <div className="sec-head">
                  <strong style={{ whiteSpace: 'nowrap' }}>{`Opinion ${bi + 1}`}</strong>
                  <input type="text" value={block.heading} placeholder="Heading prefix, e.g. 6/25/2026 Bowles Rice - "
                    onChange={(e) => updateCar((d) => { d.curativeBlocks[bi].heading = e.target.value; })} />
                  {bi > 0 && <button className="btn-small" onClick={() => updateCar((d) => { const [b] = d.curativeBlocks.splice(bi, 1); d.curativeBlocks.splice(bi - 1, 0, b); })}>{'↑ Move up'}</button>}
                  {car.curativeBlocks.length > 1 && <button className="btn-small danger" onClick={() => updateCar((d) => { d.curativeBlocks.splice(bi, 1); })}>{'Remove table'}</button>}
                </div>
                {block.sections.map((sec, si) => (
                  <div key={si} className="sub-block">
                    <div className="sec-head">
                      <input type="text" value={sec.title} onChange={(e) => updateCar((d) => { d.curativeBlocks[bi].sections[si].title = e.target.value; })} />
                      <button className="btn-small danger" onClick={() => updateCar((d) => { d.curativeBlocks[bi].sections.splice(si, 1); })}>{'Remove section'}</button>
                    </div>
                    {sec.items.map((it, ii) => (
                      <div key={ii} className="cur-item">
                        <textarea className="cur-defect" rows={6} value={it.defect}
                          onChange={(e) => updateCar((d) => { d.curativeBlocks[bi].sections[si].items[ii].defect = e.target.value; })} />
                        <textarea className="cur-rec" rows={6} value={it.recommendation} placeholder="CNX Recommendation/Status"
                          onChange={(e) => updateCar((d) => { d.curativeBlocks[bi].sections[si].items[ii].recommendation = e.target.value; })} />
                        <button className="btn-small danger" onClick={() => updateCar((d) => { d.curativeBlocks[bi].sections[si].items.splice(ii, 1); })}>{'✕'}</button>
                      </div>
                    ))}
                    <button className="btn-small" onClick={() => updateCar((d) => { d.curativeBlocks[bi].sections[si].items.push({ defect: '', recommendation: '' }); })}>{'+ Add item'}</button>
                  </div>
                ))}
                <button className="btn-small" onClick={() => updateCar((d) => { d.curativeBlocks[bi].sections.push({ title: 'INTERNAL BRINGDOWN ITEMS', items: [] }); })}>{'+ Add section'}</button>
              </div>
            ))}
            <button className="btn-small" onClick={() => updateCar((d) => { d.curativeBlocks.push({ heading: '', sections: [{ title: 'SPECIFIC CURATIVE ACTION ITEMS', items: [] }] }); })}>{'+ Add title opinion table'}</button>
            <Field textarea label="Miscellaneous/Additional Title Notes" value={car.miscNotes} onChange={(v) => updateCar((d) => { d.miscNotes = v; })} />
          </Section>

          <Section title="Review & Approval">
            <div className="grid-2">
              <Field label="Analysis Review Completed (date)" value={car.analysisDate} onChange={(v) => updateCar((d) => { d.analysisDate = v; })} />
              <Field label="Completed By" value={car.analyst} onChange={(v) => updateCar((d) => { d.analyst = v; })} />
            </div>
          </Section>

          </>)}

          <h2>{padOnly ? '3. Review & Edit — Pad Summary' : '4. Review & Edit — Pad Summary'}</h2>
          <Section title="Title-Curative tab">
            <div className="grid-3">
              {TITLE_CURATIVE_COLUMNS.map((c) => (
                <Field key={c.key} textarea={['land', 'thirdParty', 'mapping', 'title', 'notes'].includes(c.key)} rows={4}
                  label={c.header.replace(/\n/g, ' ')} value={(pad.titleCurative[0] as unknown as Record<string, string>)[c.key] || ''}
                  onChange={(v) => updatePad((d) => { (d.titleCurative[0] as unknown as Record<string, string>)[c.key] = v; })} />
              ))}
            </div>
          </Section>

          <Section title="Ownership tab" note={`${pad.ownership.length} owner rows — formula columns (AJ, AK, AO–AT) are filled automatically`}>
            <ObjTable<PadOwnershipRow>
              columns={OWNERSHIP_COLUMNS.filter((c) => !c.formula).map((c) => ({ key: c.col, label: `${c.col} · ${c.header.replace(/\n/g, ' ').trim()}`, wide: ['BA', 'BN', 'I', 'J', 'B'].includes(c.col) }))}
              rows={pad.ownership}
              blank={() => ({})}
              onChange={(rows) => updatePad((d) => { d.ownership = rows; })}
            />
          </Section>

          <h2>{padOnly ? '4. Export' : '5. Export'}</h2>
          <div className="button-group">
            {!padOnly && <button className="btn-export" onClick={exportCar} disabled={isExporting}>{'Download CAR (.docx)'}</button>}
            <button className="btn-export" onClick={exportPad} disabled={isExporting}>{'Download Pad Summary rows (.xlsx)'}</button>
            <button className="btn-demo" onClick={saveSession}>{'Save review session'}</button>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            {'The Pad Summary file uses the same columns as the unit Pad Summary — copy the owner rows (row 22 down) and the Title-Curative row straight into the master. Set B4 (Total Acres in Unit) and column AH (resolved acres in unit) so the NRI formulas calculate.'}
          </div>
        </div>
      )}
    </div>
  );
}
