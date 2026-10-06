# CAR & Pad Summary Generator

Internal tool for **BOP Abstract** that drafts the CNX **Curative Action Report (CAR)** and the **Pad Summary** rows for a title from:

- Title Opinion (PDF) — required
- Title Mapping Curative (PDF)
- Internal Bringdown (.doc / .docx / PDF)
- Abstract of Title (PDF) — well info fallback
- Long-form lease(s) (PDF)

Built on the same structure and look as the Run Sheet Generator (Next.js 14, Vercel, BOP2026 password, Claude for extraction, Google Document AI OCR for scanned files).

## Outputs

| Output | How |
|---|---|
| `QLS - CAR - M.D.YYYY.docx` | Fills `templates/car-template.docx` (NEW CAR FORM – 2023). AI-written recommendations are red. |
| `QLS - Pad Summary Rows.xlsx` | Ownership (A–BR, header row 21, data from row 22) and Title-Curative tabs in the exact layout of the unit Pad Summary, with the AJ/AK/AO–AT formulas. |

## How it works

```
Browser: pdf.js reads text from PDFs (nothing uploaded)  ──►  scanned PDFs only → Vercel Blob → /api/ocr (Document AI)
         .doc/.docx bringdown → /api/doc-text
         │
         ▼
/api/analyze  task=lease (one per lease, parallel)
              then in parallel: core | curative-specific | curative-other | ownership
         │
         ▼
lib/assemble.ts → editable review screen → /api/export-car (.docx) + /api/export-pad (.xlsx)
```

## Files

```
app/page.tsx                 form, pipeline, review screen
app/ui.tsx                   editable tables / sections
app/api/analyze              Claude tasks
app/api/ocr                  Document AI OCR (scanned leases)
app/api/doc-text             Word .doc/.docx → text
app/api/export-car           Word CAR
app/api/export-pad           Pad Summary xlsx
lib/claude.ts                prompts (CNX analyst conventions live here)
lib/assemble.ts              AI results → CAR + Pad Summary
lib/car-docx.ts, docx-xml.ts Word template filler
lib/pad-xlsx.ts, pad-columns.ts  Pad Summary writer + column map
lib/pdf-text.ts, text-clean.ts   browser PDF text + header stripping
templates/car-template.docx  the CAR form
public/user-guide.html
```

## Environment variables (Vercel → Settings → Environment Variables)

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | same key as the Run Sheet Generator |
| `BLOB_READ_WRITE_TOKEN` | yes | created automatically when a Blob store is connected to the project |
| `GOOGLE_CLOUD_PROJECT_NUMBER`, `GOOGLE_DOCAI_PROCESSOR_ID`, `GOOGLE_DOCAI_LOCATION`, `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` | for scanned leases | copy from the Run Sheet Generator project |
| `CLAUDE_MODEL` | no | default `claude-opus-4-5` |
| `CLAUDE_MAX_TOKENS` | no | default 32000 — raise for titles with several hundred owners |

`/api/health` shows which are set.

## Vercel plan

`/api/analyze` runs up to 300 seconds (`maxDuration = 300`), which needs Vercel Pro (or Hobby with Fluid Compute).

## Changing the CAR form

Replace `templates/car-template.docx`. The filler finds tables by their heading text (e.g. "Title Opinion QLS #", "Liens/Encumbrances/Judgments", "Title Defects and Analysis"), so keep those headings.
