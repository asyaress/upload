# Nota Design Order MVP

MVP ini mengunci alur:

1. Create order
2. Upload nota dalam format PDF
3. Tentukan jumlah item
4. Upload design JPEG/JPG untuk setiap item
5. Mapping berdasarkan `item_index` dan `design_index`
6. Order langsung diterima
7. Worker background menyimpan file fisik ke Google Drive
8. Worker background menyimpan metadata ke MySQL

Struktur Google Drive yang dibuat:

```text
ORDER_000001
|-- nota.pdf
|-- item_01
|   `-- design_01.jpg
|-- item_02
|   `-- design_02.jpg
`-- item_03
    `-- design_03.jpg
```

## Setup

1. Install dependency:

```bash
npm install
```

2. Pastikan MySQL dan Redis berjalan.

3. Copy `.env.example` menjadi `.env`, lalu isi koneksi MySQL, Redis, Google Drive, dan **auth**:

```env
SESSION_SECRET=string-acak-panjang-minimal-32-karakter
ADMIN_USERNAME=admin
ADMIN_PASSWORD=password-kuat-anda
```

4. Jalankan app:

```bash
npm run dev
```

App akan tersedia di `http://localhost:3000/login`.

Database `tesis_orders` akan dibuat otomatis saat app start selama user MySQL punya izin `CREATE DATABASE`.
File dari form disimpan sementara di `storage/pending`, lalu job Redis/BullMQ mengurus upload Drive di belakang layar.

## Login & TOTP

1. Buka `/login` — masukkan `ADMIN_USERNAME` dan `ADMIN_PASSWORD` dari `.env`
2. Scan QR code dengan Google Authenticator / Authy
3. Masukkan kode 6 digit untuk mengaktifkan TOTP
4. Login berikutnya: password + kode TOTP

Semua halaman dan API dilindungi session. Tanpa login, akses ditolak.

## Fitur UI & Upload

- **SweetAlert2** — konfirmasi, alert error/success, dan loading saat upload
- **Progress bar** — progress upload browser → server (XHR) dan server → Google Drive (polling)
- **Drag & drop** — area drop zone untuk file PDF dan JPEG
- **Validasi client-side** — cek tipe file dan ukuran sebelum upload
- **File besar** — default batas 5 GB per file (atur via `MAX_FILE_MB`, contoh `10240` = 10 GB)
- **Resumable upload** — Google Drive API dengan streaming + progress callback
- **Auto-retry** — worker BullMQ retry 3x dengan exponential backoff
- **Upload idempotent** — retry tidak duplikasi file di Drive
- **Reconcile otomatis** — order macet di-requeue setiap 5 menit
- **Tombol retry manual** — untuk order berstatus `failed`

### API Endpoints (perlu login)

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET` | `/api/orders/:orderCode/status` | Status order + progress upload Drive |
| `POST` | `/api/orders/:orderCode/retry` | Retry upload order gagal |
| `GET` | `/api/config` | Konfigurasi max file size & items |
| `POST` | `/orders` | Upload order (JSON response jika `X-Requested-With: XMLHttpRequest`) |
| `POST` | `/logout` | Keluar dari session |

## Google Drive (OAuth 2.0)

Tidak perlu service account key (cocok jika organisasi memblokir `iam.disableServiceAccountKeyCreation`).

### 1. Google Cloud Console

1. Buat / pilih project
2. Aktifkan **Google Drive API**
3. **APIs & Services → OAuth consent screen** → isi app name, pilih External/Internal → Save
4. **Credentials → Create Credentials → OAuth client ID**
5. Application type: **Web application**
6. Authorized redirect URIs (tambahkan keduanya jika perlu dev + live):
   ```
   https://upload-desain.toedjoesinargroup.com/oauth2/callback
   http://localhost:3333/oauth2/callback
   ```
7. Copy **Client ID** dan **Client Secret**

### 2. Folder Drive

1. Buat folder di Google Drive (akun yang sama dengan OAuth login)
2. Copy Folder ID dari URL:
   ```
   https://drive.google.com/drive/folders/FOLDER_ID_DI_SINI
   ```

### 3. Isi `.env`

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://upload-desain.toedjoesinargroup.com/oauth2/callback
GOOGLE_DRIVE_PARENT_FOLDER_ID=...
```

### 4. Dapatkan refresh token (sekali saja)

**Live server (disarankan):**

1. Login ke app: `https://upload-desain.toedjoesinargroup.com/login`
2. Buka: `https://upload-desain.toedjoesinargroup.com/setup/google-drive`
3. Approve akses Google → copy `GOOGLE_REFRESH_TOKEN` ke `.env`
4. Restart app

**Local dev:**

```bash
npm run google:auth
```

### 5. Restart app

```bash
pm2 restart upload-desain
```

## Relasi Metadata

Untuk design per item, baris metadata mengikuti pola:

```text
order_code + item_index + design_index
```

Contoh:

```text
ORDER_000001 + 1 + 1 -> design_01.jpg
```
