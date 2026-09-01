import mysql from 'mysql2/promise';
import { config } from './config.js';

let pool;

function assertSafeDatabaseName(databaseName) {
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error('DB_NAME hanya boleh berisi huruf, angka, dan underscore.');
  }
}

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...config.db,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true
    });
  }

  return pool;
}

async function columnExists(tableName, columnName) {
  const [rows] = await getPool().execute(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = :databaseName
        AND TABLE_NAME = :tableName
        AND COLUMN_NAME = :columnName
      LIMIT 1
    `,
    {
      databaseName: config.db.database,
      tableName,
      columnName
    }
  );

  return rows.length > 0;
}

async function tableExists(tableName) {
  const [rows] = await getPool().execute(
    `
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = :databaseName
        AND TABLE_NAME = :tableName
      LIMIT 1
    `,
    {
      databaseName: config.db.database,
      tableName
    }
  );

  return rows.length > 0;
}

export async function initializeDatabase() {
  assertSafeDatabaseName(config.db.database);

  const adminConnection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: false
  });

  await adminConnection.query(
    `CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(config.db.database)}
      CHARACTER SET utf8mb4
      COLLATE utf8mb4_unicode_ci`
  );
  await adminConnection.end();

  const database = mysql.escapeId(config.db.database);
  await getPool().query(`USE ${database}`);
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_code VARCHAR(32) NULL,
      item_count INT UNSIGNED NOT NULL,
      google_drive_folder_id VARCHAR(128) NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'processing',
      error_message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_orders_order_code (order_code),
      KEY idx_orders_status_updated (status, updated_at)
    )
  `);

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS order_files (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id BIGINT UNSIGNED NOT NULL,
      order_code VARCHAR(32) NOT NULL,
      file_role ENUM('nota', 'design') NOT NULL,
      item_index INT UNSIGNED NULL,
      design_index INT UNSIGNED NULL,
      original_file_name VARCHAR(255) NOT NULL,
      stored_file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(128) NOT NULL,
      size_bytes BIGINT UNSIGNED NOT NULL,
      google_drive_file_id VARCHAR(128) NOT NULL,
      google_drive_folder_id VARCHAR(128) NOT NULL,
      uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_order_files_order_id (order_id),
      KEY idx_order_files_order_code (order_code),
      KEY idx_order_files_mapping (order_code, item_index, design_index),
      CONSTRAINT fk_order_files_order_id
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE,
      CONSTRAINT uq_order_files_design_mapping
        UNIQUE (order_id, file_role, item_index, design_index)
    )
  `);

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(64) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      totp_secret VARCHAR(128) NULL,
      totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username)
    )
  `);

  await getPool().query("ALTER TABLE orders MODIFY status VARCHAR(24) NOT NULL DEFAULT 'processing'");

  if (!(await columnExists('orders', 'error_message'))) {
    await getPool().query('ALTER TABLE orders ADD COLUMN error_message TEXT NULL AFTER status');
  }

  if (!(await tableExists('users'))) {
    await getPool().query(`
      CREATE TABLE users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(64) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        totp_secret VARCHAR(128) NULL,
        totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_username (username)
      )
    `);
  }
}

/* ===== Users ===== */

export async function getUserCount() {
  const [[row]] = await getPool().execute('SELECT COUNT(*) AS total FROM users');
  return row.total;
}

export async function createUser({ username, passwordHash }) {
  const [result] = await getPool().execute(
    'INSERT INTO users (username, password_hash) VALUES (:username, :passwordHash)',
    { username, passwordHash }
  );
  return result.insertId;
}

export async function getUserByUsername(username) {
  const [[user]] = await getPool().execute(
    'SELECT * FROM users WHERE username = :username LIMIT 1',
    { username }
  );
  return user || null;
}

export async function getUserById(userId) {
  const [[user]] = await getPool().execute(
    'SELECT * FROM users WHERE id = :userId LIMIT 1',
    { userId }
  );
  return user || null;
}

export async function enableTotpForUser(userId, totpSecret) {
  await getPool().execute(
    'UPDATE users SET totp_secret = :totpSecret, totp_enabled = 1 WHERE id = :userId',
    { userId, totpSecret }
  );
}

/* ===== Orders ===== */

