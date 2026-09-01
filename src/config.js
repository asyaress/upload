import dotenv from 'dotenv';

dotenv.config();

const intFromEnv = (key, fallback) => {
  const raw = process.env[key];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  appPort: intFromEnv('APP_PORT', 3000),
  maxItems: intFromEnv('MAX_ITEMS', 50),
  maxFileMb: intFromEnv('MAX_FILE_MB', 5120),
  uploadDir: process.env.UPLOAD_DIR || 'storage/pending',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  stuckOrderMinutes: intFromEnv('STUCK_ORDER_MINUTES', 15),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: intFromEnv('DB_PORT', 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tesis_orders'
  },
  drive: {
    parentFolderId: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || '',
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON || '',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  },
  auth: {
    adminUsername: process.env.ADMIN_USERNAME || 'admin@gmail.com',
    adminPassword: process.env.ADMIN_PASSWORD || 'password',
    sessionSecret: process.env.SESSION_SECRET || '',
    sessionMaxAgeHours: intFromEnv('SESSION_MAX_AGE_HOURS', 12)
  }
};

export const maxFileBytes = config.maxFileMb * 1024 * 1024;

export function formatMaxFileSize() {
  if (config.maxFileMb >= 1024) {
    const gb = config.maxFileMb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${config.maxFileMb} MB`;
}
