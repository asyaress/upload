import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getPool,
  createOrderRecord,
  insertFileMetadata,
  markOrderCompleted,
  markOrderFailed,
  setOrderDriveFolderId,
  getOrderDetail,
  buildFileKey,
  buildJobFileKey
} from './db.js';
import { getOrCreateFolder, findFileByName, uploadFilePath } from './driveStorage.js';
import { previewNotaFromPath } from './notaPreviewService.js';
import { config } from './config.js';

const pdfMimeTypes = new Set(['application/pdf']);
const jpegMimeTypes = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg']);

function hasExtension(fileName, extensions) {
  const lower = fileName.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

function normalizeItemCount(rawItemCount) {
  const itemCount = Number.parseInt(rawItemCount, 10);

  if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > config.maxItems) {
    throw new Error(`Jumlah item harus 1 sampai ${config.maxItems}.`);
  }

  return itemCount;
}

function getSingleFile(filesByField, fieldName) {
  const files = filesByField.get(fieldName) || [];
  if (files.length !== 1) {
    throw new Error(`Field ${fieldName} wajib berisi tepat 1 file.`);
  }

  return files[0];
}

function groupFilesByField(files) {
  const grouped = new Map();

  for (const file of files) {
    if (!grouped.has(file.fieldname)) {
      grouped.set(file.fieldname, []);
    }

    grouped.get(file.fieldname).push(file);
  }

  return grouped;
}

export async function parseAndValidateUpload({ body, files }) {
  const itemCount = normalizeItemCount(body.item_count);
  const filesByField = groupFilesByField(files || []);
  const expectedFields = new Set(['nota']);

  for (let itemIndex = 1; itemIndex <= itemCount; itemIndex += 1) {
    expectedFields.add(`design_${itemIndex}`);
  }

  for (const fieldName of filesByField.keys()) {
    if (!expectedFields.has(fieldName)) {
      throw new Error(`Field upload tidak dikenal: ${fieldName}.`);
    }
  }

  const nota = getSingleFile(filesByField, 'nota');
  if (!pdfMimeTypes.has(nota.mimetype) || !hasExtension(nota.originalname, ['.pdf'])) {
    throw new Error('Nota wajib berupa file PDF.');
  }

  const notaPreview = await previewNotaFromPath(nota.path);
  if (itemCount !== notaPreview.itemCount) {
    throw new Error(
      `Jumlah design (${itemCount}) tidak sesuai nota (${notaPreview.itemCount} item).`
    );
  }

  const designs = [];

  for (let itemIndex = 1; itemIndex <= itemCount; itemIndex += 1) {
    const file = getSingleFile(filesByField, `design_${itemIndex}`);

    if (!jpegMimeTypes.has(file.mimetype) || !hasExtension(file.originalname, ['.jpg', '.jpeg'])) {
      throw new Error(`Design item ${itemIndex} wajib berupa JPEG/JPG.`);
    }

    designs.push({
      itemIndex,
      designIndex: 1,
      file
    });
  }

  return {
    itemCount,
    nota,
    designs,
    notaPreview
  };
}

async function moveFile(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });

  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;

    await fs.copyFile(source, target);
    await fs.unlink(source);
  }
}

function buildFilesList(orderDir, itemCount, notaMeta, designsMeta) {
  const files = [{
    fileRole: 'nota',
    itemIndex: null,
    designIndex: null,
    originalFileName: notaMeta.originalFileName,
    storedFileName: 'nota.pdf',
    mimeType: 'application/pdf',
    sizeBytes: notaMeta.sizeBytes,
    localPath: path.join(orderDir, 'nota.pdf')
  }];

  for (const design of designsMeta) {
    const itemFolderName = `item_${String(design.itemIndex).padStart(2, '0')}`;
    const designFileName = `design_${String(design.designIndex).padStart(2, '0')}.jpg`;

    files.push({
      fileRole: 'design',
      itemIndex: design.itemIndex,
      designIndex: design.designIndex,
      originalFileName: design.originalFileName,
      storedFileName: designFileName,
      mimeType: 'image/jpeg',
      sizeBytes: design.sizeBytes,
      localPath: path.join(orderDir, itemFolderName, designFileName)
    });
  }

  return files;
}

export async function buildOrderJobFromDisk(order) {
  const orderDir = path.resolve(config.uploadDir, order.order_code);
  const notaPath = path.join(orderDir, 'nota.pdf');
  const notaStat = await fs.stat(notaPath);

  const designsMeta = [];

  for (let itemIndex = 1; itemIndex <= order.item_count; itemIndex += 1) {
    const itemFolderName = `item_${String(itemIndex).padStart(2, '0')}`;
    const designFileName = `design_01.jpg`;
    const designPath = path.join(orderDir, itemFolderName, designFileName);
    const designStat = await fs.stat(designPath);

    designsMeta.push({
      itemIndex,
      designIndex: 1,
      originalFileName: designFileName,
      sizeBytes: designStat.size
    });
  }

  const files = buildFilesList(orderDir, order.item_count, {
    originalFileName: 'nota.pdf',
    sizeBytes: notaStat.size
  }, designsMeta);

  return {
    orderId: order.id,
    orderCode: order.order_code,
    itemCount: order.item_count,
    orderDir,
    files
  };
}

