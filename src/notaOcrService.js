import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import {
  getNotaOcrByOrderCode,
  saveNotaOcrFailure,
  saveNotaOcrSuccess
} from './db.js';
import { extractNotaText } from './ocrEngine.js';
import { parseNotaText } from './notaOcrParser.js';

export async function prepareNotaCopyForOcr(orderCode, sourceNotaPath) {
  const targetPath = path.join(config.uploadDir, 'ocr', orderCode, 'nota.pdf');
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourceNotaPath, targetPath);
  return targetPath;
}

export async function cleanupNotaOcrCopy(orderCode) {
  const ocrDir = path.join(config.uploadDir, 'ocr', orderCode);
  await fs.rm(ocrDir, { recursive: true, force: true });
}

export async function processNotaOcrJob(jobData) {
  const existing = await getNotaOcrByOrderCode(jobData.orderCode);
  if (existing?.status === 'completed') {
    return existing;
  }

  try {
    await fs.access(jobData.notaPath);
  } catch {
    throw new Error('File nota untuk OCR tidak ditemukan.');
  }

  const extraction = await extractNotaText(jobData.notaPath);
  const parsed = parseNotaText(extraction.text);
  const itemCountMatch = parsed.item_count_detected === jobData.itemCount;

  const saved = await saveNotaOcrSuccess({
    orderId: jobData.orderId,
    orderCode: jobData.orderCode,
    notaOrderCode: parsed.nota_order_code,
    notaDate: parsed.nota_date,
    itemCountDetected: parsed.item_count_detected,
    itemCountExpected: jobData.itemCount,
    itemCountMatch,
    customerAnonId: parsed.customer_anon_id,
    ocrEngine: extraction.engine,
    ocrConfidence: extraction.confidence,
    items: parsed.items
  });

  await cleanupNotaOcrCopy(jobData.orderCode);
  return saved;
}

export async function processNotaOcrJobSafe(jobData) {
  try {
    return await processNotaOcrJob(jobData);
  } catch (error) {
    await saveNotaOcrFailure({
      orderId: jobData.orderId,
      orderCode: jobData.orderCode,
      itemCountExpected: jobData.itemCount,
      errorMessage: error.message
    });
    await cleanupNotaOcrCopy(jobData.orderCode);
    throw error;
  }
}
