export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { ERROR_CODES } from '@/lib/error-codes';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseClientWithAuth } from '@/lib/supabase';

export const runtime = 'nodejs';

interface PDFGenerationRequest {
  markdown: string;
  title?: string;
  videoId?: string;
  fileName?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Verify authentication before processing
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized', code: ERROR_CODES.AUTH_UNAUTHORIZED },
        { status: 401 }
      );
    }

    const body = await request.json() as PDFGenerationRequest;

    if (!body.markdown || typeof body.markdown !== 'string') {
      const errorCode = ERROR_CODES.INVALID_REQUEST_SCHEMA;
      Sentry.captureMessage('PDF generation: missing or invalid markdown', {
        level: 'warning',
        tags: { code: errorCode },
      });
      return NextResponse.json(
        { error: 'Markdown content is required', code: errorCode },
        { status: 400 }
      );
    }

    const title = body.title || 'YouTube Content Analysis';
    // Sanitize fileName: allow only alphanumeric, dots, hyphens, underscores
    const sanitizedFileName = (body.fileName || 'analysis.pdf')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 255); // Limit length to prevent buffer overflow
    const fileName = sanitizedFileName || 'analysis.pdf';

    // Create ReadableStream that feeds PDF chunks as they're generated
    const pdfStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const doc = new PDFDocument({
          bufferPages: true,
        });

        doc.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });

        doc.on('end', () => {
          controller.close();
        });

        doc.on('error', (error: Error) => {
          const errorCode = ERROR_CODES.ANALYSIS_GENERATION_FAILED;
          Sentry.captureException(error, {
            tags: { code: errorCode, operation: 'pdf-generation' },
          });
          controller.error(error);
        });

        // Add title
        doc.fontSize(24).font('Helvetica-Bold').text(title, { align: 'left' });
        doc.moveDown(0.5);

        // Add metadata if available
        if (body.videoId) {
          doc.fontSize(10).font('Helvetica').text(`Video ID: ${body.videoId}`, { align: 'left' });
        }

        doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, { align: 'left' });
        doc.moveDown(1);

        // Add markdown content (simplified: no markdown parsing, just text)
        doc.fontSize(11).font('Helvetica').text(body.markdown, {
          align: 'left',
          width: 500,
        });

        // Finalize PDF
        doc.end();
      }
    });

    return new NextResponse(pdfStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    const errorCode = ERROR_CODES.UNHANDLED_EXCEPTION;
    Sentry.captureException(error, {
      tags: { code: errorCode, operation: 'pdf-route' },
    });

    return NextResponse.json(
      {
        error: 'Failed to generate PDF',
        code: errorCode,
      },
      { status: 500 }
    );
  }
}
