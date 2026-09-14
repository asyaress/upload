import speakeasy from 'speakeasy';

export function verifyTotpCode(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(token).trim(),
    window: 1
  });
}
