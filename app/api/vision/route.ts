import { NextRequest, NextResponse } from 'next/server';
import { transcribePages } from '@/lib/claude';

export const runtime = 'nodejs';
// Vercel Pro allows up to 800s (Hobby is capped at 300s)
export const maxDuration = 800;

// POST { filename, images: [{ page, data(base64 jpeg) }] } — Claude reads scanned / handwritten pages.
export async function POST(req: NextRequest) {
  try {
    const { filename, images } = await req.json();
    if (!Array.isArray(images) || !images.length) return NextResponse.json({ error: 'No page images' }, { status: 400 });
    const text = await transcribePages(images, filename || 'document.pdf');
    return NextResponse.json({ text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('vision error:', message);
    return NextResponse.json({ error: `Could not read scanned pages: ${message}` }, { status: 500 });
  }
}
