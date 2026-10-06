import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WordExtractor = require('word-extractor');

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST multipart (file) — returns plain text from a Word .doc or .docx (used for the internal bringdown).
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file' }, { status: 400 });
    const buf = Buffer.from(await (file as Blob).arrayBuffer());
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buf);
    const text = [doc.getHeaders?.({ includeFooters: false }) || '', doc.getBody() || '']
      .join('\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return NextResponse.json({ text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not read Word file: ${message}` }, { status: 500 });
  }
}
