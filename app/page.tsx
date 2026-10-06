'use client';

import { useState } from 'react';
import { upload } from '@vercel/blob/client';
import { pdfPages } from '@/lib/pdf-text';
import { stripRunningHeaders, joinPages, abstractExcerpt, textCoverage } from '@/lib/text-clean';
import { assemble } from '@/lib/assemble';
import { OWNERSHIP_COLUMNS, TITLE_CURATIVE_COLUMNS } from '@/lib/pad-columns';
import type {
  CarData, PadData, FormInfo, LeaseInfo, CoreExtract, CurativeExtract, OwnershipExtract,
  CarOwnerRow, WiRow, PadOwnershipRow, CuratorItemExtract,
} from '@/lib/types';
import { Field, Section, RowsTable, ObjTable, StepList, type Step, type StepStatus } from './ui';

const LOGO = 'https://i.imgur.com/szjzoxt.png';

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

  const [form, setForm] = useState<FormInfo>({ ...emptyForm });
  const [opinionFile, setOpinionFile] = useState<File | null>(null);
  const [tmcFile, setTmcFile] = useState<File | null>(null);
  const [bringdownFile, setBringdownFile] = useState<File | null>(null);
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
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status, detail: detail ?? s.detail } : s)));
  }

  async function ocrFile(file: File): Promise<string> {
    const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/upload-url' });
    const { text } = await postJson<{ text: string }>('/api/ocr', { url: blob.url });
    return text;
  }

  /** Text of a PDF; falls back to OCR when the PDF has no text layer. */
  async function readPdf(file: File, id: string, mode: 'full' | 'abstract'): Promise<string> {
    stepSet(id, 'running', 'reading text…');
    const pages = await pdfPages(file, (d, t) => stepSet(id, 'running', `page ${d} of ${t}`));
    const cleaned = stripRunningHeaders(pages);
    const text = mode === 'abstract' ? abstractExcerpt(cleaned) : joinPages(cleaned);
    if (text.length < 1500 && textCoverage(pages) < 0.3) {
      if (mode === 'abstract') { stepSet(id, 'done', 'scanned — skipped (abstract is optional)'); return ''; }
      stepSet(id, 'running', 'scanned PDF — running OCR…');
      const ocr = await ocrFile(file);
      stepSet(id, 'done', `${pages.length} pages (OCR)`);
      return ocr;
    }
    stepSet(id, 'done', `${pages.length} pages, ${Math.round(text.length / 1000)}k chars`);
    return text;
  }

  async function readBringdown(file: File): Promise<string> {
    if (/\.pdf$/i.test(file.name)) return readPdf(file, 'bringdown', 'full');
    stepSet('bringdown', 'running', 'reading Word file…');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/doc-text', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Could not read bringdown');
    stepSet('bringdown', 'done', `${Math.round((data.text || '').length / 1000)}k chars`);
    return data.text as string;
  }

  async function generate() {
    if (!opinionFile) { showStatus('Please upload the Title Opinion PDF', 'error'); return; }
    const reviewDate = form.reviewDate || todayMDY();
    const f: FormInfo = { ...form, reviewDate };
    setForm(f);

    const initial: Step[] = [
      { id: 'opinion', label: `Title Opinion — ${opinionFile.name}`, status: 'pending' },
      { id: 'tmc', label: tmcFile ? `Title Mapping Curative — ${tmcFile.name}` : 'Title Mapping Curative (not provided)', status: tmcFile ? 'pending' : 'skipped' },
      { id: 'bringdown', label: bringdownFile ? `Bringdown — ${bringdownFile.name}` : 'Bringdown (not provided)', status: bringdownFile ? 'pending' : 'skipped' },
      { id: 'abstract', label: abstractFile ? `Abstract — ${abstractFile.name}` : 'Abstract (not provided)', status: abstractFile ? 'pending' : 'skipped' },
      ...leaseFiles.map((lf, i) => ({ id: `lease-${i}`, label: `Lease — ${lf.name}`, status: 'pending' as StepStatus })),
      { id: 'core', label: 'Header, leasehold, wells, encumbrances', status: 'pending' },
      { id: 'cur1', label: 'Specific curative items + recommendations', status: 'pending' },
      { id: 'cur2', label: 'General / non-action items, comments & limitations', status: 'pending' },
      { id: 'own', label: 'Owners by parcel (CAR + Pad Summary Ownership)', status: 'pending' },
    ];
    setSteps(initial);
    setIsProcessing(true);
    setCar(null);
    setPad(null);
    setReviewNotes([]);
    showStatus('Reading documents in your browser…', 'info');

    try {
      // 1. text — runs in the browser; only scanned PDFs are uploaded for OCR
      const [opinion, tmc, bringdown, abstract] = await Promise.all([
        readPdf(opinionFile, 'opinion', 'full'),
        tmcFile ? readPdf(tmcFile, 'tmc', 'full').catch((e) => { stepSet('tmc', 'error', e.message); return ''; }) : Promise.resolve(''),
        bringdownFile ? readBringdown(bringdownFile).catch((e) => { stepSet('bringdown', 'error', e.message); return ''; }) : Promise.resolve(''),
        abstractFile ? readPdf(abstractFile, 'abstract', 'abstract').catch((e) => { stepSet('abstract', 'error', e.message); return ''; }) : Promise.resolve(''),
      ]);

      // 2. leases (parallel)
      showStatus('Analyzing leases…', 'info');
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
      const leases = leaseResults.filter(Boolean) as LeaseInfo[];

      // 3. CAR + Pad analysis (parallel)
      showStatus('Building the CAR and Pad Summary (this usually takes 2–4 minutes)…', 'info');
      const sources = { opinion, tmc, bringdown, abstract, leases, reviewDate };
      const run = async <T,>(id: string, task: string): Promise<T> => {
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
      const settled = await Promise.allSettled([
        run<CoreExtract>('core', 'core'),
        run<CurativeExtract>('cur1', 'curative-specific'),
        run<CurativeExtract>('cur2', 'curative-other'),
        run<OwnershipExtract>('own', 'ownership'),
      ]);
      const val = <T,>(i: number): T | null => (settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<T>).value : null);
      const core = val<CoreExtract>(0);
      const cur1 = val<CurativeExtract>(1);
      const cur2 = val<CurativeExtract>(2);
      const own = val<OwnershipExtract>(3);
      if (!core) throw new Error('The header/leasehold step failed — see the error above and try again.');

      const items: CuratorItemExtract[] = [...(cur1?.items || []), ...(cur2?.items || [])];
      const built = assemble({
        form: f,
        core,
        curativeItems: items,
        curativeHeading: cur1?.heading || cur2?.heading,
        miscNotes: cur2?.misc_notes,
        ownership: own || { parcels: [], owners: [], title_notes: '' },
        leases,
      });
      setCar(built.car);
      setPad(built.pad);
      const notes = [core.notes_for_reviewer, ...leases.map((l) => l.notes_for_reviewer ? `${l.source_file}: ${l.notes_for_reviewer}` : '')]
        .filter((n) => n && n.trim());
      setReviewNotes(notes);
      const failed = settled.filter((s) => s.status === 'rejected').length;
      showStatus(failed
        ? `Done with ${failed} step(s) failing — those sections are empty. Review below, fill gaps, then export.`
        : 'Done. Review and edit everything below (red text in the CAR = analyst entries), then export.', failed ? 'info' : 'success');
    } catch (e) {
      showStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setIsProcessing(false);
    }
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
    const blob = new Blob([JSON.stringify({ form, car, pad }, null, 1)], { type: 'application/json' });
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
      if (data.form) setForm({ ...emptyForm, ...data.form });
      if (data.car) setCar(data.car);
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

  const done = steps.filter((s) => ['done', 'error', 'skipped'].includes(s.status)).length;

  return (
    <div className="container">
      <a href="/user-guide.html" target="_blank" rel="noopener noreferrer" className="help-btn">User Guide</a>
      <h1>{'Curative Action Report & Pad Summary Generator'}</h1>

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
      <div className="grid-2">
        <div className="form-group">
          <label>{'Title Opinion (PDF) *'}</label>
          <input type="file" accept=".pdf" onChange={(e) => setOpinionFile(e.target.files?.[0] || null)} />
          <div className="hint">{'Main source for almost every section of the CAR.'}</div>
        </div>
        <div className="form-group">
          <label>{'Title Mapping Curative (PDF)'}</label>
          <input type="file" accept=".pdf" onChange={(e) => setTmcFile(e.target.files?.[0] || null)} />
          <div className="hint">{'Resolved acreage and survey/acreage clouds.'}</div>
        </div>
        <div className="form-group">
          <label>{'Internal Bringdown (DOC, DOCX or PDF)'}</label>
          <input type="file" accept=".doc,.docx,.pdf" onChange={(e) => setBringdownFile(e.target.files?.[0] || null)} />
          <div className="hint">{'Bringdown row, releases and new instruments after the opinion.'}</div>
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

          <Section title="Curative Summary (page 1)" note="built from the open items below">
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

          <Section title="Curative Items and Recommendations" note={`${car.curativeSections.reduce((n, s) => n + s.items.length, 0)} items`}>
            <Field label="Table heading prefix (opinion date + law firm)" value={car.curativeHeading} onChange={(v) => updateCar((d) => { d.curativeHeading = v; })} />
            {car.curativeSections.map((sec, si) => (
              <div key={si} className="sub-block">
                <div className="sec-head">
                  <input type="text" value={sec.title} onChange={(e) => updateCar((d) => { d.curativeSections[si].title = e.target.value; })} />
                  <button className="btn-small danger" onClick={() => updateCar((d) => { d.curativeSections.splice(si, 1); })}>{'Remove section'}</button>
                </div>
                {sec.items.map((it, ii) => (
                  <div key={ii} className="cur-item">
                    <textarea className="cur-defect" rows={6} value={it.defect}
                      onChange={(e) => updateCar((d) => { d.curativeSections[si].items[ii].defect = e.target.value; })} />
                    <textarea className="cur-rec" rows={6} value={it.recommendation} placeholder="CNX Recommendation/Status"
                      onChange={(e) => updateCar((d) => { d.curativeSections[si].items[ii].recommendation = e.target.value; })} />
                    <button className="btn-small danger" onClick={() => updateCar((d) => { d.curativeSections[si].items.splice(ii, 1); })}>{'✕'}</button>
                  </div>
                ))}
                <button className="btn-small" onClick={() => updateCar((d) => { d.curativeSections[si].items.push({ defect: '', recommendation: '' }); })}>{'+ Add item'}</button>
              </div>
            ))}
            <button className="btn-small" onClick={() => updateCar((d) => { d.curativeSections.push({ title: 'INTERNAL BRINGDOWN ITEMS', items: [] }); })}>{'+ Add section'}</button>
            <Field textarea label="Miscellaneous/Additional Title Notes" value={car.miscNotes} onChange={(v) => updateCar((d) => { d.miscNotes = v; })} />
          </Section>

          <Section title="Review & Approval">
            <div className="grid-2">
              <Field label="Analysis Review Completed (date)" value={car.analysisDate} onChange={(v) => updateCar((d) => { d.analysisDate = v; })} />
              <Field label="Completed By" value={car.analyst} onChange={(v) => updateCar((d) => { d.analyst = v; })} />
            </div>
          </Section>

          <h2>{'4. Review & Edit — Pad Summary'}</h2>
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

          <h2>{'5. Export'}</h2>
          <div className="button-group">
            <button className="btn-export" onClick={exportCar} disabled={isExporting}>{'Download CAR (.docx)'}</button>
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
