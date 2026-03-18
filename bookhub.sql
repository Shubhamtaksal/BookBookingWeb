-- =========================
-- BOOKHUB FULL DATABASE SQL
-- =========================

CREATE DATABASE IF NOT EXISTS bookhub;
USE bookhub;

-- -------------------------
-- 1) USERS TABLE
-- -------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fullname VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('USER','ADMIN') DEFAULT 'USER',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------
-- 2) CATEGORIES TABLE
-- -------------------------
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------
-- 3) BOOKS TABLE
-- -------------------------
CREATE TABLE IF NOT EXISTS books (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  author VARCHAR(120) NOT NULL,
  category_id INT,
  available INT DEFAULT 1,
  price INT DEFAULT 0,
  discount INT DEFAULT 0,
  image VARCHAR(255) DEFAULT '/uploads/default.png',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_books_category
    FOREIGN KEY (category_id) REFERENCES categories(id)
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- -------------------------
-- 4) ORDERS TABLE
-- -------------------------
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  total INT DEFAULT 0,
  status VARCHAR(40) DEFAULT 'PLACED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- -------------------------
-- 5) ORDER_ITEMS TABLE
-- -------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  book_id INT NOT NULL,
  qty INT DEFAULT 1,
  price INT DEFAULT 0,
  CONSTRAINT fk_items_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_items_book
    FOREIGN KEY (book_id) REFERENCES books(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- -------------------------
-- 6) INDEXES (safe)
-- -------------------------
CREATE INDEX idx_books_name ON books(name);
CREATE INDEX idx_books_cat ON books(category_id);
CREATE INDEX idx_orders_user ON orders(user_id);

-- -------------------------
-- 7) INSERT CATEGORIES
-- -------------------------
INSERT IGNORE INTO categories(name)
VALUES ('Programming'), ('DBMS'), ('General');

-- -------------------------
-- 8) INSERT SAMPLE BOOKS
-- -------------------------
-- Programming -> Python Crash Course
INSERT INTO books(name, author, category_id, available, price, discount, image)
SELECT 'Python Crash Course', 'Eric Matthes',
       (SELECT id FROM categories WHERE name='Programming'),
       8, 599, 15, '/uploads/default.png'
WHERE NOT EXISTS (SELECT 1 FROM books WHERE name='Python Crash Course');

-- DBMS -> DBMS
INSERT INTO books(name, author, category_id, available, price, discount, image)
SELECT 'DBMS', 'Korth',
       (SELECT id FROM categories WHERE name='DBMS'),
       4, 499, 30, '/uploads/default.png'
WHERE NOT EXISTS (SELECT 1 FROM books WHERE name='DBMS');

-- Programming -> Let Us C
INSERT INTO books(name, author, category_id, available, price, discount, image)
SELECT 'Let Us C', 'Y. Kanetkar',
       (SELECT id FROM categories WHERE name='Programming'),
       5, 399, 25, '/uploads/default.png'
WHERE NOT EXISTS (SELECT 1 FROM books WHERE name='Let Us C');

-- -------------------------
-- 9) OPTIONAL: DEFAULT ADMIN (only if you want)
-- -------------------------
-- NOTE: जर तुझ्या Node.js मध्ये password hashing असेल,
--       तर इथून plain password टाकू नको.
--       हवं असेल तर खालील query वापर.
INSERT IGNORE INTO users(fullname, email, password, role)
VALUES ('Admin', 'admin@bookhub.com', 'admin123', 'ADMIN');

-- -------------------------
-- 10) CHECK TABLES
-- -------------------------
SHOW TABLES;
SELECT * FROM categories;
SELECT id, name, author, price, discount, image FROM books;
