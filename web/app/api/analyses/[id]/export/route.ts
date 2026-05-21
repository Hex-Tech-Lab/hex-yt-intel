import { getAuthSession } from '@/lib/auth/provider-factory';
import { getSupabaseClient } from '@/lib/supabase';
import PDFDocument from 'pdfkit';
import { NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await getAuthSession();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = (session.user as any).id;
  const searchParams = request.nextUrl.searchParams;
  const format = searchParams.get('format') || 'pdf';

  // Fetch analysis
  const supabase = getSupabaseClient();
  const { data: analysis, error } = await supabase
    .from('analyses')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !analysis) {
    return new Response('Not found', { status: 404 });
  }

  if (format === 'pdf') {
    return exportPDF(analysis);
  }

  return new Response('Unsupported format', { status: 400 });
}

async function exportPDF(analysis: any) {
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];

  doc.on('data', (chunk) => chunks.push(chunk));

  return new Promise<Response>((resolve) => {
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks);
      resolve(
        new Response(pdf, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${analysis.title || 'synthesis'}-synthesis.pdf"`,
          },
        })
      );
    });

    // PDF Content
    doc.fontSize(18).font('Helvetica-Bold').text(analysis.title || 'YouTube Analysis', { underline: true });
    doc.fontSize(10).fillColor('#666666').text(`Channel: ${analysis.channel_title || 'Unknown'}`);
    doc.fontSize(10).fillColor('#999999').text(`Generated: ${new Date(analysis.created_at).toLocaleString()}`);
    doc.moveDown();
    doc.fillColor('black');
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // Synthesis content
    const content = analysis.analysis_markdown || '';
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (line.trim() === '') {
        doc.moveDown(0.5);
      } else if (line.startsWith('###')) {
        doc.fontSize(12).font('Helvetica-Bold').text(line.replace(/^#+\s/, ''));
        doc.font('Helvetica');
      } else if (line.startsWith('##')) {
        doc.fontSize(14).font('Helvetica-Bold').text(line.replace(/^#+\s/, ''));
        doc.font('Helvetica');
      } else if (line.startsWith('#')) {
        doc.fontSize(16).font('Helvetica-Bold').text(line.replace(/^#+\s/, ''));
        doc.font('Helvetica');
      } else {
        doc.fontSize(10).font('Helvetica').text(line, { align: 'left' });
      }
    }

    doc.end();
  });
}
