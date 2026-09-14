import {
  addTotpDevice,
  countTotpDevices,
  deleteTotpDevice,
  getTotpDeviceSecrets,
  syncPrimaryTotpSecret,
  touchTotpDevice
} from './db.js';
import { verifyTotpCode } from './totpVerify.js';

function normalizeDeviceLabel(rawLabel, fallbackIndex = 1) {
  const label = String(rawLabel || '').trim();
  if (label.length >= 2 && label.length <= 64) {
    return label;
  }

  return `Perangkat ${fallbackIndex}`;
}

export async function verifyTotpForUser(userId, token) {
  const devices = await getTotpDeviceSecrets(userId);

  for (const device of devices) {
    if (verifyTotpCode(device.totp_secret, token)) {
      await touchTotpDevice(device.id);
      return true;
    }
  }

  return false;
}

export async function registerTotpDevice({ userId, totpSecret, token, deviceLabel }) {
  if (!verifyTotpCode(totpSecret, token)) {
    throw new Error('Kode TOTP tidak valid. Pastikan waktu perangkat sudah benar.');
  }

  const deviceCount = await countTotpDevices(userId);
  const label = normalizeDeviceLabel(deviceLabel, deviceCount + 1);

  const deviceId = await addTotpDevice({
    userId,
    deviceLabel: label,
    totpSecret
  });

  return { deviceId, deviceLabel: label };
}

export async function removeTotpDevice({ userId, deviceId }) {
  const deviceCount = await countTotpDevices(userId);

  if (deviceCount <= 1) {
    throw new Error('Minimal harus ada satu perangkat TOTP aktif.');
  }

  const removed = await deleteTotpDevice(userId, deviceId);
  if (!removed) {
    throw new Error('Perangkat TOTP tidak ditemukan.');
  }

  await syncPrimaryTotpSecret(userId);
}