export async function createOrderRecord(connection, itemCount) {
  const [result] = await connection.execute(
    'INSERT INTO orders (item_count, status) VALUES (:itemCount, "processing")',
    { itemCount }
  );

  const orderCode = `ORDER_${String(result.insertId).padStart(6, '0')}`;

  await connection.execute(
    'UPDATE orders SET order_code = :orderCode WHERE id = :orderId',
    { orderCode, orderId: result.insertId }
  );

  return {
    orderId: result.insertId,
    orderCode
  };
}

export async function setOrderDriveFolderId(orderId, folderId) {
  await getPool().execute(
    'UPDATE orders SET google_drive_folder_id = :folderId WHERE id = :orderId',
    { folderId, orderId }
  );
}

export async function markOrderCompleted(connection, orderId, folderId) {
  await connection.execute(
    'UPDATE orders SET google_drive_folder_id = :folderId, status = "completed", error_message = NULL WHERE id = :orderId',
    { folderId, orderId }
  );
}

export async function markOrderFailed(orderId, errorMessage) {
  await getPool().execute(
    'UPDATE orders SET status = "failed", error_message = :errorMessage WHERE id = :orderId',
    {
      orderId,
      errorMessage: String(errorMessage || 'Upload gagal.').slice(0, 4000)
    }
  );
}

export async function resetOrderForRetry(orderId) {
  await getPool().execute(
    'UPDATE orders SET status = "processing", error_message = NULL WHERE id = :orderId',
    { orderId }
  );
}

export async function insertFileMetadata(connection, fileRows) {
  const sql = `
    INSERT INTO order_files (
      order_id,
      order_code,
      file_role,
      item_index,
      design_index,
      original_file_name,
      stored_file_name,
      mime_type,
      size_bytes,
      google_drive_file_id,
      google_drive_folder_id
    )
    VALUES (
      :orderId,
      :orderCode,
      :fileRole,
      :itemIndex,
      :designIndex,
      :originalFileName,
      :storedFileName,
      :mimeType,
      :sizeBytes,
      :googleDriveFileId,
      :googleDriveFolderId
    )
    ON DUPLICATE KEY UPDATE
      original_file_name = VALUES(original_file_name),
      stored_file_name = VALUES(stored_file_name),
      mime_type = VALUES(mime_type),
      size_bytes = VALUES(size_bytes),
      google_drive_file_id = VALUES(google_drive_file_id),
      google_drive_folder_id = VALUES(google_drive_folder_id)
  `;

  for (const row of fileRows) {
    await connection.execute(sql, row);
  }
}

export async function listRecentOrders(limit = 10) {
  const [rows] = await getPool().execute(
    `
      SELECT
        o.id,
        o.order_code,
        o.item_count,
        o.google_drive_folder_id,
        o.status,
        o.created_at,
        COUNT(f.id) AS file_count
      FROM orders o
      LEFT JOIN order_files f ON f.order_id = o.id
      GROUP BY o.id
      ORDER BY o.id DESC
      LIMIT :limit
    `,
    { limit }
  );

  return rows;
}

export async function listStuckOrders(minutes) {
  const [rows] = await getPool().execute(
    `
      SELECT id, order_code, item_count, status, updated_at
      FROM orders
      WHERE status = 'processing'
        AND updated_at < (NOW() - INTERVAL :minutes MINUTE)
      ORDER BY updated_at ASC
      LIMIT 20
    `,
    { minutes }
  );

  return rows;
}

export async function getOrderDetail(orderCode) {
  const [[order]] = await getPool().execute(
    'SELECT * FROM orders WHERE order_code = :orderCode LIMIT 1',
    { orderCode }
  );

  if (!order) return null;

  const [files] = await getPool().execute(
    `
      SELECT *
      FROM order_files
      WHERE order_id = :orderId
      ORDER BY FIELD(file_role, 'nota', 'design'), item_index, design_index
    `,
    { orderId: order.id }
  );

  return {
    ...order,
    files
  };
}

export function buildFileKey(file) {
  return `${file.file_role}:${file.item_index ?? 0}:${file.design_index ?? 0}`;
}

export function buildJobFileKey(file) {
  return `${file.fileRole}:${file.itemIndex ?? 0}:${file.designIndex ?? 0}`;
}
