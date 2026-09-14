import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import {
  createUser,
  getUserById,
  getUserByUsername,
  getUserCount
} from './db.js';
import { registerTotpDevice } from './totpService.js';
import { verifyTotpCode } from './totpVerify.js';
import { config } from './config.js';

export { verifyTotpCode };

export async function bootstrapAdminUser() {
  const count = await getUserCount();
  if (count > 0) return;

  if (!config.auth.adminPassword) {
    throw new Error('ADMIN_PASSWORD wajib diisi di .env untuk membuat akun admin pertama.');
  }

  const passwordHash = await bcrypt.hash(config.auth.adminPassword, 12);
  await createUser({
    username: config.auth.adminUsername,
    passwordHash
  });

  console.log(`Akun admin "${config.auth.adminUsername}" dibuat. Login lalu setup TOTP.`);
}

export async function verifyPassword(username, password) {
  const user = await getUserByUsername(username);
  if (!user) return null;

  const isValid = await bcrypt.compare(password, user.password_hash);
  return isValid ? user : null;
}

export function generateTotpSecret(username, deviceLabel = 'Perangkat') {
  const label = String(deviceLabel || 'Perangkat').trim() || 'Perangkat';

  return speakeasy.generateSecret({
    name: `Dataset Intake (${username} - ${label})`,
    issuer: 'Dataset Intake'
  });
}

export async function buildTotpQrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

export async function completeTotpSetup(userId, secret, token, deviceLabel = 'Perangkat utama') {
  await registerTotpDevice({
    userId,
    totpSecret: secret,
    token,
    deviceLabel
  });

  return getUserById(userId);
}

export function establishSession(request, user) {
  request.session.userId = user.id;
  request.session.username = user.username;
  request.session.pendingUserId = undefined;
  request.session.pendingTotpSecret = undefined;
}

export function requireAuth(request, response, next) {
  if (request.session?.userId) {
    next();
    return;
  }

  if (request.path.startsWith('/api/')) {
    response.status(401).json({ error: 'Silakan login terlebih dahulu.' });
    return;
  }

  response.redirect('/login');
}

export function requirePendingLogin(request, response, next) {
  if (request.session?.pendingUserId || request.session?.userId) {
    next();
    return;
  }

  response.redirect('/login');
}

export async function getAuthenticatedUser(request) {
  if (!request.session?.userId) return null;
  return getUserById(request.session.userId);
}
