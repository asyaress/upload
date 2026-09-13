import express from 'express';
import session from 'express-session';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { config, maxFileBytes, formatMaxFileSize } from './config.js';
import {
  bootstrapAdminUser,
  completeTotpSetup,
  establishSession,
  generateTotpSecret,
  buildTotpQrDataUrl,
  requireAuth,
  requirePendingLogin,
  verifyPassword,
  verifyTotpCode
} from './auth.js';
import { getOrderDetail, getUserById, initializeDatabase, listRecentOrders, markOrderFailed } from './db.js';
import { prepareNotaCopyForOcr } from './notaOcrService.js';
import { previewNotaFromPath } from './notaPreviewService.js';
import { createOrderForBackgroundUpload, parseAndValidateUpload } from './orderService.js';
import {
  enqueueNotaOcrJob,
  enqueueOrderUploadJob,
  getNotaOcrJobStatus,
  getOrderUploadJobStatus,
  startNotaOcrWorker,
  startOrderUploadWorker
} from './uploadQueue.js';
import { retryFailedOrder, startReconciliationScheduler } from './reliability.js';
import {
  buildAuthorizationUrl,
  createOAuth2Client,
  exchangeAuthorizationCode
} from './driveAuth.js';
import {
  acceptedView,
  googleDriveOAuthResultView,
  loginView,
  orderDetailView,
  orderFormView,
  setupTotpView
} from './views.js';

if (!config.auth.sessionSecret) {
  throw new Error('SESSION_SECRET wajib diisi di .env (minimal 32 karakter acak).');
}

const app = express();
app.set('trust proxy', 1);
const incomingUploadDir = path.resolve(config.uploadDir, '_incoming');

await fs.mkdir(incomingUploadDir, { recursive: true });
await initializeDatabase();
await bootstrapAdminUser();
startOrderUploadWorker();
startNotaOcrWorker();
startReconciliationScheduler();

const upload = multer({
  storage: multer.diskStorage({
    destination: incomingUploadDir,
    filename: (request, file, callback) => {
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      callback(null, `${suffix}${path.extname(file.originalname).toLowerCase()}`);
    }
  }),
  limits: {
    fileSize: maxFileBytes,
    files: config.maxItems + 1
  }
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
  secret: config.auth.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: 'auto',
    maxAge: config.auth.sessionMaxAgeHours * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));
app.use(express.static('public'));

async function cleanupUploadedFiles(files = []) {
  await Promise.all(
    files
      .filter((file) => file.path)
      .map((file) => fs.rm(file.path, { force: true }))
  );
}

function statusLabel(status) {
  const labels = {
    processing: 'Diproses',
    completed: 'Selesai',
    failed: 'Gagal'
  };
  return labels[status] || status || '-';
}

function ocrStatusLabel(status) {
  const labels = {
    processing: 'Membaca nota',
    completed: 'Selesai',
    failed: 'Gagal'
  };
  return labels[status] || status || '-';
}

async function formViewContext(extra = {}) {
  let orders = [];

  try {
    orders = await listRecentOrders();
  } catch {
    orders = [];
  }

  return {
    orders,
    maxFileMb: config.maxFileMb,
    maxFileLabel: formatMaxFileSize(),
    maxItems: config.maxItems,
    ...extra
  };
}

/* ===== Auth Routes ===== */

app.get('/login', (request, response) => {
  if (request.session?.userId) {
    response.redirect('/');
    return;
  }

  response.send(loginView({
    error: request.query.error || '',
    step: request.query.step || 'password',
    username: request.query.username || ''
  }));
});

