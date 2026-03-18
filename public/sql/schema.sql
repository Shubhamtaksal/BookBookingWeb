DROP DATABASE IF EXISTS bookhub;
CREATE DATABASE bookhub;
USE bookhub;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fullname VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('USER','ADMIN') DEFAULT 'USER',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE books (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  author VARCHAR(120) NOT NULL,
  category_id INT NOT NULL,
  available INT DEFAULT 1,
  price INT DEFAULT 0,
  discount INT DEFAULT 0,
  image VARCHAR(255) DEFAULT '/uploads/default.png',
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_books_cat FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  total INT NOT NULL DEFAULT 0,
  status ENUM('PLACED','PAID','SHIPPED','DELIVERED','CANCELLED') DEFAULT 'PLACED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  book_id INT NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  price_each INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_items_book FOREIGN KEY (book_id) REFERENCES books(id)
);

INSERT INTO categories(name) VALUES
('Programming'),
('DBMS'),
('Self Help'),
('Fiction'),
('General');

INSERT INTO books(name, author, category_id, available, price, discount, image, is_active)
SELECT 'Python Crash Course', 'Eric Matthes', c.id, 8, 599, 15, '/uploads/python.jpg', 1
FROM categories c WHERE c.name='Programming';

INSERT INTO books(name, author, category_id, available, price, discount, image, is_active)
SELECT 'DBMS', 'Korth', c.id, 4, 499, 30, '/uploads/dbms.jpg', 1
FROM categories c WHERE c.name='DBMS';

INSERT INTO books(name, author, category_id, available, price, discount, image, is_active)
SELECT 'Atomic Habits', 'James Clear', c.id, 10, 699, 20, '/uploads/atomic-habits.jpg', 1
FROM categories c WHERE c.name='Self Help';