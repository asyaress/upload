import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNotaText } from './notaOcrParser.js';
import { extractNotaText } from './ocrEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const CETAK_LABEL_MULTILINE_FILENAME = `
ProdukHargaQtyTotal
Bahan Spanduk Flexi
China 280 gsm
19.200119.200
Ukuran = P : 1,2 m x L : 1 m
Nama File : CCHY Spanduk Rehabilitas
Jembatan DY 25 cq rzky reizky bathara
120x100 1pcs Lobang
Total :19.200
`;

test('parseNotaText merges multiline filename into one item', () => {
  const parsed = parseNotaText(CETAK_LABEL_MULTILINE_FILENAME);

  assert.equal(parsed.item_count_detected, 1);
  assert.match(parsed.items[0].file_name_hint, /Jembatan DY 25/i);
  assert.match(parsed.items[0].file_name_hint, /120x100/i);
  assert.equal(parsed.items[0].product_type, 'Bahan Spanduk Flexi China 280 gsm');
});

test('parseNotaText keeps separate items when second product block follows filename', () => {
  const parsed = parseNotaText(`
ProdukHargaQtyTotal
Bahan Spanduk Flexi
China 280 gsm
24.000124.000
Ukuran = P : 1,2 m x L : 0,8 m
Nama File : Uk 80x120 =1 lbr lebihan
Bahan Spanduk Flexi
China 280 gsm
75.000175.000
Ukuran = P : 1,5 m x L : 2,5 m
Nama File : Uk 250x150 =1lbr lebihan
Total :99.000
`);

  assert.equal(parsed.item_count_detected, 2);
  assert.equal(parsed.items[0].file_name_hint, 'Uk 80x120 =1 lbr lebihan');
  assert.equal(parsed.items[1].file_name_hint, 'Uk 250x150 =1lbr lebihan');
});

test('parseNotaText parses order code before date hyphen', () => {
  const parsed = parseNotaText('Kode Order:ON20260914047514-09-2026 17:14\nProdukHargaQtyTotal\nTotal :0');
  assert.equal(parsed.nota_order_code, 'ON20260914047514');
  assert.equal(parsed.nota_date, '2026-09-14');
});

async function assertPdfItemCount(relativePath, expectedCount) {
  const pdfPath = path.join(repoRoot, relativePath);
  const extraction = await extractNotaText(pdfPath);
  const parsed = parseNotaText(extraction.text);
  assert.equal(parsed.item_count_detected, expectedCount, `${relativePath} text:\n${extraction.text}`);
}

test('fixture PDFs detect expected item counts', async () => {
  await assertPdfItemCount('Cetak Label1.pdf', 1);
  await assertPdfItemCount('Cetak Label2.pdf', 2);
  await assertPdfItemCount('Cetak Label3.pdf', 3);
});

test('parseNotaText captures finishing metadata on complex nota', async () => {
  const extraction = await extractNotaText('Cetak Label3.pdf');
  const parsed = parseNotaText(extraction.text);

  assert.match(parsed.items[0].finishing_text || '', /Laminating A4/i);
  assert.equal(parsed.items[1].product_type, 'Art Paper 120 gram');
  assert.equal(parsed.items[2].product_type, 'Laminating A3');
});

test('repairNotaExtractedText splits glued product and price lines', async () => {
  const { repairNotaExtractedText } = await import('./notaOcrNormalize.js');
  const repaired = repairNotaExtractedText('Art Paper 120 gram9.00019.000');
  const parsed = parseNotaText(`ProdukHargaQtyTotal\n${repaired}\nTotal :9.000`);

  assert.equal(parsed.item_count_detected, 1);
  assert.equal(parsed.items[0].product_type, 'Art Paper 120 gram');
});

test('repairNotaExtractedText keeps product size tokens like A3 intact', async () => {
  const { repairNotaExtractedText } = await import('./notaOcrNormalize.js');
  const repaired = repairNotaExtractedText('Laminating A310.000110.000');
  const parsed = parseNotaText(`ProdukHargaQtyTotal\n${repaired}\nTotal :10.000`);

  assert.equal(parsed.item_count_detected, 1);
  assert.equal(parsed.items[0].product_type, 'Laminating A3');
});

const SERLI_RESELLER_NOTA = `
Kode Order : ON202609150026 15-09-2026 07:19
Kepada + Serli Desain
Kasir : Sandra Widiya
Produk Harga Qty Total
Mug Putih 18.000 2 36.000
Finishing :
Tambah Kotak Mug: Kotak Mug
Nama File : serli 1 mug.cdr
Total: 36.000
`;

test('parseNotaText reads spaced product rows from OCR nota', () => {
  const parsed = parseNotaText(SERLI_RESELLER_NOTA);

  assert.equal(parsed.item_count_detected, 1);
  assert.equal(parsed.nota_order_code, 'ON202609150026');
  assert.equal(parsed.items[0].product_type, 'Mug Putih');
  assert.equal(parsed.items[0].qty, 2);
  assert.match(parsed.items[0].finishing_text || '', /Kotak Mug/i);
  assert.equal(parsed.items[0].file_name_hint, 'serli 1 mug.cdr');
  assert.ok(parsed.customer_anon_id);
});

test('Downloads Cetak Label.pdf when present', async (t) => {
  const pdfPath = 'd:/Downloads/nota/Cetak Label.pdf';

  try {
    await readFile(pdfPath);
  } catch {
    t.skip('Local Downloads fixture not available');
    return;
  }

  const extraction = await extractNotaText(pdfPath);
  const parsed = parseNotaText(extraction.text);

  assert.equal(parsed.item_count_detected, 1);
  assert.match(parsed.items[0].file_name_hint, /Rehabilitas/i);
  assert.match(parsed.items[0].file_name_hint, /120x100/i);
});
