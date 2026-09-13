function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('id-ID');
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
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

function formatOcrConfidence(value) {
  if (value === null || value === undefined) return '-';
  const percent = Number(value) * 100;
  if (!Number.isFinite(percent)) return '-';
  return `${percent.toFixed(1)}%`;
}

function renderOcrSection(order) {
  const ocr = order.ocr;

  if (!ocr) {
    return `
      <section class="ocr-panel" id="ocr-panel">
        <div class="section-head">
          <h2>OCR Nota</h2>
        </div>
        <p class="upload-note">OCR nota belum dijadwalkan.</p>
      </section>
    `;
  }

  const itemRows = ocr.items?.length
    ? ocr.items.map((item) => `
      <tr>
        <td>${escapeHtml(item.line_index)}</td>
        <td>${escapeHtml(item.product_type || '-')}</td>
        <td>${escapeHtml(item.qty ?? '-')}</td>
        <td>${escapeHtml(item.size_text || '-')}</td>
        <td>${escapeHtml(item.file_name_hint || '-')}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="5" class="empty">${ocr.status === 'processing' ? 'Menunggu hasil OCR...' : 'Tidak ada item terdeteksi.'}</td></tr>`;

  const matchLabel = ocr.item_count_match === null
    ? '-'
    : ocr.item_count_match
      ? 'Cocok'
      : 'Tidak cocok';

  const matchClass = ocr.item_count_match === null
    ? ''
    : ocr.item_count_match
      ? 'status-completed'
      : 'status-failed';

  return `
    <section class="ocr-panel" id="ocr-panel">
      <div class="section-head">
        <h2>OCR Nota</h2>
        <span class="status status-${escapeHtml(ocr.status)}" id="ocr-status-badge">${escapeHtml(ocrStatusLabel(ocr.status))}</span>
      </div>

      <div class="summary ocr-summary">
        <div>
          <span>Kode Nota</span>
          <strong id="ocr-nota-order-code">${escapeHtml(ocr.nota_order_code || '-')}</strong>
        </div>
        <div>
          <span>Tanggal Nota</span>
          <strong id="ocr-nota-date">${escapeHtml(ocr.nota_date || '-')}</strong>
        </div>
        <div>
          <span>Item Terdeteksi</span>
          <strong id="ocr-item-count">${escapeHtml(ocr.item_count_detected ?? '-')} / ${escapeHtml(order.item_count)}</strong>
        </div>
        <div>
          <span>Validasi Jumlah</span>
          <strong><span class="status ${matchClass}" id="ocr-item-match">${escapeHtml(matchLabel)}</span></strong>
        </div>
        <div>
          <span>Engine</span>
          <strong id="ocr-engine">${escapeHtml(ocr.ocr_engine || '-')}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong id="ocr-confidence">${escapeHtml(formatOcrConfidence(ocr.ocr_confidence))}</strong>
        </div>
        <div>
          <span>Customer ID</span>
          <code id="ocr-customer-id">${escapeHtml(ocr.customer_anon_id || '-')}</code>
        </div>
      </div>

      ${ocr.error_message ? `<div class="alert" id="ocr-error-alert" role="alert">${escapeHtml(ocr.error_message)}</div>` : '<div class="alert hidden" id="ocr-error-alert" role="alert"></div>'}

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Produk</th>
              <th>Qty</th>
              <th>Ukuran</th>
              <th>Nama File</th>
            </tr>
          </thead>
          <tbody id="ocr-items-body">${itemRows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function layout({ title, body, scripts = '', authPage = false }) {
  const uploadOverlay = authPage ? '' : `
    <div id="upload-overlay" class="upload-overlay hidden" aria-hidden="true" role="dialog" aria-labelledby="upload-overlay-title" aria-modal="true">
      <div class="upload-overlay-panel">
        <div class="upload-spinner" aria-hidden="true"></div>
        <h3 id="upload-overlay-title">Mengupload ke Server</h3>
        <p id="upload-overlay-phase" class="upload-overlay-phase">Menyiapkan upload...</p>
        <div class="upload-overlay-progress">
          <div class="upload-overlay-progress-fill" id="upload-overlay-fill"></div>
        </div>
        <div class="upload-overlay-stats">
          <span id="upload-overlay-loaded">0 B</span>
          <span id="upload-overlay-percent">0%</span>
        </div>
        <p id="upload-overlay-speed" class="upload-overlay-speed"></p>
        <p class="upload-overlay-warning">Jangan tutup atau refresh halaman ini selama upload berlangsung.</p>
      </div>
    </div>`;

  const appScript = authPage
    ? '<script src="/auth.js"></script>'
    : '<script src="/app.js"></script>';

  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css">
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    ${body}
    ${uploadOverlay}
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    ${appScript}
    ${scripts}
  </body>
</html>`;
}

function recentOrderRows(orders) {
  if (!orders.length) {
    return '<tr><td colspan="5" class="empty">Belum ada order.</td></tr>';
  }

  return orders.map((order) => `
    <tr>
      <td><a href="/orders/${escapeHtml(order.order_code)}">${escapeHtml(order.order_code)}</a></td>
      <td>${escapeHtml(order.item_count)}</td>
      <td>${escapeHtml(order.file_count)}</td>
      <td><span class="status status-${escapeHtml(order.status)}">${escapeHtml(statusLabel(order.status))}</span></td>
      <td>${escapeHtml(formatDate(order.created_at))}</td>
    </tr>
  `).join('');
}

export function loginView({ error = '', step = 'password', username = '' } = {}) {
  const isTotpStep = step === 'totp';

  return layout({
    title: 'Login — Dataset Intake',
    authPage: true,
    body: `
      <main class="shell narrow">
        <section class="panel auth-panel">
          <p class="eyebrow">Dataset Intake System</p>
          <h1>${isTotpStep ? 'Verifikasi TOTP' : 'Login'}</h1>
          <p class="subtitle">${isTotpStep ? 'Masukkan kode 6 digit dari aplikasi authenticator Anda.' : 'Masuk dengan username dan password untuk melanjutkan.'}</p>

          ${error ? `<div class="alert" role="alert">${escapeHtml(error)}</div>` : ''}

          ${isTotpStep ? `
            <form method="post" action="/login/totp" class="auth-form" id="totp-form">
              <label class="field">
                <strong>Kode TOTP</strong>
                <input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required autofocus autocomplete="one-time-code">
              </label>
              <button type="submit" class="primary-button full-width">Verifikasi</button>
            </form>
          ` : `
            <form method="post" action="/login" class="auth-form" id="login-form">
              <label class="field">
                <strong>Username</strong>
                <input type="text" name="username" value="${escapeHtml(username)}" required autofocus autocomplete="username">
              </label>
              <label class="field">
                <strong>Password</strong>
                <input type="password" name="password" required autocomplete="current-password">
              </label>
              <button type="submit" class="primary-button full-width">Lanjut</button>
            </form>
          `}
        </section>
      </main>
    `
  });
}

export function googleDriveOAuthResultView({ success, refreshToken = '', redirectUri = '', error = '' } = {}) {
  return layout({
    title: success ? 'Google Drive Terhubung' : 'Setup Google Drive Gagal',
    authPage: true,
    body: `
      <main class="shell narrow">
        <section class="panel auth-panel">
          <p class="eyebrow">Google Drive OAuth</p>
          <h1>${success ? 'Refresh Token Siap' : 'Setup Gagal'}</h1>

          ${success ? `
            <div class="notice">
              Copy refresh token di bawah ke file <code>.env</code> server, lalu restart app.
            </div>
            <div class="field">
              <strong>Redirect URI</strong>
              <code>${escapeHtml(redirectUri)}</code>
            </div>
            <div class="field">
              <strong>GOOGLE_REFRESH_TOKEN</strong>
              <textarea readonly rows="4" class="token-box">${escapeHtml(refreshToken)}</textarea>
            </div>
            <p class="upload-note">Setelah disimpan, jalankan: <code>pm2 restart upload-desain</code></p>
            <a class="primary-button full-width" href="/">Kembali ke Dashboard</a>
          ` : `
            <div class="alert" role="alert">${escapeHtml(error)}</div>
            <a class="secondary-button full-width" href="/">Kembali</a>
          `}
        </section>
      </main>
    `
  });
}

export function setupTotpView({ username, qrDataUrl, secret, isFirstSetup = true, error = '' } = {}) {
  return layout({
    title: 'Setup TOTP — Dataset Intake',
    authPage: true,
    body: `
      <main class="shell narrow">
        <section class="panel auth-panel">
          <p class="eyebrow">Keamanan Akun</p>
          <h1>Setup Authenticator</h1>
          <p class="subtitle">Scan QR code dengan Google Authenticator, Authy, atau aplikasi TOTP lainnya.</p>

          ${error ? `<div class="alert" role="alert">${escapeHtml(error)}</div>` : ''}

          <div class="totp-setup">
            <img src="${escapeHtml(qrDataUrl)}" alt="QR Code TOTP" class="totp-qr">
            <div class="totp-secret">
              <span>Secret manual:</span>
              <code>${escapeHtml(secret)}</code>
            </div>
          </div>

          <form method="post" action="/setup-totp" class="auth-form">
            <label class="field">
              <strong>Kode verifikasi (6 digit)</strong>
              <input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required autofocus>
            </label>
            <button type="submit" class="primary-button full-width">${isFirstSetup ? 'Aktifkan TOTP & Masuk' : 'Simpan TOTP'}</button>
          </form>
        </section>
      </main>
    `
  });
}

function userBar(username) {
  if (!username) return '';

  return `
    <div class="user-bar">
      <span>${escapeHtml(username)}</span>
      <form method="post" action="/logout" class="logout-form">
        <button type="submit" class="secondary-button small-button">Logout</button>
      </form>
    </div>
  `;
}

export function orderFormView({ error = '', notice = '', orders = [], maxFileMb = 5120, maxFileLabel = '5 GB', maxItems = 50, username = '' } = {}) {
  return layout({
    title: 'Order Baru — Dataset Intake',
    body: `
      <main class="shell">
        <section class="panel hero-panel">
          <div class="topbar">
            <div>
              <p class="eyebrow">Dataset Intake System</p>
              <h1>Order Baru</h1>
              <p class="subtitle">Upload nota PDF dulu — sistem membaca item otomatis, lalu upload design JPEG sesuai produk di nota.</p>
            </div>
            ${userBar(username)}
          </div>

          ${notice ? `<div class="notice" role="status">${escapeHtml(notice)}</div>` : ''}
          ${error ? `<div class="alert" role="alert">${escapeHtml(error)}</div>` : ''}

          <form id="order-form" action="/orders" method="post" enctype="multipart/form-data" class="order-form" data-max-file-mb="${maxFileMb}" data-max-items="${maxItems}">
            <div class="form-section">
              <div class="section-label">
                <span class="step-badge">1</span>
                <div>
                  <strong>Nota (PDF)</strong>
                  <small>File nota dalam format PDF</small>
                </div>
              </div>
              <label class="file-drop" data-field="nota" id="nota-drop">
                <input type="file" name="nota" accept="application/pdf,.pdf" required hidden>
                <div class="file-drop-content">
                  <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <span class="file-drop-text">Klik atau seret file PDF ke sini</span>
                  <span class="file-drop-hint">Nota dibaca otomatis untuk menentukan jumlah design. Maks. ${escapeHtml(maxFileLabel)}</span>
                </div>
                <div class="file-selected hidden"></div>
              </label>

              <div id="nota-scan-status" class="nota-scan-status hidden" aria-live="polite"></div>
            </div>

            <div id="auto-upload-section" class="auto-upload-section hidden">
              <div class="form-section">
                <div class="section-label">
                  <span class="step-badge">2</span>
                  <div>
                    <strong>Ringkasan Nota</strong>
                    <small>Jumlah item diambil otomatis dari PDF nota</small>
                  </div>
                </div>
                <div class="nota-summary">
                  <div>
                    <span>Kode Nota</span>
                    <strong id="preview-nota-order-code">-</strong>
                  </div>
                  <div>
                    <span>Tanggal</span>
                    <strong id="preview-nota-date">-</strong>
                  </div>
                  <div>
                    <span>Jumlah Item</span>
                    <strong id="preview-item-count">-</strong>
                  </div>
                </div>
                <input id="item-count" type="hidden" name="item_count" value="1">
              </div>

              <div class="form-section">
                <div class="section-label">
                  <span class="step-badge">3</span>
                  <div>
                    <strong>Upload Design per Produk</strong>
                    <small>Satu file JPEG/JPG untuk setiap item di nota</small>
                  </div>
                </div>
                <div id="design-fields" class="design-list"></div>
              </div>
            </div>

            <div class="form-actions">
              <button type="submit" id="submit-btn" class="primary-button" disabled>
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload &amp; Buat Order
              </button>
              <p class="upload-note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                Upload berjalan di server. File besar (hingga ${escapeHtml(maxFileLabel)}) didukung.
              </p>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="section-head">
            <h2>Order Terbaru</h2>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Item</th>
                  <th>File</th>
                  <th>Status</th>
                  <th>Tanggal</th>
                </tr>
              </thead>
              <tbody>${recentOrderRows(orders)}</tbody>
            </table>
          </div>
        </section>
      </main>
    `
  });
}

export function acceptedView(orderJob) {
  return layout({
    title: `${orderJob.orderCode} diterima`,
    body: `
      <main class="shell narrow">
        <section class="panel success-panel">
          <div class="success-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <p class="eyebrow">Order Diterima</p>
          <h1>${escapeHtml(orderJob.orderCode)}</h1>

          <div class="notice">
            File sudah diterima server. Upload ke Google Drive dan penyimpanan metadata berjalan di belakang layar.
          </div>

          <div class="actions">
            <a class="primary-button" href="/orders/${escapeHtml(orderJob.orderCode)}">Lihat Progress</a>
            <a class="secondary-button" href="/">Order Baru</a>
          </div>
        </section>
      </main>
    `
  });
}

export function orderDetailView(order, { username = '' } = {}) {
  const isProcessing = order.status === 'processing';
  const isFailed = order.status === 'failed';

  const rows = order.files.length
    ? order.files.map((file) => `
      <tr>
        <td><span class="role-badge role-${escapeHtml(file.file_role)}">${escapeHtml(file.file_role)}</span></td>
        <td>${escapeHtml(file.item_index ?? '-')}</td>
        <td>${escapeHtml(file.design_index ?? '-')}</td>
        <td>${escapeHtml(file.stored_file_name)}</td>
        <td>${escapeHtml(formatBytes(file.size_bytes))}</td>
        <td><code class="drive-id">${escapeHtml(file.google_drive_file_id)}</code></td>
      </tr>
    `).join('')
    : `<tr><td colspan="6" class="empty">${isProcessing ? 'Metadata file belum masuk. Worker sedang memproses...' : 'Belum ada file.'}</td></tr>`;

  return layout({
    title: `${order.order_code} — Status`,
    body: `
      <main class="shell">
        <section class="panel">
          <div class="topbar">
            <div>
              <p class="eyebrow">Status Order</p>
              <h1>${escapeHtml(order.order_code)}</h1>
            </div>
            <div class="topbar-actions">
              ${userBar(username)}
              <a class="secondary-button" href="/">Kembali</a>
            </div>
          </div>

          <div id="status-tracker" class="status-tracker" data-order-code="${escapeHtml(order.order_code)}" data-status="${escapeHtml(order.status)}" data-ocr-status="${escapeHtml(order.ocr?.status || '')}">
            <div class="progress-section ${isProcessing ? '' : 'hidden'}" id="progress-section">
              <div class="progress-header">
                <span id="progress-label">Memproses upload ke Google Drive...</span>
                <span id="progress-percent">0%</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" id="progress-fill" style="width: 0%"></div>
              </div>
              <p class="progress-detail" id="progress-detail">Menunggu worker...</p>
            </div>

            <div class="summary">
              <div>
                <span>Status</span>
                <strong><span class="status status-${escapeHtml(order.status)}" id="status-badge">${escapeHtml(statusLabel(order.status))}</span></strong>
              </div>
              <div>
                <span>Jumlah Item</span>
                <strong>${escapeHtml(order.item_count)}</strong>
              </div>
              <div>
                <span>Total File</span>
                <strong id="file-count">${escapeHtml(order.files.length)} / ${escapeHtml(order.item_count + 1)}</strong>
              </div>
              <div>
                <span>Folder Drive</span>
                <code id="drive-folder">${escapeHtml(order.google_drive_folder_id || '-')}</code>
              </div>
            </div>

            ${order.error_message ? `<div class="alert" id="error-alert" role="alert">${escapeHtml(order.error_message)}</div>` : ''}
            ${isFailed ? '' : '<div id="error-alert" class="alert hidden" role="alert"></div>'}

            ${isFailed ? `
              <div class="retry-section" id="retry-section">
                <button type="button" id="retry-btn" class="primary-button" data-order-code="${escapeHtml(order.order_code)}">
                  Coba Upload Ulang ke Drive
                </button>
                <p class="upload-note">Retry hanya tersedia jika file masih ada di server.</p>
              </div>
            ` : ''}

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Item</th>
                    <th>Design</th>
                    <th>File</th>
                    <th>Ukuran</th>
                    <th>Drive File ID</th>
                  </tr>
                </thead>
                <tbody id="files-table-body">${rows}</tbody>
              </table>
            </div>
          </div>

          ${renderOcrSection(order)}
        </section>
      </main>
    `
  });
}
