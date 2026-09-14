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

async function ensureNotaOcrTables() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS nota_ocr_results (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id BIGINT UNSIGNED NOT NULL,
      order_code VARCHAR(32) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'processing',
      nota_order_code VARCHAR(32) NULL,
      nota_date DATE NULL,
      item_count_detected INT UNSIGNED NULL,
      item_count_expected INT UNSIGNED NOT NULL,
      item_count_match TINYINT(1) NULL,
      customer_anon_id VARCHAR(32) NULL,
      ocr_engine VARCHAR(24) NULL,
      ocr_confidence DECIMAL(6, 4) NULL,
      error_message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_nota_ocr_order_id (order_id),
      UNIQUE KEY uq_nota_ocr_order_code (order_code),
      CONSTRAINT fk_nota_ocr_order_id
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE
    )
  `);

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS nota_ocr_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ocr_result_id BIGINT UNSIGNED NOT NULL,
      line_index INT UNSIGNED NOT NULL,
      product_type VARCHAR(255) NULL,
      qty INT UNSIGNED NULL,
      size_text VARCHAR(128) NULL,
      file_name_hint VARCHAR(255) NULL,
      PRIMARY KEY (id),
      KEY idx_nota_ocr_items_result (ocr_result_id),
      CONSTRAINT fk_nota_ocr_items_result
        FOREIGN KEY (ocr_result_id) REFERENCES nota_ocr_results(id)
        ON DELETE CASCADE
    )
  `);
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

  await ensureNotaOcrTables();
  await ensureUserTotpDevicesTable();
  await migrateLegacyTotpSecretsToDevices();
}

async function ensureUserTotpDevicesTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS user_totp_devices (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      device_label VARCHAR(64) NOT NULL,
      totp_secret VARCHAR(128) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (id),
      KEY idx_user_totp_devices_user_id (user_id),
      CONSTRAINT fk_user_totp_devices_user_id
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);
}

