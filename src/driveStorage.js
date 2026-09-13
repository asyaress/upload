import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { config } from './config.js';
import { getAccessToken, getDriveClient } from './driveAuth.js';

const CHUNK_SIZE = 8 * 1024 * 1024;

async function findChildByName(name, parentId, mimeType = null) {
  const drive = getDriveClient();
  const escapedName = name.replaceAll("'", "\\'");
  let query = `name = '${escapedName}' and '${parentId}' in parents and trashed = false`;

  if (mimeType) {
    query += ` and mimeType = '${mimeType}'`;
  }

  const response = await drive.files.list({
    q: query,
    fields: 'files(id,name,mimeType)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  return response.data.files?.[0] || null;
}

export async function getOrCreateFolder(name, parentId = config.drive.parentFolderId) {
  const existing = await findChildByName(
    name,
    parentId,
    'application/vnd.google-apps.folder'
  );

  if (existing) {
    return existing;
  }

  const drive = getDriveClient();
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined
    },
    fields: 'id,name',
    supportsAllDrives: true
  });

  return response.data;
}

export async function findFileByName(name, parentId) {
  return findChildByName(name, parentId);
}

export async function deleteDriveFile(fileId) {
  if (!fileId) return;

  const drive = getDriveClient();
  await drive.files.delete({
    fileId,
    supportsAllDrives: true
  });
}

export async function createFolder(name, parentId = config.drive.parentFolderId) {
  return getOrCreateFolder(name, parentId);
}

async function uploadChunkWithRetry({ sessionUrl, getToken, offset, chunkBody, end, fileSize }) {
  let token = await getToken();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const uploadResponse = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Length': String(chunkBody.length),
        'Content-Range': `bytes ${offset}-${end}/${fileSize}`
      },
      body: chunkBody
    });

    if (uploadResponse.status === 401 && attempt < 2) {
      token = await getToken();
      continue;
    }

    return uploadResponse;
  }

  throw new Error('Upload chunk gagal setelah retry token.');
}

async function uploadFilePathResumable({ filePath, fileName, mimeType, parentId, onProgress }) {
  const fileStats = await stat(filePath);
  const fileSize = fileStats.size;
  const getToken = () => getAccessToken();
  let token = await getToken();

  const initResponse = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: fileName,
        mimeType,
        parents: [parentId]
      })
    }
  );

  if (initResponse.status === 401) {
    throw new Error('Token Google Drive expired. Jalankan ulang npm run google:auth');
  }

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    throw new Error(`Gagal memulai upload Drive (${initResponse.status}): ${errorText}`);
  }

  const sessionUrl = initResponse.headers.get('Location');
  if (!sessionUrl) {
    throw new Error('Session URL resumable tidak diterima dari Google Drive.');
  }

  const fileHandle = await open(filePath, 'r');
  let offset = 0;
  let result = null;

  try {
    while (offset < fileSize) {
      const chunkSize = Math.min(CHUNK_SIZE, fileSize - offset);
      const buffer = Buffer.alloc(chunkSize);
      const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, offset);

      if (bytesRead === 0) break;

      const end = offset + bytesRead - 1;
      const chunkBody = buffer.subarray(0, bytesRead);

      const uploadResponse = await uploadChunkWithRetry({
        sessionUrl,
        getToken,
        offset,
        chunkBody,
        end,
        fileSize
      });

      if (uploadResponse.status === 308) {
        const range = uploadResponse.headers.get('Range');
        if (range) {
          const match = range.match(/bytes=0-(\d+)/);
          offset = match ? Number.parseInt(match[1], 10) + 1 : end + 1;
        } else {
          offset = end + 1;
        }
      } else if (uploadResponse.ok) {
        result = await uploadResponse.json();
        offset = fileSize;
      } else {
        const errorText = await uploadResponse.text();
        throw new Error(`Upload chunk gagal (${uploadResponse.status}): ${errorText}`);
      }

      if (onProgress) {
        onProgress(Math.min(offset, fileSize), fileSize);
      }
    }
  } finally {
    await fileHandle.close();
  }

  if (!result) {
    throw new Error('Upload Drive selesai tanpa respons file.');
  }

  return result;
}

async function uploadFilePathSimple({ filePath, fileName, mimeType, parentId, onProgress }) {
  const drive = getDriveClient();
  const fileStats = await stat(filePath);
  const fileSize = fileStats.size;

  const response = await drive.files.create(
    {
      requestBody: {
        name: fileName,
        parents: [parentId]
      },
      media: {
        mimeType,
        body: createReadStream(filePath)
      },
      fields: 'id,name,mimeType,size',
      supportsAllDrives: true
    },
    {
      timeout: 0,
      onUploadProgress: (event) => {
        if (onProgress && fileSize > 0) {
          onProgress(event.bytesRead ?? 0, fileSize);
        }
      }
    }
  );

  return response.data;
}

export async function uploadFilePath({ filePath, fileName, mimeType, parentId, onProgress }) {
  const fileStats = await stat(filePath);

  if (fileStats.size > CHUNK_SIZE) {
    return uploadFilePathResumable({ filePath, fileName, mimeType, parentId, onProgress });
  }

  return uploadFilePathSimple({ filePath, fileName, mimeType, parentId, onProgress });
}
