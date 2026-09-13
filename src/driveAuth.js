import { google } from 'googleapis';
import { config } from './config.js';

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

let oauth2Client;
let driveClient;

export function assertDriveOAuthConfig() {
  if (!config.drive.parentFolderId) {
    throw new Error('GOOGLE_DRIVE_PARENT_FOLDER_ID belum diisi.');
  }

  if (!config.drive.clientId || !config.drive.clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET wajib diisi. Buat OAuth Client ID di Google Cloud Console.'
    );
  }

  if (!config.drive.refreshToken) {
    throw new Error(
      'GOOGLE_REFRESH_TOKEN belum diisi. Jalankan: npm run google:auth'
    );
  }
}

export function createOAuth2Client(redirectUri = config.drive.oauthRedirectUri) {
  return new google.auth.OAuth2(
    config.drive.clientId,
    config.drive.clientSecret,
    redirectUri
  );
}

export function getOAuth2Client() {
  if (!oauth2Client) {
    assertDriveOAuthConfig();
    oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: config.drive.refreshToken
    });
  }

  return oauth2Client;
}

export async function getAccessToken() {
  const client = getOAuth2Client();
  const tokenResponse = await client.getAccessToken();

  if (!tokenResponse.token) {
    throw new Error('Gagal mendapatkan access token Google Drive. Coba jalankan ulang npm run google:auth');
  }

  return tokenResponse.token;
}

export function getDriveClient() {
  if (!driveClient) {
    driveClient = google.drive({
      version: 'v3',
      auth: getOAuth2Client()
    });
  }

  return driveClient;
}

export function buildAuthorizationUrl(oauth2Client) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: DRIVE_SCOPES,
    prompt: 'consent'
  });
}

export async function exchangeAuthorizationCode(oauth2Client, code) {
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      'Refresh token tidak diterima. Hapus akses app di https://myaccount.google.com/permissions lalu ulangi npm run google:auth'
    );
  }

  return tokens;
}
