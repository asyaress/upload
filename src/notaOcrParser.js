import crypto from 'node:crypto';
import { config } from './config.js';
import { repairNotaExtractedText } from './notaOcrNormalize.js';

const mashedPricePattern = /^(\d{1,3}(?:\.\d{3})+)(\d)(\d{1,3}(?:\.\d{3})+)$/;

export function anonymizeCustomer(customerName) {
  if (!customerName?.trim()) {
    return null;
  }

  const hash = crypto
    .createHmac('sha256', config.ocr.customerAnonSalt)
    .update(customerName.trim().toLowerCase())
    .digest('hex');

  return `CUST_${hash.slice(0, 12)}`;
}

function normalizeNotaText(rawText) {
  return repairNotaExtractedText(rawText);
}

function isFinishingDetailLine(line) {
  return /^Finishing\s*:/i.test(line)
    || /^Laminating\s*:/i.test(line)
    || /^Finishing:/i.test(line);
}

function parseNotaDate(rawDate) {
  if (!rawDate) return null;

  const match = rawDate.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!match) return null;

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function parseMashedPriceLine(line) {
  const match = line.trim().match(mashedPricePattern);
  if (!match) {
    return { qty: 1, valid: false };
  }

  const unitPrice = parseIndonesianNumber(match[1]);
  if (unitPrice < 1000) {
    return { qty: 1, valid: false };
  }

  return {
    qty: Number.parseInt(match[2], 10) || 1,
    valid: true
  };
}

function isMashedPriceLine(line) {
  return parseMashedPriceLine(line).valid;
}

function parseIndonesianNumber(value) {
  return Number.parseInt(String(value || '').replace(/\./g, ''), 10) || 0;
}

function extractMashedPriceSuffix(line) {
  const matches = [];

  for (let suffixStart = 0; suffixStart < line.length; suffixStart += 1) {
    const suffix = line.slice(suffixStart);
    if (!isMashedPriceLine(suffix)) {
      continue;
    }

    matches.push({
      productPart: line.slice(0, suffixStart).trim(),
      qty: parseMashedPriceLine(suffix).qty,
      suffixLength: suffix.length
    });
  }

  if (!matches.length) {
    return null;
  }

  matches.sort((left, right) => {
    const productLengthDiff = right.productPart.length - left.productPart.length;
    if (productLengthDiff !== 0) {
      return productLengthDiff;
    }

    return right.suffixLength - left.suffixLength;
  });
  return matches[0];
}

const spacedProductRowPattern = /^(.+?)\s+(\d{1,3}(?:\.\d{3})+)\s+(\d{1,4})\s+(\d{1,3}(?:\.\d{3})+)$/;

function parseSpacedProductLine(line) {
  const trimmed = String(line || '').trim();
  const match = trimmed.match(spacedProductRowPattern);
  if (!match) {
    return null;
  }

  const productPart = match[1].trim();
  const unitPrice = parseIndonesianNumber(match[2]);
  const qty = Number.parseInt(match[3], 10) || 1;
  const lineTotal = parseIndonesianNumber(match[4]);

  if (!productPart || !/[A-Za-z]/.test(productPart) || unitPrice < 1000) {
    return null;
  }

  if (lineTotal > 0 && unitPrice > 0) {
    const impliedQty = Math.max(1, Math.round(lineTotal / unitPrice));
    if (Math.abs(impliedQty - qty) > 1) {
      return null;
    }
  }

  return {
    productPart,
    qty
  };
}

function splitEmbeddedPriceLine(line) {
  const trimmed = line.trim();
  const mashedSuffix = extractMashedPriceSuffix(trimmed);

  if (mashedSuffix) {
    return mashedSuffix;
  }

  const twoPriceMatch = trimmed.match(/^(.+?)(\d{1,3}(?:\.\d{3})+)(\d{1,3}(?:\.\d{3})+)$/);
  if (!twoPriceMatch) {
    return null;
  }

  const unitPrice = parseIndonesianNumber(twoPriceMatch[2]);
  const lineTotal = parseIndonesianNumber(twoPriceMatch[3]);
  const qty = unitPrice > 0 ? Math.max(1, Math.round(lineTotal / unitPrice)) : 1;

  return {
    productPart: twoPriceMatch[1].trim(),
    qty
  };
}

