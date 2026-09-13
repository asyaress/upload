import crypto from 'node:crypto';
import { config } from './config.js';

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
  return String(rawText || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/(Kode\s*Order\s*:)/gi, '\n$1')
    .replace(/(Kepada\s*:)/gi, '\n$1')
    .replace(/(Kasir\s*:)/gi, '\n$1')
    .replace(/(Keterangan\s*:)/gi, '\n$1')
    .replace(/(Nama\s+File\s*:)/gi, '\n$1')
    .replace(/(Ukuran\s*=)/gi, '\n$1')
    .replace(/(Finishing\s*:)/gi, '\n$1')
    .replace(/(Total\s*:)/gi, '\n$1')
    .replace(/ProdukHargaQtyTotal/gi, '\nProdukHargaQtyTotal\n');
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

  matches.sort((left, right) => left.suffixLength - right.suffixLength);
  return matches[0];
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
    || /^"Head Office/i.test(line);
}

function extractProductSection(text) {
  const match = text.match(/ProdukHargaQtyTotal([\s\S]*?)(?:\nTotal\s*:|$)/i);
  return match?.[1] || '';
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

    while (
      index < lines.length
      && !isMashedPriceLine(lines[index])
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
    while (
      index < lines.length
      && !isMashedPriceLine(lines[index])
      && !/^Nama\s+File\s*:/i.test(lines[index])
      && !/^Total\s*:/i.test(lines[index])
      && !/^[A-Za-z].*\d{1,3}(?:\.\d{3})+\d\d{1,3}(?:\.\d{3})+/.test(lines[index])
    ) {
      if (/^Ukuran\s*=/i.test(lines[index])) {
        sizeText = lines[index].replace(/^Ukuran\s*=\s*/i, '').trim();
      }
      index += 1;
    }

    let fileNameHint = null;
    if (index < lines.length && /^Nama\s+File\s*:/i.test(lines[index])) {
      fileNameHint = lines[index].replace(/^Nama\s+File\s*:\s*/i, '').trim() || null;
      index += 1;
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
      file_name_hint: fileNameHint
    });
  }

  return items;
}

export function parseNotaText(rawText) {
  const normalized = normalizeNotaText(rawText);

  const orderMatch = normalized.match(/Kode\s*Order\s*:\s*(ON\d{12})(\d{2}-\d{2}-\d{4})/i)
    || normalized.match(/Kode\s*Order\s*:\s*(ON\d+)/i);
  const customerMatch = normalized.match(/Kepada\s*:\s*(.+?)(?:\n|Kasir|Keterangan|$)/i);
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
