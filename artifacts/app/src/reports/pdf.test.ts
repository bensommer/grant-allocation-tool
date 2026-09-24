import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pdfDocument, pdfErrorResponse, RowLimitExceeded } from './pdf';

function extractedText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-test-'));
  try {
    const file = join(dir, 'report.pdf');
    writeFileSync(file, pdf);
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pages = (pdf: Buffer) => [...pdf.toString('latin1').matchAll(/\/Type \/Page\b/g)].length;

describe('pdfDocument', () => {
  it('renders a non-empty PDF with a table', async () => {
    const pdf = await pdfDocument({
      title: 'Test report',
      parameters: { 'As of': '2026-03-31' },
      sections: [
        {
          table: {
            title: 'Test',
            parameters: {},
            headers: ['Line', 'Amount'],
            rows: [
              ['Services', 123456],
              ['Refund', -123],
            ],
            sumColumns: [1],
          },
        },
      ],
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('rejects more than 20,000 table rows with an actionable 413', async () => {
    const sections = [
      {
        table: {
          title: 'Large',
          parameters: {},
          headers: ['Name'],
          rows: Array.from({ length: 20_001 }, () => ['row']),
        },
      },
    ];
    await expect(pdfDocument({ title: 'Large', parameters: {}, sections })).rejects.toBeInstanceOf(
      RowLimitExceeded,
    );
    const response = pdfErrorResponse(new RowLimitExceeded());
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('CSV/XLSX');
  });

  it('groups more than 200 columns into readable pages', async () => {
    const pdf = await pdfDocument({
      title: 'Wide',
      parameters: {},
      sections: [
        {
          table: {
            title: 'Wide',
            parameters: {},
            headers: ['Label', ...Array.from({ length: 205 }, (_, i) => `Column ${i}`)],
            rows: [['Visible label', ...Array.from({ length: 205 }, (_, i) => i * 100)]],
          },
        },
      ],
    });
    expect(pages(pdf)).toBeGreaterThan(1);
    const text = extractedText(pdf);
    expect(text).toContain('Column 204');
    expect(text.split('Visible label').length).toBeGreaterThan(2);
  });

  it('paginates 300 rows, with the total after the final data row', async () => {
    const pdf = await pdfDocument({
      title: 'Long',
      parameters: {},
      sections: [
        {
          table: {
            title: 'Long',
            parameters: {},
            headers: ['Name', 'Amount'],
            rows: Array.from({ length: 300 }, (_, i) => [`Line ${i}`, 100]),
            sumColumns: [1],
          },
        },
      ],
    });
    expect(pages(pdf)).toBeGreaterThan(1);
    const text = extractedText(pdf);
    expect(text.lastIndexOf('Total')).toBeGreaterThan(text.lastIndexOf('Line 299'));
  });

  it('continues a 5,000-character cell across pages without losing the next row', async () => {
    const pdf = await pdfDocument({
      title: 'Wrapped',
      parameters: {},
      sections: [
        {
          table: {
            title: 'Wrapped',
            parameters: {},
            headers: ['Name', 'Amount'],
            rows: [
              ['Q'.repeat(5000), 1200],
              ['AFTER-LONG-CELL', 3400],
            ],
          },
        },
      ],
    });
    expect(pages(pdf)).toBeGreaterThan(1);
    const text = extractedText(pdf);
    expect((text.match(/Q/g) ?? []).length).toBe(5000);
    expect(text).toContain('AFTER-LONG-CELL');
  });
});