function isHeaderOrFooterLine(line) {
  return /^(www\.|Scan QR|Nota Digital|TERIMA KASIH|Silakan Order|Head Office|LUNAS$|"--\s+\d+)/i.test(line)
    || /^"Head Office/i.test(line)
    || /^Cetak Label/i.test(line)
    || /workflow_payment|print_nota|hitps:/i.test(line)
    || /^TOEDJ/i.test(line)
    || /^SINAR\s+GAD/i.test(line);
}

function isFileNameContinuationLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^Total\s*:/i.test(trimmed)) return false;
  if (isMashedPriceLine(trimmed)) return false;
  if (/^Ukuran\s*=/i.test(trimmed)) return false;
  if (/^Nama\s+File\s*:/i.test(trimmed)) return false;
  if (/^Finishing/i.test(trimmed)) return false;
  if (/^ProdukHargaQtyTotal$/i.test(trimmed)) return false;

  // Spesifikasi file yang sering ditulis di baris setelah "Nama File"
  if (/^\d+\s*x\s*\d+/i.test(trimmed)) return true;
  if (/@\d+\s*pcs?/i.test(trimmed)) return true;
  if (/^[\d\s.x@,+/-]+$/i.test(trimmed) && trimmed.length <= 48) return true;

  return false;
}

function looksLikeNewProductBlock(lines, startIndex, maxLookahead = 5) {
  const limit = Math.min(lines.length, startIndex + maxLookahead);

  for (let index = startIndex; index < limit; index += 1) {
    const line = lines[index];
    if (/^Total\s*:/i.test(line)) {
      return false;
    }
    if (/^Nama\s+File\s*:/i.test(line) || /^Ukuran\s*=/i.test(line)) {
      return false;
    }
    if (isMashedPriceLine(line) || parseSpacedProductLine(line)) {
      return true;
    }
  }

  return false;
}

export function extractProductSection(text) {
  const normalized = normalizeNotaText(text);
  const match = normalized.match(/ProdukHargaQtyTotal([\s\S]*?)(?:\nTotal\s*:|$)/i);
  return match?.[1] || '';
}

export function countNotaPriceAnchors(rawText) {
  const lines = extractProductSection(rawText)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let anchors = 0;

  for (const line of lines) {
    if (isMashedPriceLine(line) || splitEmbeddedPriceLine(line) || parseSpacedProductLine(line)) {
      anchors += 1;
    }
  }

  return anchors;
}

