import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createWorker } from 'tesseract.js';
import { config } from './config.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const { pdfToPng } = require('pdf-to-png-converter');

const MIN_TEXT_LENGTH = 80;

let tesseractWorkerPromise;

async function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      const worker = await createWorker(config.ocr.tesseractLang);
      return worker;
    })();
  }

  return tesseractWorkerPromise;
}

async function extractTextWithPdfParse(pdfPath) {
  const buffer = await readFile(pdfPath);
  const result = await pdfParse(buffer);
  const text = String(result.text || '').trim();

  return {
    text,
    engine: 'pdf-text',
    confidence: text.length >= MIN_TEXT_LENGTH ? 0.99 : 0
  };
}

async function extractTextWithTesseract(pdfPath) {
  const pages = await pdfToPng(pdfPath, {
    disableFontFace: true,
    useSystemFonts: false,
    viewportScale: config.ocr.renderScale
  });

  if (!pages.length) {
    throw new Error('PDF tidak bisa dikonversi ke gambar untuk OCR.');
  }

  const worker = await getTesseractWorker();
  const pageTexts = [];
  let confidenceTotal = 0;

  for (const page of pages) {
    const { data } = await worker.recognize(page.content);
    pageTexts.push(String(data.text || '').trim());
    confidenceTotal += Number(data.confidence || 0);
  }

  const text = pageTexts.filter(Boolean).join('\n\n').trim();
  const confidence = pages.length > 0 ? confidenceTotal / pages.length / 100 : 0;

  return {
    text,
    engine: 'tesseract',
    confidence
  };
}

export async function extractNotaText(pdfPath) {
  const pdfTextResult = await extractTextWithPdfParse(pdfPath);

  if (pdfTextResult.text.length >= MIN_TEXT_LENGTH) {
    return pdfTextResult;
  }

  const ocrResult = await extractTextWithTesseract(pdfPath);

  if (!ocrResult.text) {
    throw new Error('OCR nota gagal: teks tidak terbaca.');
  }

  return ocrResult;
}

export async function shutdownOcrEngine() {
  if (!tesseractWorkerPromise) return;

  const worker = await tesseractWorkerPromise;
  await worker.terminate();
  tesseractWorkerPromise = null;
}
