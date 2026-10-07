'use client';
// Small editable-table building blocks shared by the review screen.

import { useEffect, useState, type ReactNode } from 'react';

export function Field({ label, value, onChange, textarea, rows = 3, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; textarea?: boolean; rows?: number; placeholder?: string;
}) {
  return (
    <div className="form-group">
      <label>{label}</label>
      {textarea
        ? <textarea rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input type="text" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

export function Section({ title, children, open = true, note }: { title: string; children: ReactNode; open?: boolean; note?: string }) {
  return (
    <details className="review-section" open={open}>
      <summary>{title}{note ? <span className="section-note">{note}</span> : null}</summary>
      <div className="review-body">{children}</div>
    </details>
  );
}

/** Editable grid for string[][] rows (CAR tables). */
export function RowsTable({ headers, rows, onChange, wide = [], emptyHint = 'None — leave empty to print N/A' }: {
  headers: string[]; rows: string[][]; onChange: (rows: string[][]) => void; wide?: number[]; emptyHint?: string;
}) {
  const set = (ri: number, ci: number, v: string) => {
    const next = rows.map((r) => [...r]);
    next[ri][ci] = v;
    onChange(next);
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="results-table">
        <thead>
          <tr>
            {headers.map((h) => <th key={h}>{h}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={headers.length + 1} style={{ color: '#6B7280', fontStyle: 'italic', padding: 8 }}>{emptyHint}</td></tr>
          )}
          {rows.map((r, ri) => (
            <tr key={ri}>
              {headers.map((_, ci) => (
                <td key={ci} style={{ minWidth: wide.includes(ci) ? 260 : 110 }}>
                  <textarea rows={2} value={r[ci] ?? ''} onChange={(e) => set(ri, ci, e.target.value)} />
                </td>
              ))}
              <td><button onClick={() => onChange(rows.filter((_, i) => i !== ri))}>{'Delete'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn-small" onClick={() => onChange([...rows, headers.map(() => '')])}>{'+ Add row'}</button>
    </div>
  );
}

export interface ObjColumn { key: string; label: string; wide?: boolean }

/** Editable grid for arrays of objects (owner rows, WI rows, Pad Summary rows). */
export function ObjTable<T extends Record<string, string>>({ columns, rows, onChange, blank }: {
  columns: ObjColumn[]; rows: T[]; onChange: (rows: T[]) => void; blank: () => T;
}) {
  const set = (ri: number, key: string, v: string) => {
    const next = rows.map((r) => ({ ...r }));
    (next[ri] as Record<string, string>)[key] = v;
    onChange(next);
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="results-table">
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} title={c.label}>{c.label}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {columns.map((c) => (
                <td key={c.key} style={{ minWidth: c.wide ? 280 : 110 }}>
                  <textarea rows={2} value={r[c.key] ?? ''} onChange={(e) => set(ri, c.key, e.target.value)} />
                </td>
              ))}
              <td><button onClick={() => onChange(rows.filter((_, i) => i !== ri))}>{'Delete'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn-small" onClick={() => onChange([...rows, blank()])}>{'+ Add row'}</button>
    </div>
  );
}

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';
export interface Step { id: string; label: string; status: StepStatus; detail?: string; started?: number; ended?: number }

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export function StepList({ steps }: { steps: Step[] }) {
  const icon: Record<StepStatus, string> = { pending: '○', running: '◐', done: '✓', error: '✕', skipped: '–' };
  const [now, setNow] = useState(Date.now());
  const anyRunning = steps.some((s) => s.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);
  return (
    <ul className="step-list">
      {steps.map((s) => (
        <li key={s.id} className={`step-${s.status}`}>
          <span className="step-icon">{icon[s.status]}</span>
          <span>{s.label}</span>
          {s.detail ? <span className="step-detail">{s.detail}</span> : null}
          {s.started ? <span className="step-time">{fmt((s.ended || now) - s.started)}</span> : null}
        </li>
      ))}
    </ul>
  );
}
