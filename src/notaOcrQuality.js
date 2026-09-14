import { countNotaPriceAnchors, parseNotaText } from './notaOcrParser.js';

export function evaluateNotaExtraction(rawText) {
  const parsed = parseNotaText(rawText);
  const priceAnchors = countNotaPriceAnchors(rawText);
  let score = 0;

  if (/ProdukHargaQtyTotal/i.test(rawText)) {
    score += 8;
  }
  if (/Kode\s*Order\s*:/i.test(rawText)) {
    score += 12;
  }
  if (parsed.nota_order_code) {
    score += 10;
  }
  if (parsed.nota_date) {
    score += 8;
  }
  if (parsed.item_count_detected > 0) {
    score += 22;
  }

  if (priceAnchors > 0) {
    if (parsed.item_count_detected === priceAnchors) {
      score += 35;
    } else if (Math.abs(parsed.item_count_detected - priceAnchors) === 1) {
      score += 12;
    } else {
      score -= 10;
    }
  }

  for (const item of parsed.items) {
    if (item.product_type) {
      score += 6;
    }
    if (item.size_text) {
      score += 2;
    }
    if (item.file_name_hint) {
      score += 3;
    }
    if (item.finishing_text) {
      score += 2;
    }
  }

  if (parsed.item_count_detected === 0 && priceAnchors > 0) {
    score -= 25;
  }

  return {
    score,
    parsed,
    priceAnchors
  };
}

export function pickBetterExtraction(left, right) {
  if (!left) return right;
  if (!right) return left;

  const leftScore = left.parseScore ?? 0;
  const rightScore = right.parseScore ?? 0;

  if (rightScore > leftScore) return right;
  if (leftScore > rightScore) return left;

  if (right.itemCountDetected > left.itemCountDetected) {
    return right;
  }

  return left;
}