function extractItems(section) {
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isHeaderOrFooterLine(line));

  const items = [];
  let index = 0;

  while (index < lines.length) {
    if (/^ProdukHargaQtyTotal$/i.test(lines[index])) {
      index += 1;
      continue;
    }

    if (/^Total\s*:/i.test(lines[index])) {
      break;
    }

    const productLines = [];
    let qty = 1;
    let priceHandled = false;

    const spacedRow = parseSpacedProductLine(lines[index]);
    if (spacedRow) {
      productLines.push(spacedRow.productPart);
      qty = spacedRow.qty;
      priceHandled = true;
      index += 1;
    }

    while (
      !priceHandled
      && index < lines.length
      && !isMashedPriceLine(lines[index])
      && !parseSpacedProductLine(lines[index])
      && !/^Nama\s+File\s*:/i.test(lines[index])
      && !/^Total\s*:/i.test(lines[index])
    ) {
      const embeddedPrice = splitEmbeddedPriceLine(lines[index]);
      if (embeddedPrice) {
        if (embeddedPrice.productPart) {
          productLines.push(embeddedPrice.productPart);
        }
        qty = embeddedPrice.qty;
        priceHandled = true;
        index += 1;
        break;
      }

      if (!/^Finishing\s*:/i.test(lines[index]) && !/^Laminating:/i.test(lines[index]) && !/^Finishing:/i.test(lines[index])) {
        productLines.push(lines[index]);
      }
      index += 1;
    }

    if (!priceHandled && index < lines.length && isMashedPriceLine(lines[index])) {
      qty = parseMashedPriceLine(lines[index]).qty;
      index += 1;
    }

    let sizeText = null;
    let finishingText = null;
    const finishingParts = [];
    while (
      index < lines.length
      && !isMashedPriceLine(lines[index])
      && !/^Nama\s+File\s*:/i.test(lines[index])
      && !/^Total\s*:/i.test(lines[index])
      && !splitEmbeddedPriceLine(lines[index])
      && !parseSpacedProductLine(lines[index])
    ) {
      if (/^Ukuran\s*=/i.test(lines[index])) {
        sizeText = lines[index].replace(/^Ukuran\s*=\s*/i, '').trim();
      } else if (
        isFinishingDetailLine(lines[index])
        || (
          finishingParts.length > 0
          && !/^Nama\s+File\s*:/i.test(lines[index])
        )
      ) {
        finishingParts.push(lines[index].replace(/\s+/g, ' ').trim());
      }
      index += 1;
    }
    if (finishingParts.length) {
      finishingText = finishingParts.join(' | ');
    }

    let fileNameHint = null;
    if (index < lines.length && /^Nama\s+File\s*:/i.test(lines[index])) {
      fileNameHint = lines[index].replace(/^Nama\s+File\s*:\s*/i, '').trim() || null;
      index += 1;

      while (index < lines.length) {
        const continuationLine = lines[index];
        if (
          /^Total\s*:/i.test(continuationLine)
          || /^Nama\s+File\s*:/i.test(continuationLine)
          || /^Finishing\s*:/i.test(continuationLine)
          || /^Laminating:/i.test(continuationLine)
          || isMashedPriceLine(continuationLine)
          || splitEmbeddedPriceLine(continuationLine)
          || parseSpacedProductLine(continuationLine)
        ) {
          break;
        }
        if (looksLikeNewProductBlock(lines, index)) {
          break;
        }

        const continuation = continuationLine.trim();
        if (!continuation) {
          index += 1;
          continue;
        }

        fileNameHint = fileNameHint ? `${fileNameHint} ${continuation}` : continuation;
        index += 1;
      }
    }

    const productType = productLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!productType && !sizeText && !fileNameHint) {
      continue;
    }

    items.push({
      line_index: items.length + 1,
      product_type: productType || null,
      qty,
      size_text: sizeText,
      finishing_text: finishingText,
      file_name_hint: fileNameHint
    });
  }

  return items;
}

export function parseNotaText(rawText) {
  const normalized = normalizeNotaText(rawText);

  const orderMatch = normalized.match(/Kode\s*Order\s*:\s*(ON\d+)\s*[-\s]+(\d{2}-\d{2}-\d{4})/i)
    || normalized.match(/Kode\s*Order\s*:\s*(ON\d+)/i);
  const customerMatch = normalized.match(/Kepada\s*[+:]\s*(.+?)(?:\n|Kasir|Keterangan|$)/i);
  const notaDate = orderMatch?.[2]
    ? parseNotaDate(orderMatch[2])
    : parseNotaDate(normalized.match(/(\d{2}-\d{2}-\d{4})/)?.[1]);

  const items = extractItems(extractProductSection(normalized));
  const customerNameRaw = customerMatch?.[1]?.trim() || null;

  return {
    nota_order_code: orderMatch?.[1] || null,
    nota_date: notaDate,
    customer_anon_id: anonymizeCustomer(customerNameRaw),
    item_count_detected: items.length,
    items
  };
}
