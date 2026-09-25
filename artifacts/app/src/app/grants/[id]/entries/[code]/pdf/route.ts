import { entryTable } from '@/reports/correcting-entry';
import { pdfDocument, pdfErrorResponse, pdfResponse } from '@/reports/pdf';
import { loadEntryExport } from '../load';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  const { id, code } = await params;
  const entry = await loadEntryExport(id, code);
  if (!entry) return new Response('Correcting entry not found', { status: 404 });
  const table = entryTable(entry);
  try {
    const buf = await pdfDocument({
      title: table.title,
      parameters: table.parameters,
      sections: [
        {
          paragraphs: [
            'Draft for posting in QuickBooks Online. Post the journal entry with this code in its memo, then re-import the grant export; the draft is marked posted automatically.',
          ],
          table: { ...table, colAlign: ['right', 'left', 'left', 'left', 'left', 'left', 'right', 'right'] },
        },
      ],
    });
    return pdfResponse(buf, `${entry.code}.pdf`);
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
