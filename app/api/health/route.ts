/**
 * GET /api/health — reports whether the required env vars are configured (does not call any API).
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const required = {
    anthropic_api_key: Boolean(process.env.ANTHROPIC_API_KEY),
    blob_token: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  };
  const ocr = {
    google_project_number: Boolean(process.env.GOOGLE_CLOUD_PROJECT_NUMBER),
    google_processor_id: Boolean(process.env.GOOGLE_DOCAI_PROCESSOR_ID),
    google_service_account: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64),
  };
  const ok = Object.values(required).every(Boolean);
  return NextResponse.json({
    status: ok ? 'ok' : 'misconfigured',
    model: process.env.CLAUDE_MODEL || 'claude-opus-4-5 (default)',
    required,
    scanned_lease_ocr: ocr,
    note: Object.values(ocr).every(Boolean)
      ? 'OCR for scanned leases is configured.'
      : 'Google Document AI vars missing — scanned (image-only) leases cannot be read. Text-based PDFs still work.',
  });
}
