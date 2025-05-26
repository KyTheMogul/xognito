import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { fetchDeepSeekResponseStream } from '../../../lib/ai';

export async function POST(request: Request) {
  try {
    const { content } = await request.json();

    // Use AI to format the content
    let formattedContent = '';
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      {
        role: 'system' as const,
        content: `You are a document formatting assistant. Your task is to format the given content into a well-structured document. Follow these rules:
1. Create a clear title based on the content
2. Organize the content into sections with appropriate headings
3. Format lists and paragraphs properly
4. Add any necessary context or explanations
5. Keep the formatting clean and professional`
      },
      {
        role: 'user' as const,
        content: `Please format this content into a well-structured document:\n${content}`
      }
    ];

    await fetchDeepSeekResponseStream(messages, (chunk: string) => {
      formattedContent += chunk;
    });

    // Parse the AI response to extract title and content
    const titleMatch = formattedContent.match(/^# (.+)$/m);
    const title = titleMatch ? titleMatch[1] : 'Generated Document';
    const bodyContent = formattedContent.replace(/^# .+$/m, '').trim();

    // Create a new PDF document
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];

    // Collect PDF chunks
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    // Add content to PDF
    doc.fontSize(24).text(title, { align: 'center' });
    doc.moveDown();

    // Process the content line by line
    const lines = bodyContent.split('\n');
    for (const line of lines) {
      if (line.startsWith('## ')) {
        // Section heading
        doc.moveDown();
        doc.fontSize(16).text(line.replace('## ', ''), { underline: true });
        doc.moveDown(0.5);
      } else if (line.startsWith('- ')) {
        // List item
        doc.fontSize(12).text('• ' + line.replace('- ', ''), { indent: 20 });
      } else if (line.trim() === '') {
        // Empty line
        doc.moveDown();
      } else {
        // Regular paragraph
        doc.fontSize(12).text(line);
      }
    }

    // Finalize PDF
    doc.end();

    // Combine chunks into a single buffer
    const pdfBuffer = Buffer.concat(chunks);

    // Convert to base64
    const base64PDF = pdfBuffer.toString('base64');

    return NextResponse.json({ pdf: base64PDF });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
} 