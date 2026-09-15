import { extractNotaText } from './ocrEngine.js';
import { parseNotaText } from './notaOcrParser.js';

export function formatPreviewItems(items) {
  return items.map((item) => ({
    lineIndex: item.line_index,
    productType: item.product_type,
    qty: item.qty,
    sizeText: item.size_text,
    finishingText: item.finishing_text,
    fileNameHint: item.file_name_hint
  }));
}

export async function previewNotaFromPath(pdfPath) {
  const extraction = await extractNotaText(pdfPath);
  const parsed = parseNotaText(extraction.text);

  if (!parsed.item_count_detected || parsed.item_count_detected < 1) {
    return {
      notaOrderCode: parsed.nota_order_code,
      notaDate: parsed.nota_date,
      itemCount: 0,
      needsManual: true,
      ocrEngine: extraction.engine,
      ocrConfidence: extraction.confidence,
      warning: 'Item tidak terdeteksi otomatis. Atur jumlah item secara manual.',
      items: []
    };
  }

  return {
    notaOrderCode: parsed.nota_order_code,
    notaDate: parsed.nota_date,
    itemCount: parsed.item_count_detected,
    needsManual: false,
    ocrEngine: extraction.engine,
    ocrConfidence: extraction.confidence,
    items: formatPreviewItems(parsed.items)
  };
}
