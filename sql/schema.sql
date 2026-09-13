CREATE DATABASE IF NOT EXISTS tesis_orders
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tesis_orders;

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
  UNIQUE KEY uq_orders_order_code (order_code)
);

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
);

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
);

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
);