app.post('/login', async (request, response) => {
  const { username, password } = request.body;

  try {
    const user = await verifyPassword(username, password);

    if (!user) {
      response.redirect('/login?error=Username atau password salah.');
      return;
    }

    if (!user.totp_enabled) {
      const secret = generateTotpSecret(user.username);
      request.session.pendingUserId = user.id;
      request.session.pendingUsername = user.username;
      request.session.pendingTotpSecret = secret.base32;

      const qrDataUrl = await buildTotpQrDataUrl(secret.otpauth_url);
      response.send(setupTotpView({
        username: user.username,
        qrDataUrl,
        secret: secret.base32,
        isFirstSetup: true
      }));
      return;
    }

    request.session.pendingUserId = user.id;
    request.session.pendingUsername = user.username;
    response.redirect(`/login?step=totp&username=${encodeURIComponent(user.username)}`);
  } catch (error) {
    response.redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
});

app.post('/login/totp', async (request, response) => {
  const { code } = request.body;
  const pendingUserId = request.session?.pendingUserId;

  if (!pendingUserId) {
    response.redirect('/login?error=Sesi login kedaluwarsa. Silakan login ulang.');
    return;
  }

  const user = await getUserById(pendingUserId);

  if (!user?.totp_enabled || !user.totp_secret) {
    response.redirect('/login?error=Akun belum siap untuk TOTP.');
    return;
  }

  if (!verifyTotpCode(user.totp_secret, code)) {
    response.redirect(`/login?step=totp&username=${encodeURIComponent(user.username)}&error=Kode TOTP tidak valid.`);
    return;
  }

  establishSession(request, user);
  response.redirect('/');
});

app.get('/setup-totp', requirePendingLogin, async (request, response) => {
  if (request.session.userId) {
    response.redirect('/');
    return;
  }

  const userId = request.session.pendingUserId;
  const user = await getUserById(userId);

  if (!user) {
    response.redirect('/login?error=Sesi tidak valid.');
    return;
  }

  if (!request.session.pendingTotpSecret) {
    const secret = generateTotpSecret(user.username);
    request.session.pendingTotpSecret = secret.base32;
  }

  const secret = {
    base32: request.session.pendingTotpSecret,
    otpauth_url: `otpauth://totp/Dataset%20Intake%20(${encodeURIComponent(user.username)})?secret=${request.session.pendingTotpSecret}&issuer=Dataset%20Intake`
  };

  const qrDataUrl = await buildTotpQrDataUrl(secret.otpauth_url);
  response.send(setupTotpView({
    username: user.username,
    qrDataUrl,
    secret: secret.base32,
    isFirstSetup: !user.totp_enabled,
    error: request.query.error || ''
  }));
});

app.post('/setup-totp', requirePendingLogin, async (request, response) => {
  const { code } = request.body;
  const userId = request.session.pendingUserId;
  const secret = request.session.pendingTotpSecret;

  if (!userId || !secret) {
    response.redirect('/login?error=Sesi setup TOTP kedaluwarsa.');
    return;
  }

  try {
    const user = await completeTotpSetup(userId, secret, code);
    establishSession(request, user);
    response.redirect('/?notice=TOTP berhasil diaktifkan.');
  } catch (error) {
    response.redirect(`/setup-totp?error=${encodeURIComponent(error.message)}`);
  }
});

app.post('/logout', requireAuth, (request, response) => {
  request.session.destroy(() => {
    response.redirect('/login');
  });
});

/* ===== Google Drive OAuth (live callback) ===== */

app.get('/oauth2/callback', async (request, response) => {
  if (!request.session?.googleOAuthSetupPending) {
    response.status(403).send(googleDriveOAuthResultView({
      success: false,
      error: 'Sesi setup OAuth tidak valid. Mulai dari /setup/google-drive setelah login.'
    }));
    return;
  }

  const oauthError = request.query.error;

  if (oauthError) {
    request.session.googleOAuthSetupPending = false;
    response.status(400).send(googleDriveOAuthResultView({
      success: false,
      error: `Google menolak akses: ${oauthError}`
    }));
    return;
  }

  const code = request.query.code;

  if (!code) {
    response.status(400).send(googleDriveOAuthResultView({
      success: false,
      error: 'Kode otorisasi tidak ditemukan.'
    }));
    return;
  }

  try {
    if (!config.drive.clientId || !config.drive.clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET belum diisi di .env');
    }

    const oauth2Client = createOAuth2Client();
    const tokens = await exchangeAuthorizationCode(oauth2Client, code);
    request.session.googleOAuthSetupPending = false;

    response.send(googleDriveOAuthResultView({
      success: true,
      refreshToken: tokens.refresh_token,
      redirectUri: config.drive.oauthRedirectUri
    }));
  } catch (error) {
    request.session.googleOAuthSetupPending = false;
    response.status(500).send(googleDriveOAuthResultView({
      success: false,
      error: error.message
    }));
  }
});

/* ===== Protected Routes ===== */

app.use(requireAuth);

app.get('/setup/google-drive', (request, response) => {
  if (!config.drive.clientId || !config.drive.clientSecret) {
    response.status(400).send(googleDriveOAuthResultView({
      success: false,
      error: 'Isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET di .env terlebih dahulu.'
    }));
    return;
  }

  request.session.googleOAuthSetupPending = true;
  const oauth2Client = createOAuth2Client();
  const authUrl = buildAuthorizationUrl(oauth2Client);
  response.redirect(authUrl);
});

app.get('/', async (request, response) => {
  try {
    response.send(orderFormView(await formViewContext({
      notice: request.query.notice || '',
      username: request.session.username
    })));
  } catch (error) {
    response.send(orderFormView(await formViewContext({
      error: `Database belum siap: ${error.message}`,
      username: request.session.username
    })));
  }
});

app.get('/orders/:orderCode', async (request, response) => {
  const order = await getOrderDetail(request.params.orderCode);

  if (!order) {
    response.status(404).send(orderFormView(await formViewContext({
      error: 'Order tidak ditemukan.',
      username: request.session.username
    })));
    return;
  }

  response.send(orderDetailView(order, { username: request.session.username }));
});

app.get('/api/orders/:orderCode/status', async (request, response) => {
  const order = await getOrderDetail(request.params.orderCode);

  if (!order) {
    response.status(404).json({ error: 'Order tidak ditemukan.' });
    return;
  }

  const jobStatus = await getOrderUploadJobStatus(order.order_code);
  const ocrJobStatus = await getNotaOcrJobStatus(order.order_code);
  const progress = jobStatus?.progress ?? { percent: order.status === 'completed' ? 100 : 0 };
  const ocr = order.ocr;

  response.json({
    orderCode: order.order_code,
    status: order.status,
    statusLabel: statusLabel(order.status),
    itemCount: order.item_count,
    googleDriveFolderId: order.google_drive_folder_id,
    errorMessage: order.error_message,
    canRetry: order.status === 'failed',
    ocr: ocr ? {
      status: ocr.status,
      statusLabel: ocrStatusLabel(ocr.status),
      notaOrderCode: ocr.nota_order_code,
      notaDate: ocr.nota_date,
      itemCountDetected: ocr.item_count_detected,
      itemCountExpected: ocr.item_count_expected,
      itemCountMatch: ocr.item_count_match,
      customerAnonId: ocr.customer_anon_id,
      ocrEngine: ocr.ocr_engine,
      ocrConfidence: ocr.ocr_confidence,
      errorMessage: ocr.error_message,
      queueState: ocrJobStatus?.state || null,
      items: (ocr.items || []).map((item) => ({
        lineIndex: item.line_index,
        productType: item.product_type,
        qty: item.qty,
        sizeText: item.size_text,
        fileNameHint: item.file_name_hint
      }))
    } : null,
    progress: {
      percent: progress.percent ?? 0,
      currentFile: progress.currentFile ?? null,
      filesUploaded: progress.filesUploaded ?? order.files.length,
      totalFiles: progress.totalFiles ?? order.item_count + 1,
      phase: progress.phase ?? (order.status === 'completed' ? 'done' : 'waiting'),
      fileBytesRead: progress.fileBytesRead ?? 0,
      fileTotalBytes: progress.fileTotalBytes ?? 0
    },
    files: order.files.map((file) => ({
      fileRole: file.file_role,
      itemIndex: file.item_index,
      designIndex: file.design_index,
      storedFileName: file.stored_file_name,
      sizeBytes: file.size_bytes,
      googleDriveFileId: file.google_drive_file_id
    })),
    createdAt: order.created_at,
    updatedAt: order.updated_at
  });
});

app.post('/api/orders/:orderCode/retry', async (request, response) => {
  try {
    const orderJob = await retryFailedOrder(request.params.orderCode);
    response.json({
      success: true,
      orderCode: orderJob.orderCode,
      message: 'Upload dijadwalkan ulang.'
    });
  } catch (error) {
    response.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/config', (request, response) => {
  response.json({
    maxFileMb: config.maxFileMb,
    maxFileLabel: formatMaxFileSize(),
    maxItems: config.maxItems
  });
});

app.post('/api/nota/preview', upload.single('nota'), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ success: false, error: 'Nota PDF wajib diupload.' });
      return;
    }

    if (request.file.mimetype !== 'application/pdf' && !request.file.originalname.toLowerCase().endsWith('.pdf')) {
      response.status(400).json({ success: false, error: 'Nota harus berformat PDF.' });
      return;
    }

    const preview = await previewNotaFromPath(request.file.path);
    await fs.rm(request.file.path, { force: true });

    response.json({
      success: true,
      ...preview
    });
  } catch (error) {
    await cleanupUploadedFiles(request.file ? [request.file] : []);
    response.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/orders', upload.any(), async (request, response) => {
  let orderJob;
  const wantsJson = request.headers.accept?.includes('application/json')
    || request.headers['x-requested-with'] === 'XMLHttpRequest';

  try {
    const payload = await parseAndValidateUpload({
      body: request.body,
      files: request.files
    });

    orderJob = await createOrderForBackgroundUpload(payload);

    try {
      await enqueueOrderUploadJob(orderJob);
    } catch (enqueueError) {
      await markOrderFailed(orderJob.orderId, `Gagal masuk antrian: ${enqueueError.message}`);
      throw enqueueError;
    }

    try {
      const notaPath = await prepareNotaCopyForOcr(
        orderJob.orderCode,
        path.join(orderJob.orderDir, 'nota.pdf')
      );
      await enqueueNotaOcrJob({
        orderId: orderJob.orderId,
        orderCode: orderJob.orderCode,
        itemCount: orderJob.itemCount,
        notaPath
      });
    } catch (ocrEnqueueError) {
      console.error(`Gagal enqueue OCR untuk ${orderJob.orderCode}:`, ocrEnqueueError.message);
    }

    if (wantsJson) {
      response.status(202).json({
        success: true,
        orderCode: orderJob.orderCode,
        orderId: orderJob.orderId,
        itemCount: orderJob.itemCount,
        fileCount: orderJob.files.length,
        message: 'Order diterima. Upload ke Google Drive berjalan di server.'
      });
      return;
    }

    response.status(202).send(acceptedView(orderJob));
  } catch (error) {
    if (orderJob?.orderId) {
      await markOrderFailed(orderJob.orderId, error.message);
    }

    await cleanupUploadedFiles(request.files);

    if (wantsJson) {
      response.status(400).json({
        success: false,
        error: error.message
      });
      return;
    }

    response.status(400).send(orderFormView(await formViewContext({
      error: error.message,
      username: request.session.username
    })));
  }
});

app.use((error, request, response, next) => {
  const wantsJson = request.headers.accept?.includes('application/json')
    || request.headers['x-requested-with'] === 'XMLHttpRequest';

  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Ukuran file melebihi batas maksimum ${formatMaxFileSize()}.`
      : `Upload gagal: ${error.message}`;

    if (wantsJson) {
      response.status(400).json({ success: false, error: message });
      return;
    }

    formViewContext({ error: message, username: request.session?.username })
      .then((ctx) => response.status(400).send(orderFormView(ctx)))
      .catch(next);
    return;
  }

  next(error);
});

const server = app.listen(config.appPort, () => {
  console.log(`MVP berjalan di http://localhost:${config.appPort}`);
  console.log(`Batas ukuran file: ${formatMaxFileSize()} per file`);
  console.log(`Login: http://localhost:${config.appPort}/login`);
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 7_200_000;
server.timeout = 0;
