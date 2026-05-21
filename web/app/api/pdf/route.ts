export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { ERROR_CODES } from '@/lib/error-codes';
import * as Sentry from '@sentry/nextjs';
import { getAuthSession } from '@/lib/auth/provider-factory';

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
    const session = await getAuthSession();
    if (!session || !session.user?.id) {
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

    // Create PDF document in memory
    const doc = new PDFDocument({
      bufferPages: true,
    });

    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
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

    // Wait for all data to be written
    return new Promise<NextResponse>((resolve) => {
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);

        const response = new NextResponse(pdfBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': pdfBuffer.length.toString(),
          },
        });

        resolve(response);
      });

      doc.on('error', (error: Error) => {
        const errorCode = ERROR_CODES.ANALYSIS_GENERATION_FAILED;
        Sentry.captureException(error, {
          tags: { code: errorCode, operation: 'pdf-generation' },
        });
        resolve(
          NextResponse.json(
            { error: 'PDF generation failed', code: errorCode },
            { status: 500 }
          )
        );
      });
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
