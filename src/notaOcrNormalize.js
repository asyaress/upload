const mashedPricePattern = /^(\d{1,3}(?:\.\d{3})+)(\d)(\d{1,3}(?:\.\d{3})+)$/;

function isValidMashedPriceToken(value) {
  const match = String(value || '').trim().match(mashedPricePattern);
  if (!match) {
    return false;
  }

  const unitPrice = Number.parseInt(match[1].replace(/\./g, ''), 10) || 0;
  return unitPrice >= 1000;
}

function splitGluedProductPriceLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || isValidMashedPriceToken(trimmed)) {
    return trimmed;
  }

  let bestSplit = null;

  for (let suffixStart = 1; suffixStart < trimmed.length; suffixStart += 1) {
    const suffix = trimmed.slice(suffixStart);
    if (!isValidMashedPriceToken(suffix)) {
      continue;
    }

    const productPart = trimmed.slice(0, suffixStart).trim();
    if (productPart.length < 2 || !/[A-Za-z]/.test(productPart)) {
      continue;
    }

    if (!bestSplit || productPart.length >= bestSplit.productPart.length) {
      bestSplit = { productPart, suffix };
    }
  }

  if (bestSplit) {
    return `${bestSplit.productPart}\n${bestSplit.suffix}`;
  }

  return trimmed;
}

export function repairNotaExtractedText(rawText) {
  let text = String(rawText || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n');

  text = text
    .replace(/(Kode\s*Order\s*:)/gi, '\n$1')
    .replace(/(Kepada\s*[+:])/gi, '\n$1')
    .replace(/(Kasir\s*:)/gi, '\n$1')
    .replace(/(Keterangan\s*:)/gi, '\n$1')
    .replace(/(Nama\s+File\s*:)/gi, '\n$1')
    .replace(/(Ukuran\s*[-—=])/gi, '\nUkuran = ')
    .replace(/(Finishing\s*:)/gi, '\n$1')
    .replace(/(Laminating\s*:)/gi, '\n$1')
    .replace(/(Total\s*:)/gi, '\n$1')
    .replace(/(Bayar\s*:)/gi, '\n$1')
    .replace(/(Kurang\s*:)/gi, '\n$1')
    .replace(/Produk\s+Harga\s+Qty\s+Total/gi, '\nProdukHargaQtyTotal\n')
    .replace(/ProdukHargaQtyTotal/gi, '\nProdukHargaQtyTotal\n');

  text = text
    .split('\n')
    .flatMap((line) => splitGluedProductPriceLine(line).split('\n'))
    .join('\n');

  return text.replace(/\n{3,}/g, '\n\n').trim();
}