async function migrateLegacyTotpSecretsToDevices() {
  const [users] = await getPool().execute(
    `
      SELECT u.id, u.totp_secret
      FROM users u
      WHERE u.totp_enabled = 1
        AND u.totp_secret IS NOT NULL
        AND u.totp_secret != ''
        AND NOT EXISTS (
          SELECT 1 FROM user_totp_devices d WHERE d.user_id = u.id LIMIT 1
        )
    `
  );

  for (const user of users) {
    await getPool().execute(
      `
        INSERT INTO user_totp_devices (user_id, device_label, totp_secret)
        VALUES (:userId, 'Perangkat utama', :totpSecret)
      `,
      { userId: user.id, totpSecret: user.totp_secret }
    );
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

export async function listTotpDevices(userId) {
  const [rows] = await getPool().execute(
    `
      SELECT id, user_id, device_label, created_at, last_used_at
      FROM user_totp_devices
      WHERE user_id = :userId
      ORDER BY created_at ASC
    `,
    { userId }
  );

  return rows;
}

export async function getTotpDeviceSecrets(userId) {
  const [rows] = await getPool().execute(
    `
      SELECT id, totp_secret
      FROM user_totp_devices
      WHERE user_id = :userId
      ORDER BY created_at ASC
    `,
    { userId }
  );

  return rows;
}

export async function addTotpDevice({ userId, deviceLabel, totpSecret }) {
  const [result] = await getPool().execute(
    `
      INSERT INTO user_totp_devices (user_id, device_label, totp_secret)
      VALUES (:userId, :deviceLabel, :totpSecret)
    `,
    { userId, deviceLabel, totpSecret }
  );

  await getPool().execute(
    'UPDATE users SET totp_secret = :totpSecret, totp_enabled = 1 WHERE id = :userId',
    { userId, totpSecret }
  );

  return result.insertId;
}

export async function touchTotpDevice(deviceId) {
  await getPool().execute(
    'UPDATE user_totp_devices SET last_used_at = CURRENT_TIMESTAMP WHERE id = :deviceId',
    { deviceId }
  );
}

export async function deleteTotpDevice(userId, deviceId) {
  const [result] = await getPool().execute(
    'DELETE FROM user_totp_devices WHERE id = :deviceId AND user_id = :userId',
    { deviceId, userId }
  );

  return result.affectedRows > 0;
}

export async function countTotpDevices(userId) {
  const [[row]] = await getPool().execute(
    'SELECT COUNT(*) AS total FROM user_totp_devices WHERE user_id = :userId',
    { userId }
  );

  return row.total;
}

export async function syncPrimaryTotpSecret(userId) {
  const [[device]] = await getPool().execute(
    `
      SELECT totp_secret
      FROM user_totp_devices
      WHERE user_id = :userId
      ORDER BY created_at ASC
      LIMIT 1
    `,
    { userId }
  );

  if (!device) {
    await getPool().execute(
      'UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = :userId',
      { userId }
    );
    return;
  }

  await getPool().execute(
    'UPDATE users SET totp_secret = :totpSecret, totp_enabled = 1 WHERE id = :userId',
    { userId, totpSecret: device.totp_secret }
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

  const ocr = await getNotaOcrByOrderCode(orderCode);

  return {
    ...order,
    files,
    ocr
  };
}

/* ===== Nota OCR ===== */

export async function createNotaOcrPending({ orderId, orderCode, itemCountExpected }) {
  await getPool().execute(
    `
      INSERT INTO nota_ocr_results (
        order_id,
        order_code,
        status,
        item_count_expected
      )
      VALUES (:orderId, :orderCode, 'processing', :itemCountExpected)
      ON DUPLICATE KEY UPDATE
        status = IF(status = 'completed', status, 'processing'),
        item_count_expected = VALUES(item_count_expected),
        error_message = NULL
    `,
    { orderId, orderCode, itemCountExpected }
  );
}

export async function saveNotaOcrSuccess({
  orderId,
  orderCode,
  notaOrderCode,
  notaDate,
  itemCountDetected,
  itemCountExpected,
  itemCountMatch,
  customerAnonId,
  ocrEngine,
  ocrConfidence,
  items
}) {
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      `
        INSERT INTO nota_ocr_results (
          order_id,
          order_code,
          status,
          nota_order_code,
          nota_date,
          item_count_detected,
          item_count_expected,
          item_count_match,
          customer_anon_id,
          ocr_engine,
          ocr_confidence,
          error_message
        )
        VALUES (
          :orderId,
          :orderCode,
          'completed',
          :notaOrderCode,
          :notaDate,
          :itemCountDetected,
          :itemCountExpected,
          :itemCountMatch,
          :customerAnonId,
          :ocrEngine,
          :ocrConfidence,
          NULL
        )
        ON DUPLICATE KEY UPDATE
          status = 'completed',
          nota_order_code = VALUES(nota_order_code),
          nota_date = VALUES(nota_date),
          item_count_detected = VALUES(item_count_detected),
          item_count_expected = VALUES(item_count_expected),
          item_count_match = VALUES(item_count_match),
          customer_anon_id = VALUES(customer_anon_id),
          ocr_engine = VALUES(ocr_engine),
          ocr_confidence = VALUES(ocr_confidence),
          error_message = NULL
      `,
      {
        orderId,
        orderCode,
        notaOrderCode,
        notaDate,
        itemCountDetected,
        itemCountExpected,
        itemCountMatch: itemCountMatch ? 1 : 0,
        customerAnonId,
        ocrEngine,
        ocrConfidence
      }
    );

    const [[resultRow]] = await connection.execute(
      'SELECT id FROM nota_ocr_results WHERE order_id = :orderId LIMIT 1',
      { orderId }
    );

    await connection.execute(
      'DELETE FROM nota_ocr_items WHERE ocr_result_id = :ocrResultId',
      { ocrResultId: resultRow.id }
    );

    for (const item of items) {
      await connection.execute(
        `
          INSERT INTO nota_ocr_items (
            ocr_result_id,
            line_index,
            product_type,
            qty,
            size_text,
            file_name_hint
          )
          VALUES (
            :ocrResultId,
            :lineIndex,
            :productType,
            :qty,
            :sizeText,
            :fileNameHint
          )
        `,
        {
          ocrResultId: resultRow.id,
          lineIndex: item.line_index,
          productType: item.product_type,
          qty: item.qty,
          sizeText: item.size_text,
          fileNameHint: item.file_name_hint
        }
      );
    }

    await connection.commit();
    return getNotaOcrByOrderCode(orderCode);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function saveNotaOcrFailure({ orderId, orderCode, itemCountExpected, errorMessage }) {
  await getPool().execute(
    `
      INSERT INTO nota_ocr_results (
        order_id,
        order_code,
        status,
        item_count_expected,
        error_message
      )
      VALUES (:orderId, :orderCode, 'failed', :itemCountExpected, :errorMessage)
      ON DUPLICATE KEY UPDATE
        status = 'failed',
        item_count_expected = VALUES(item_count_expected),
        error_message = VALUES(error_message)
    `,
    {
      orderId,
      orderCode,
      itemCountExpected,
      errorMessage: String(errorMessage || 'OCR gagal.').slice(0, 4000)
    }
  );
}

export async function getNotaOcrByOrderCode(orderCode) {
  if (!(await tableExists('nota_ocr_results'))) {
    return null;
  }

  const [[result]] = await getPool().execute(
    'SELECT * FROM nota_ocr_results WHERE order_code = :orderCode LIMIT 1',
    { orderCode }
  );

  if (!result) {
    return null;
  }

  const [items] = await getPool().execute(
    `
      SELECT line_index, product_type, qty, size_text, file_name_hint
      FROM nota_ocr_items
      WHERE ocr_result_id = :ocrResultId
      ORDER BY line_index ASC
    `,
    { ocrResultId: result.id }
  );

  return {
    ...result,
    item_count_match: result.item_count_match === null ? null : Boolean(result.item_count_match),
    items
  };
}

export async function countDesignFilesForOrder(orderId) {
  const [[row]] = await getPool().execute(
    `
      SELECT COUNT(*) AS total
      FROM order_files
      WHERE order_id = :orderId
        AND file_role = 'design'
    `,
    { orderId }
  );

  return row.total;
}

export async function updateOrderItemCount(orderId, itemCount) {
  await getPool().execute(
    'UPDATE orders SET item_count = :itemCount WHERE id = :orderId',
    { orderId, itemCount }
  );
}

export async function getOrderFileById(fileId, orderCode) {
  const [[file]] = await getPool().execute(
    `
      SELECT *
      FROM order_files
      WHERE id = :fileId
        AND order_code = :orderCode
      LIMIT 1
    `,
    { fileId, orderCode }
  );

  return file || null;
}

export async function deleteOrderFileById(fileId) {
  await getPool().execute(
    'DELETE FROM order_files WHERE id = :fileId',
    { fileId }
  );
}

export async function deleteOcrItemByLineIndex(ocrResultId, lineIndex) {
  await getPool().execute(
    `
      DELETE FROM nota_ocr_items
      WHERE ocr_result_id = :ocrResultId
        AND line_index = :lineIndex
    `,
    { ocrResultId, lineIndex }
  );
}

export async function recalculateOcrItemTotals(orderCode, itemCountExpected = null) {
  const [[ocr]] = await getPool().execute(
    'SELECT * FROM nota_ocr_results WHERE order_code = :orderCode LIMIT 1',
    { orderCode }
  );

  if (!ocr) {
    return null;
  }

  const [[countRow]] = await getPool().execute(
    'SELECT COUNT(*) AS total FROM nota_ocr_items WHERE ocr_result_id = :ocrResultId',
    { ocrResultId: ocr.id }
  );

  const detected = countRow.total > 0 ? countRow.total : ocr.item_count_detected;
  const expected = itemCountExpected ?? ocr.item_count_expected;
  const itemCountMatch = detected === null ? null : detected === expected;

  await getPool().execute(
    `
      UPDATE nota_ocr_results
      SET
        item_count_detected = :itemCountDetected,
        item_count_expected = :itemCountExpected,
        item_count_match = :itemCountMatch
      WHERE id = :ocrResultId
    `,
    {
      ocrResultId: ocr.id,
      itemCountDetected: detected,
      itemCountExpected: expected,
      itemCountMatch: itemCountMatch === null ? null : itemCountMatch ? 1 : 0
    }
  );

  return getNotaOcrByOrderCode(orderCode);
}

export function buildFileKey(file) {
  return `${file.file_role}:${file.item_index ?? 0}:${file.design_index ?? 0}`;
}

export function buildJobFileKey(file) {
  return `${file.fileRole}:${file.itemIndex ?? 0}:${file.designIndex ?? 0}`;
}
