import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { buildCarDocx } from '@/lib/car-docx';
import type { CarData } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { car } = (await req.json()) as { car: CarData };
    const template = await fs.readFile(path.join(process.cwd(), 'templates', 'car-template.docx'));
    const buf = await buildCarDocx(template, car);
    const name = `${car.qls || 'CAR'} - CAR - ${(car.analysisDate || '').replace(/\//g, '.')}.docx`;
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${name}"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('export-car error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
