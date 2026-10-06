import { NextRequest, NextResponse } from 'next/server';
import { parseCarDocx } from '@/lib/car-parse';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST multipart (file) — reads a completed CAR .docx back into structured data.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file' }, { status: 400 });
    if (!/\.docx$/i.test((file as File).name || '')) {
      return NextResponse.json({ error: 'Please upload the CAR as a Word .docx file (open a .doc in Word and Save As .docx).' }, { status: 400 });
    }
    const car = await parseCarDocx(Buffer.from(await (file as Blob).arrayBuffer()));
    return NextResponse.json({ car });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not read the CAR: ${message}` }, { status: 500 });
  }
}