export async function createOrderForBackgroundUpload(payload) {
  const pool = getPool();
  const connection = await pool.getConnection();
  let orderId;

  try {
    await connection.beginTransaction();

    const orderRecord = await createOrderRecord(connection, payload.itemCount);
    orderId = orderRecord.orderId;
    const { orderCode } = orderRecord;
    await connection.commit();

    const orderDir = path.resolve(config.uploadDir, orderCode);
    await moveFile(payload.nota.path, path.join(orderDir, 'nota.pdf'));

    const designsMeta = payload.designs.map((design) => {
      const itemFolderName = `item_${String(design.itemIndex).padStart(2, '0')}`;
      const designFileName = `design_${String(design.designIndex).padStart(2, '0')}.jpg`;
      const designPath = path.join(orderDir, itemFolderName, designFileName);

      return {
        itemIndex: design.itemIndex,
        designIndex: design.designIndex,
        originalFileName: design.file.originalname,
        sizeBytes: design.file.size,
        sourcePath: design.file.path,
        targetPath: designPath
      };
    });

    for (const design of designsMeta) {
      await moveFile(design.sourcePath, design.targetPath);
    }

    const files = buildFilesList(orderDir, payload.itemCount, {
      originalFileName: payload.nota.originalname,
      sizeBytes: payload.nota.size
    }, designsMeta);

    return {
      orderId,
      orderCode,
      itemCount: payload.itemCount,
      orderDir,
      files
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Transaction may already be closed.
    }

    if (orderId) {
      await markOrderFailed(orderId, error.message);
    }

    throw error;
  } finally {
    connection.release();
  }
}

function buildExistingFileMap(existingFiles) {
  const map = new Map();

  for (const file of existingFiles) {
    map.set(buildFileKey(file), file);
  }

  return map;
}

export async function processOrderUploadJob(jobData, job) {
  const pool = getPool();
  const connection = await pool.getConnection();
  const totalFiles = jobData.files.length;

  try {
    const order = await getOrderDetail(jobData.orderCode);
    const existingFileMap = buildExistingFileMap(order?.files || []);

    let orderFolderId = order?.google_drive_folder_id || null;
    let orderFolder;

    if (orderFolderId) {
      orderFolder = { id: orderFolderId };
    } else {
      orderFolder = await getOrCreateFolder(jobData.orderCode);
      orderFolderId = orderFolder.id;
      await setOrderDriveFolderId(jobData.orderId, orderFolderId);
    }

    const metadataRows = [];
    const itemFolderIds = new Map();

    for (let fileIndex = 0; fileIndex < jobData.files.length; fileIndex += 1) {
      const file = jobData.files[fileIndex];
      const fileKey = buildJobFileKey(file);
      const existing = existingFileMap.get(fileKey);

      let parentId = orderFolderId;
      let googleDriveFolderId = orderFolderId;

      if (file.fileRole === 'design') {
        const itemFolderName = `item_${String(file.itemIndex).padStart(2, '0')}`;

        if (!itemFolderIds.has(file.itemIndex)) {
          const itemFolder = await getOrCreateFolder(itemFolderName, orderFolderId);
          itemFolderIds.set(file.itemIndex, itemFolder.id);
        }

        parentId = itemFolderIds.get(file.itemIndex);
        googleDriveFolderId = parentId;
      }

      await job?.updateProgress({
        percent: Math.round((fileIndex / totalFiles) * 100),
        currentFile: file.storedFileName,
        filesUploaded: fileIndex,
        totalFiles,
        phase: 'uploading'
      });

      let uploadedFile;

      if (existing?.google_drive_file_id) {
        uploadedFile = {
          id: existing.google_drive_file_id,
          name: existing.stored_file_name
        };
      } else {
        const driveExisting = await findFileByName(file.storedFileName, parentId);

        if (driveExisting) {
          uploadedFile = driveExisting;
        } else {
          uploadedFile = await uploadFilePath({
            filePath: file.localPath,
            fileName: file.storedFileName,
            mimeType: file.mimeType,
            parentId,
            onProgress: (bytesRead, totalBytes) => {
              const fileFraction = totalBytes > 0 ? bytesRead / totalBytes : 0;
              const overallPercent = Math.round(((fileIndex + fileFraction) / totalFiles) * 100);

              job?.updateProgress({
                percent: overallPercent,
                currentFile: file.storedFileName,
                filesUploaded: fileIndex,
                totalFiles,
                phase: 'uploading',
                fileBytesRead: bytesRead,
                fileTotalBytes: totalBytes
              });
            }
          });
        }
      }

      metadataRows.push({
        orderId: jobData.orderId,
        orderCode: jobData.orderCode,
        fileRole: file.fileRole,
        itemIndex: file.itemIndex,
        designIndex: file.designIndex,
        originalFileName: file.originalFileName,
        storedFileName: file.storedFileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        googleDriveFileId: uploadedFile.id,
        googleDriveFolderId
      });
    }

    await job?.updateProgress({
      percent: 95,
      currentFile: null,
      filesUploaded: totalFiles,
      totalFiles,
      phase: 'saving'
    });

    await connection.beginTransaction();
    await insertFileMetadata(connection, metadataRows);
    await markOrderCompleted(connection, jobData.orderId, orderFolderId);
    await connection.commit();

    await job?.updateProgress({
      percent: 100,
      currentFile: null,
      filesUploaded: totalFiles,
      totalFiles,
      phase: 'done'
    });

    await fs.rm(jobData.orderDir, { recursive: true, force: true });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Transaction may not have started yet.
    }

    await markOrderFailed(jobData.orderId, error.message);
    throw error;
  } finally {
    connection.release();
  }
}
