import { NextRequest, NextResponse } from 'next/server';
import { extractChain, extractCore, extractCurative, extractLease, extractOwnership, extractWells, type SourceTexts } from '@/lib/claude';

export const runtime = 'nodejs';
// Vercel Pro allows up to 800s (Hobby is capped at 300s)
export const maxDuration = 800;

// POST { task: 'lease' | 'core' | 'curative-specific' | 'curative-other' | 'ownership' | 'wells' | 'wells-abstract' | 'chain', ... }
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
        if (!sources?.opinion && !sources?.noOpinion) return NextResponse.json({ error: 'No title opinion text' }, { status: 400 });
        return NextResponse.json({ result: await extractCore(sources) });
      case 'curative-specific':
      case 'curative-other':
        if (!sources?.opinion) return NextResponse.json({ error: 'No title opinion text' }, { status: 400 });
        return NextResponse.json({ result: await extractCurative(sources, task === 'curative-specific' ? 'specific' : 'other', body.range) });
      case 'ownership':
        if (!sources?.opinion && !sources?.noOpinion) return NextResponse.json({ error: 'No title opinion text' }, { status: 400 });
        return NextResponse.json({ result: await extractOwnership(sources) });
      case 'wells':
        if (!sources?.opinion) return NextResponse.json({ error: 'No title opinion text' }, { status: 400 });
        return NextResponse.json({ result: await extractWells(sources, 'opinions') });
      case 'wells-abstract':
        if (!sources) return NextResponse.json({ error: 'No sources' }, { status: 400 });
        return NextResponse.json({ result: await extractWells(sources, 'abstract') });
      case 'chain':
        if (!sources?.opinion && !sources?.noOpinion) return NextResponse.json({ error: 'No title opinion text' }, { status: 400 });
        return NextResponse.json({ result: await extractChain(sources) });
      default:
        return NextResponse.json({ error: `Unknown task ${task}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.error('analyze error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
