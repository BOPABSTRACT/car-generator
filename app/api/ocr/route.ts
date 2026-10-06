import { NextRequest, NextResponse } from 'next/server';
import { ocrPdfFromUrl } from '@/lib/docai';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST { url } — OCR a scanned PDF (already uploaded to Vercel Blob) with Google Document AI.
export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });
    const text = await ocrPdfFromUrl(url);
    return NextResponse.json({ text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('OCR error:', message);
    return NextResponse.json({ error: `OCR failed: ${message}` }, { status: 500 });
  }
}
