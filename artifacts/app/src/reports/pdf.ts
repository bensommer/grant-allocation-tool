import PDFDocument from 'pdfkit';
import type { ExportTable, TableCell } from './table-export';

export type PdfRowKind = 'row' | 'group' | 'subtotal';
export type PdfTable = ExportTable & {
  colAlign?: ('left' | 'right')[];
  /** Per-row styling parallel to `rows`; group headings and subtotals render bold. */
  rowKinds?: PdfRowKind[];
  /** Explicit totals row; use when `rows` already contain subtotals that must not be re-summed. */
  totals?: TableCell[];
};
export interface PdfSection {
  heading?: string;
  paragraphs?: string[];
  table?: PdfTable;
}

export class RowLimitExceeded extends Error {
  constructor() {
    super('PDF exports are limited to 20,000 table rows. Use the CSV/XLSX export instead.');
    this.name = 'RowLimitExceeded';
  }
}

export function pdfErrorResponse(error: unknown): Response {
  if (error instanceof RowLimitExceeded)
    return new Response(error.message, {
      status: 413,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  throw error;
}

const money = (cents: number) =>
  cents === 0
    ? '—'
    : `${cents < 0 ? '(' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}${cents < 0 ? ')' : ''}`;

export function pdfResponse(buffer: Buffer, filename: string): Response {
  return new Response(
    new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength),
    {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    },
  );
}

export async function pdfDocument({
  title,
  subtitle,
  parameters,
  sections,
  portrait = false,
}: {
  title: string;
  subtitle?: string;
  parameters: Record<string, string>;
  sections: PdfSection[];
  portrait?: boolean;
}): Promise<Buffer> {
  if (sections.reduce((sum, section) => sum + (section.table?.rows.length ?? 0), 0) > 20_000)
    throw new RowLimitExceeded();
  const doc = new PDFDocument({
    size: 'LETTER',
    layout: portrait ? 'portrait' : 'landscape',
    margin: 42,
    bufferPages: true,
    autoFirstPage: true,
    info: { Title: title },
  });
  const parts: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => parts.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.on('error', reject);
  });
  const left = 42;
  const width = doc.page.width - 84;
  const bottom = doc.page.height - 65;
  let y = 42;
  const nextPage = () => {
    doc.addPage();
    y = 42;
  };
  const room = (height: number) => {
    if (y + height > bottom) nextPage();
  };
  doc.font('Helvetica-Bold').fontSize(17).text(title, left, y, { width });
  y = doc.y + 5;
  if (subtitle) {
    doc.font('Helvetica').fontSize(10).text(subtitle, left, y, { width });
    y = doc.y + 4;
  }
  const meta = Object.entries(parameters)
    .map(([key, value]) => `${key}: ${value}`)
    .join('   ·   ');
  if (meta) {
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(meta, left, y, { width });
    y = doc.y + 4;
  }
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#475569')
    .text(`Generated at ${new Date().toISOString()}`, left, y, { width });
  y = doc.y + 15;

  for (const section of sections) {
    if (section.heading) {
      room(34);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#172033').text(section.heading, left, y, {
        width,
      });
      y = doc.y + 9;
    }
    for (const paragraph of section.paragraphs ?? []) {
      for (const block of paragraph.split(/\n\s*\n/)) {
        doc.font('Helvetica').fontSize(10).fillColor('#172033');
        const h = doc.heightOfString(block, { width, lineGap: 3 });
        room(Math.min(h + 10, bottom - 42));
        doc.text(block, left, y, { width, lineGap: 3 });
        y = doc.y + 10;
      }
    }
    const table = section.table;
    if (!table) continue;
    const count = table.headers.length;
    if (!count) continue;
    const display = (cell: TableCell) =>
      typeof cell === 'number' ? money(cell) : (cell ?? '').toString();
    const minWidth = 34; // 5pt padding on each side plus at least 24pt of text
    const labelWidth = Math.min(110, width - minWidth);
    const perGroup = Math.max(1, Math.floor((width - labelWidth) / minWidth));
    const groups: number[][] =
      count <= 1
        ? [[0]]
        : Array.from({ length: Math.ceil((count - 1) / perGroup) }, (_, i) => [
            0,
            ...Array.from(
              { length: Math.min(perGroup, count - 1 - i * perGroup) },
              (_, j) => 1 + i * perGroup + j,
            ),
          ]);
    const totals: TableCell[] = table.totals ?? table.headers.map(() => '');
    if (!table.totals) {
      totals[0] = 'Total';
      for (const i of table.sumColumns ?? [])
        totals[i] = table.rows.reduce(
          (sum, row) => sum + (typeof row[i] === 'number' ? row[i] : 0),
          0,
        );
    }

    for (const [groupIndex, columns] of groups.entries()) {
      if (groupIndex) nextPage();
      const weights = columns.map((column) => {
        const samples = [
          table.headers[column]!,
          ...table.rows.slice(0, 80).map((row) => display(row[column] ?? null)),
        ];
        return Math.max(
          11,
          Math.min(35, Math.max(...samples.map((s) => Math.min(s.length, 35))) + 2),
        );
      });
      const bases = columns.map((_, i) => (i === 0 && columns.length > 1 ? labelWidth : minWidth));
      const spare = width - bases.reduce((a, b) => a + b, 0);
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((weight, i) => bases[i]! + (spare * weight) / totalWeight);
      const positions = widths.map((_, i) => left + widths.slice(0, i).reduce((a, b) => a + b, 0));
      const header = columns.map((i) => table.headers[i]!);
      const lineHeight = 12;

      // Wrap by glyph width, including words with no spaces. Explicitly paginating
      // wrapped lines preserves even cells taller than an entire sheet.
      const wrap = (text: string, cellWidth: number): string[] => {
        const lines: string[] = [];
        for (const input of text.split('\n')) {
          let line = '';
          for (const char of input) {
            if (line && doc.widthOfString(line + char) > cellWidth) {
              lines.push(line);
              line = '';
            }
            line += char;
          }
          lines.push(line);
        }
        return lines;
      };
      const drawHeader = () => {
        const h = Math.max(
          19,
          ...header.map((s, i) => wrap(s, widths[i]! - 10).length * lineHeight + 8),
        );
        doc.rect(left, y, width, h).fill('#e9eef5');
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#172033');
        header.forEach((s, i) =>
          doc.text(s, positions[i]! + 5, y + 4, {
            width: widths[i]! - 10,
            height: h - 6,
            lineGap: 2,
          }),
        );
        y += h;
      };
      const drawRow = (cells: TableCell[], kind: PdfRowKind | 'total' = 'row') => {
        const bold = kind !== 'row';
        const total = kind === 'subtotal' || kind === 'total';
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        const lines = columns.map((i, j) => wrap(display(cells[i] ?? null), widths[j]! - 10));
        const fullHeight = Math.max(19, ...lines.map((list) => list.length * lineHeight + 8));
        if (y + fullHeight > bottom && y > 42 + 19) {
          nextPage();
          drawHeader();
        }
        let offset = 0;
        const lineCount = Math.max(...lines.map((list) => list.length));
        do {
          const capacity = Math.max(1, Math.floor((bottom - y - 8) / lineHeight));
          const taken = Math.min(capacity, lineCount - offset);
          const height = Math.max(19, taken * lineHeight + 8);
          if (total) doc.rect(left, y, width, height).fill('#f0f4f8');
          doc
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(8)
            .fillColor('#172033');
          lines.forEach((list, j) => {
            const text = list.slice(offset, offset + taken).join('\n');
            if (!text) return;
            const column = columns[j]!;
            doc.text(text, positions[j]! + 5, y + 4, {
              width: widths[j]! - 10,
              height: height - 6,
              align:
                table.colAlign?.[column] ?? (typeof cells[column] === 'number' ? 'right' : 'left'),
              lineGap: 2,
            });
          });
          y += height;
          doc
            .strokeColor('#d7dee7')
            .lineWidth(0.5)
            .moveTo(left, y)
            .lineTo(left + width, y)
            .stroke();
          offset += taken;
          if (offset < lineCount) {
            nextPage();
            drawHeader();
          }
        } while (offset < lineCount);
      };
      room(30);
      doc.font('Helvetica-Bold').fontSize(8);
      drawHeader();
      table.rows.forEach((row, i) => drawRow(row, table.rowKinds?.[i] ?? 'row'));
      if (table.totals || table.sumColumns?.length) drawRow(totals, 'total');
      y += 17;
    }
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#475569')
      .text(`Page ${i + 1} of ${pages.count}`, left, doc.page.height - 55, {
        width: doc.page.width - 84,
        align: 'right',
      });
  }
  doc.end();
  return done;
}
