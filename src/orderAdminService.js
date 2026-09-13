import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import {
  countDesignFilesForOrder,
  deleteOcrItemByLineIndex,
  deleteOrderFileById,
  getNotaOcrByOrderCode,
  getOrderDetail,
  getOrderFileById,
  recalculateOcrItemTotals,
  updateOrderItemCount
} from './db.js';
import { deleteDriveFile } from './driveStorage.js';

function normalizeItemCount(rawItemCount) {
  const itemCount = Number.parseInt(rawItemCount, 10);

  if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > config.maxItems) {
    throw new Error(`Jumlah item harus 1 sampai ${config.maxItems}.`);
  }

  return itemCount;
}

export function resolveOrderFileLocalPath(orderCode, file) {
  const orderDir = path.resolve(config.uploadDir, orderCode);

  if (file.file_role === 'nota') {
    return path.join(orderDir, 'nota.pdf');
  }

  const itemFolder = `item_${String(file.item_index).padStart(2, '0')}`;
  return path.join(orderDir, itemFolder, file.stored_file_name);
}

export async function overrideOrderItemCount(orderCode, rawItemCount) {
  const order = await getOrderDetail(orderCode);
  if (!order) {
    throw new Error('Order tidak ditemukan.');
  }

  const itemCount = normalizeItemCount(rawItemCount);
  const designFileCount = await countDesignFilesForOrder(order.id);

  if (itemCount < designFileCount) {
    throw new Error(
      `Jumlah item tidak bisa ${itemCount}. Masih ada ${designFileCount} file design. Hapus design terlebih dahulu.`
    );
  }

  await updateOrderItemCount(order.id, itemCount);
  await recalculateOcrItemTotals(orderCode, itemCount);

  return getOrderDetail(orderCode);
}

export async function deleteOrderDesignFile(orderCode, fileId) {
  const order = await getOrderDetail(orderCode);
  if (!order) {
    throw new Error('Order tidak ditemukan.');
  }

  const file = await getOrderFileById(fileId, orderCode);
  if (!file) {
    throw new Error('File tidak ditemukan pada order ini.');
  }

  if (file.file_role !== 'design') {
    throw new Error('Hanya file design yang bisa dihapus.');
  }

  const localPath = resolveOrderFileLocalPath(orderCode, file);
  await fs.rm(localPath, { force: true });

  if (file.google_drive_file_id) {
    try {
      await deleteDriveFile(file.google_drive_file_id);
    } catch {
      // Metadata di DB tetap dihapus meski Drive gagal.
    }
  }

  await deleteOrderFileById(file.id);

  const ocr = await getNotaOcrByOrderCode(orderCode);
  if (ocr?.id && file.item_index) {
    await deleteOcrItemByLineIndex(ocr.id, file.item_index);
    await recalculateOcrItemTotals(orderCode, order.item_count);
  }

  return getOrderDetail(orderCode);
}
