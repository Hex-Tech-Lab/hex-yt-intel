export const dynamic = 'force-dynamic';

import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { getUserTier } from '@/lib/services/traffic';
import { ERROR_CODES } from '@/lib/error-codes';
import PDFDocument from 'pdfkit';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

/** Tiers permitted to export the FULL report (TOC + all 11 dimensions). */
const FULL_REPORT_TIERS = new Set(['pro', 'enterprise', 'admin']);

/** Sanitize filename to prevent header injection and ensure system compatibility. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:"*?<>|]/g, '_') // Strip path separators and invalid chars
    .replace(/["';\n\r]/g, '')     // Prevent Content-Disposition injection
    .trim()
    .slice(0, 120);              // Constraint for safe header length
}

/** Renders a finished PDFDocument into an attachment Response. */
function finishPdf(doc: PDFKit.PDFDocument, filename: string): Promise<Response> {
  const chunks: Buffer[] = [];
  const safeName = sanitizeFilename(filename);

  return new Promise<Response>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('error', (err) => {
      console.error('[export/pdf] Stream error:', err);
      reject(new Error('PDF generation failed'));
    });
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks);
      resolve(
        new Response(pdf, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${safeName}"`,
          },
        })
      );
    });
    doc.end();
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const errorCode = ERROR_CODES.AUTH_UNAUTHORIZED;
      Sentry.captureMessage('Export: unauthorized', {
        level: 'warning',
        tags: { code: errorCode }
      });
      return NextResponse.json(
        { error: 'Unauthorized', code: errorCode },
        { status: 401 }
      );
    }

    const userId = user.id;
    const searchParams = request.nextUrl.searchParams;
    const format = searchParams.get('format') || 'pdf';
    const scope = searchParams.get('scope') || 'summary';

    const { data: analysis, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !analysis) {
      return NextResponse.json(
        { error: 'Not found', code: ERROR_CODES.NOT_FOUND },
        { status: 404 }
      );
    }

    if (format !== 'pdf') {
      return NextResponse.json(
        { error: 'Unsupported format', code: ERROR_CODES.INVALID_REQUEST_SCHEMA },
        { status: 400 }
      );
    }

    if (scope === 'full') {
      const tier = await getUserTier(userId);
      if (!FULL_REPORT_TIERS.has(tier)) {
        return NextResponse.json(
          {
            error: 'Full report export is available on Pro and above. The executive summary is included on your plan.',
            code: ERROR_CODES.QUOTA_EXCEEDED,
            upgrade: true,
          },
          { status: 402 }
        );
      }
      return exportFullPDF(analysis);
    }

    return exportSummaryPDF(analysis);
  } catch (error) {
    const errorCode = ERROR_CODES.UNHANDLED_EXCEPTION;
    Sentry.captureException(error, {
      tags: { operation: 'export', code: errorCode },
      contexts: { api: { endpoint: '/api/analyses/[id]/export' } }
    });
    return NextResponse.json(
      { error: 'Failed to export analysis', code: errorCode },
      { status: 500 }
    );
  }
}

function drawHeader(doc: PDFKit.PDFDocument, analysis: any, subtitle: string) {
  doc.fontSize(18).font('Helvetica-Bold').fillColor('black').text(analysis.title || 'YouTube Analysis');
  doc.fontSize(10).fillColor('#666666').text(`Channel: ${analysis.channel_title || 'Unknown'}`);
  doc.fontSize(9).fillColor('#06b6d4').text(subtitle);
  doc.fontSize(9).fillColor('#999999').text(`Generated: ${new Date(analysis.created_at).toLocaleString()}`);
  doc.moveDown(0.5);
  doc.fillColor('black').moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown();
}

async function exportSummaryPDF(analysis: any) {
  const doc = new PDFDocument({ margin: 50, bufferPages: true });
  drawHeader(doc, analysis, 'Executive Summary');

  const content: string = analysis.analysis_markdown || '';
  const sections = content.split(/\n(?=#{1,3}\s)/).filter((s) => s.trim().length > 0);
  const MAX_CHARS = 2400;
  let used = 0;

  doc.fontSize(11).font('Helvetica-Bold').text('Overview', { underline: false });
  doc.moveDown(0.3);

  for (const section of sections) {
    if (used >= MAX_CHARS) break;
    const lines = section.split('\n');
    const heading = (lines[0] || '').replace(/^#+\s/, '').trim();
    const body = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim();
    if (!heading && !body) continue;

    if (heading) {
      doc.moveDown(0.4).fontSize(11).font('Helvetica-Bold').fillColor('#0b0e14').text(heading);
    }
    if (body) {
      const remaining = MAX_CHARS - used;
      const snippet = body.length > remaining ? body.slice(0, remaining).trimEnd() + '…' : body;
      doc.fontSize(9.5).font('Helvetica').fillColor('#333333').text(snippet, { align: 'left' });
      used += snippet.length;
    }
  }

  doc.moveDown(1).fontSize(8).fillColor('#999999').font('Helvetica-Oblique')
    .text('This is an executive summary. Upgrade to Pro for the full multi-dimension report.', { align: 'center' });

  return finishPdf(doc, `${analysis.title || 'synthesis'}-summary.pdf`);
}

async function exportFullPDF(analysis: any) {
  const doc = new PDFDocument({ margin: 50, bufferPages: true });
  drawHeader(doc, analysis, 'Full Synthesis Report');

  const content: string = analysis.analysis_markdown || '';
  const sections = content.split(/\n(?=#{1,3}\s)/).filter((s) => s.trim().length > 0);

  doc.fontSize(13).font('Helvetica-Bold').text('Table of Contents');
  doc.moveDown(0.3);
  sections.forEach((section, i) => {
    const heading = (section.split('\n')[0] || '').replace(/^#+\s/, '').trim();
    if (heading) doc.fontSize(10).font('Helvetica').fillColor('#333333').text(`${i + 1}.  ${heading}`);
  });
  doc.addPage();

  const lines = content.split('\n');
  for (const line of lines) {
    if (line.trim() === '') {
      doc.moveDown(0.5);
    } else if (line.startsWith('###')) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('black').text(line.replace(/^#+\s/, ''));
      doc.font('Helvetica');
    } else if (line.startsWith('##')) {
      doc.fontSize(14).font('Helvetica-Bold').fillColor('black').text(line.replace(/^#+\s/, ''));
      doc.font('Helvetica');
    } else if (line.startsWith('#')) {
      doc.fontSize(16).font('Helvetica-Bold').fillColor('black').text(line.replace(/^#+\s/, ''));
      doc.font('Helvetica');
    } else {
      doc.fontSize(10).font('Helvetica').fillColor('#222222').text(line, { align: 'left' });
    }
  }

  return finishPdf(doc, `${analysis.title || 'synthesis'}-full-report.pdf`);
}
