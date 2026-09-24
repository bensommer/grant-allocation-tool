import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import { formatCents } from '@/domain/money';
import type { GroundingPacket } from './packet';
import type { NarrativeDraft } from './schema';

export async function narrativeDocx(
  packet: GroundingPacket,
  draft: NarrativeDraft,
): Promise<Buffer> {
  const table = new Table({
    rows: [
      new TableRow({
        children: ['Budget line', 'Budget', 'Actual', 'Remaining'].map(
          (s) => new TableCell({ children: [new Paragraph(s)] }),
        ),
      }),
      ...packet.rows.map(
        (r) =>
          new TableRow({
            children: [
              `${r.code} · ${r.name}`,
              formatCents(r.budgetCents),
              formatCents(r.actualCents),
              formatCents(r.remainingCents),
            ].map((s) => new TableCell({ children: [new Paragraph(s)] })),
          }),
      ),
    ],
  });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: packet.grant.name, heading: HeadingLevel.TITLE }),
          new Paragraph(`${packet.period.from} – ${packet.period.to}`),
          ...draft.sections.flatMap((s) => [
            new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ children: [new TextRun(s.body)] }),
          ]),
          new Paragraph({ text: 'Budget vs actual', heading: HeadingLevel.HEADING_2 }),
          table,
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
