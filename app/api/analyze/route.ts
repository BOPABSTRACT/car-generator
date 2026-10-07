import { NextRequest, NextResponse } from 'next/server';
import { extractCore, extractCurative, extractLease, extractOwnership, extractWells, type SourceTexts } from '@/lib/claude';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST { task: 'lease' | 'core' | 'curative-specific' | 'curative-other' | 'ownership' | 'wells', ... }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { task } = body as { task: string };
    const sources = body.sources as SourceTexts | undefined;

    switch (task) {
      case 'lease': {
        const { text, filename, reviewDate } = body;
        if (!text) return NextResponse.json({ error: 'No lease text' }, { status: 400 });
        return NextResponse.json({ result: await extractLease(text, filename || 'lease.pdf', reviewDate || '') });
      }
      case 'core':
        if (!sources?.opinion) return NextResponse.json({ error: 'No title opinion text' }, { status: 400 });
        return NextResponse.json({ result: await extractCore(sources) });
      case 'curative-specific':
      case 'curative-other':
        if (!sources?.opinion) return NextResponse.json({ error: 'No title opinion text' }, { status: 400 });
        return NextResponse.json({ result: await extractCurative(sources, task === 'curative-specific' ? 'specific' : 'other') });
      case 'ownership':
        if (!sources?.opinion) return NextResponse.json({ error: 'No title opinion text' }, { status: 400 });
        return NextResponse.json({ result: await extractOwnership(sources) });
      case 'wells':
        if (!sources?.opinion) return NextResponse.json({ error: 'No title opinion text' }, { status: 400 });
        return NextResponse.json({ result: await extractWells(sources) });
      default:
        return NextResponse.json({ error: `Unknown task ${task}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.error('analyze error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
