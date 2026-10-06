import { NextRequest, NextResponse } from 'next/server';
import { buildPadXlsx } from '@/lib/pad-xlsx';
import type { PadData } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { pad } = (await req.json()) as { pad: PadData };
    const buf = await buildPadXlsx(pad);
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="Pad Summary Rows.xlsx"',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('export-pad error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
