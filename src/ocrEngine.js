import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createWorker } from 'tesseract.js';
import { config } from './config.js';
import { evaluateNotaExtraction, pickBetterExtraction } from './notaOcrQuality.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const { pdfToPng } = require('pdf-to-png-converter');

const MIN_TEXT_LENGTH = 80;
const PARSE_SCORE_FALLBACK = Number.parseInt(process.env.OCR_PARSE_SCORE_FALLBACK || '52', 10);

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

function buildExtractionResult({ text, engine, confidence, evaluation }) {
  return {
    text,
    engine,
    confidence,
    parseScore: evaluation.score,
    itemCountDetected: evaluation.parsed.item_count_detected,
    priceAnchors: evaluation.priceAnchors
  };
}

async function extractTextWithPdfParse(pdfPath) {
  const buffer = await readFile(pdfPath);
  const result = await pdfParse(buffer);
  const text = String(result.text || '').trim();
  const evaluation = evaluateNotaExtraction(text);

  return buildExtractionResult({
    text,
    engine: 'pdf-text',
    confidence: text.length >= MIN_TEXT_LENGTH ? 0.99 : 0,
    evaluation
  });
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
  const evaluation = evaluateNotaExtraction(text);

  return buildExtractionResult({
    text,
    engine: 'tesseract',
    confidence,
    evaluation
  });
}

function shouldRunTesseractFallback(pdfResult) {
  if (pdfResult.text.length < MIN_TEXT_LENGTH) {
    return true;
  }
  if (pdfResult.itemCountDetected === 0) {
    return true;
  }
  if (pdfResult.parseScore < PARSE_SCORE_FALLBACK) {
    return true;
  }
  if (pdfResult.priceAnchors > 0 && pdfResult.itemCountDetected !== pdfResult.priceAnchors) {
    return true;
  }

  return false;
}

export async function extractNotaText(pdfPath) {
  const pdfResult = await extractTextWithPdfParse(pdfPath);
  let best = pdfResult;

  if (shouldRunTesseractFallback(pdfResult)) {
    try {
      const ocrResult = await extractTextWithTesseract(pdfPath);
      best = pickBetterExtraction(pdfResult, ocrResult);
    } catch (error) {
      if (!pdfResult.text) {
        throw error;
      }
    }
  }

  if (!best.text) {
    throw new Error('OCR nota gagal: teks tidak terbaca.');
  }

  return {
    text: best.text,
    engine: best.engine,
    confidence: best.confidence,
    parseScore: best.parseScore,
    itemCountDetected: best.itemCountDetected
  };
}

export async function shutdownOcrEngine() {
  if (!tesseractWorkerPromise) return;

  const worker = await tesseractWorkerPromise;
  await worker.terminate();
  tesseractWorkerPromise = null;
}
