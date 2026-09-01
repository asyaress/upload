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
