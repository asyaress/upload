import http from 'node:http';
import { URL } from 'node:url';
import dotenv from 'dotenv';
import {
  buildAuthorizationUrl,
  createOAuth2Client,
  exchangeAuthorizationCode
} from '../src/driveAuth.js';
import { config } from '../src/config.js';

dotenv.config();

const redirectUri = config.drive.oauthRedirectUri;
const redirectUrl = new URL(redirectUri);
const port = Number.parseInt(redirectUrl.port || '3333', 10);
const callbackPath = redirectUrl.pathname;

function printHeader() {
  console.log('\n=== Google Drive OAuth Setup ===\n');

  if (!config.drive.clientId || !config.drive.clientSecret) {
    console.error('ERROR: Isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET di .env dulu.');
    console.error('Buat OAuth Client ID (Web application) di Google Cloud Console.');
    process.exit(1);
  }

  console.log(`Redirect URI: ${redirectUri}`);
  console.log('Pastikan URI ini ada di Authorized redirect URIs di Google Cloud Console.\n');

  if (!redirectUri.includes('localhost') && !redirectUri.includes('127.0.0.1')) {
    console.log('Redirect URI production terdeteksi.');
    console.log('Untuk live server, login ke app lalu buka:');
    console.log('  https://upload-desain.toedjoesinargroup.com/setup/google-drive\n');
    process.exit(0);
  }
}

function printSuccess(tokens) {
  console.log('\n=== Berhasil! Tambahkan ke .env ===\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\nLalu isi GOOGLE_DRIVE_PARENT_FOLDER_ID dengan ID folder Drive kamu.');
  console.log('Restart app: pm2 restart upload-desain\n');
}

async function main() {
  printHeader();

  const oauth2Client = createOAuth2Client();
  const authUrl = buildAuthorizationUrl(oauth2Client);

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);

    if (requestUrl.pathname !== callbackPath) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    const error = requestUrl.searchParams.get('error');
    const code = requestUrl.searchParams.get('code');

    if (error) {
      response.writeHead(400);
      response.end(`OAuth error: ${error}`);
      console.error(`\nOAuth error: ${error}`);
      server.close();
      process.exit(1);
      return;
    }

    if (!code) {
      response.writeHead(400);
      response.end('Missing authorization code.');
      return;
    }

    try {
      const tokens = await exchangeAuthorizationCode(oauth2Client, code);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`
        <html><body style="font-family:sans-serif;padding:40px">
          <h2>Google Drive terhubung</h2>
          <p>Refresh token sudah ditampilkan di terminal server. Anda bisa menutup tab ini.</p>
        </body></html>
      `);

      printSuccess(tokens);
      server.close();
      process.exit(0);
    } catch (exchangeError) {
      response.writeHead(500);
      response.end(exchangeError.message);
      console.error(`\nGagal exchange token: ${exchangeError.message}`);
      server.close();
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log('1. Buka URL ini di browser dan login dengan akun Google yang punya akses ke folder Drive:\n');
    console.log(authUrl);
    console.log('\n2. Setelah approve, browser akan redirect otomatis.\n');
    console.log(`Menunggu callback di ${redirectUri} ...\n`);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
