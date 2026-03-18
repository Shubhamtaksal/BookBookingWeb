require("dotenv").config();
const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// DB
// =====================================================
const db = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "bookhub",
  connectionLimit: 10,
});

// =====================================================
// APP CONFIG
// =====================================================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// =====================================================
// SESSION
// =====================================================
app.use(
  session({
    secret: process.env.SESSION_SECRET || "bookhub_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

// =====================================================
// UPLOADS
// =====================================================
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "-");
    cb(null, Date.now() + "-" + safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
});

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    cb(null, "profile-" + Date.now() + path.extname(file.originalname));
  },
});

const uploadProfile = multer({
  storage: profileStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
});

// =====================================================
// HELPERS
// =====================================================
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "ADMIN") {
    return res.status(403).send("Forbidden");
  }
  next();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function ensureCart(req) {
  if (!req.session.cart) req.session.cart = [];
}

function cartCount(req) {
  ensureCart(req);
  return req.session.cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

function calculateFinalPrice(price, discount) {
  const p = Number(price || 0);
  const d = Number(discount || 0);
  return Math.max(0, Math.round(p - (p * d) / 100));
}

// =====================================================
// GLOBAL LOCALS
// =====================================================
app.use(async (req, res, next) => {
  try {
    ensureCart(req);

    res.locals.user = req.session.user || null;
    res.locals.isAdmin = req.session.user?.role === "ADMIN";
    res.locals.cartCount = cartCount(req);
    res.locals.wishlistCount = 0;

    if (req.session.user) {
      const [wishRows] = await db.query(
        "SELECT COUNT(*) AS total FROM wishlist WHERE user_id = ?",
        [req.session.user.id]
      );
      res.locals.wishlistCount = wishRows[0]?.total || 0;
    }

    next();
  } catch (err) {
    console.error("GLOBAL LOCALS ERROR:", err);
    res.locals.user = req.session.user || null;
    res.locals.isAdmin = req.session.user?.role === "ADMIN";
    res.locals.cartCount = cartCount(req);
    res.locals.wishlistCount = 0;
    next();
  }
});

// =====================================================
// HOME
// =====================================================
app.get("/", async (req, res) => {
  try {
    const [categories] = await db.query(
      "SELECT * FROM categories ORDER BY name"
    );

    const [featuredBooks] = await db.query(`
      SELECT b.*, c.name AS category_name
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.is_active = 1
      ORDER BY b.id DESC
      LIMIT 8
    `);

    res.render("index", {
      categories,
      featuredBooks,
    });
  } catch (err) {
    console.error("HOME ERROR:", err);
    res.status(500).send("Home page load error");
  }
});

// =====================================================
// AUTH
// =====================================================
app.get("/register", (req, res) => {
  res.render("register", { error: null });
});

app.post("/register", async (req, res) => {
  try {
    const fullname = String(req.body.fullname || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!fullname || !email || !password) {
      return res.render("register", { error: "All fields are required." });
    }

    const [existing] = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existing.length) {
      return res.render("register", { error: "Email already registered." });
    }

    const hash = await bcrypt.hash(password, 10);

    await db.query(
      "INSERT INTO users(fullname, email, password_hash, role) VALUES(?, ?, ?, ?)",
      [fullname, email, hash, "USER"]
    );

    res.redirect("/login");
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.render("register", { error: "Registration failed." });
  }
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const loginType = String(req.body.loginType || "user").trim().toLowerCase();

    const [rows] = await db.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (!rows.length) {
      return res.render("login", { error: "Invalid email or password." });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      return res.render("login", { error: "Invalid email or password." });
    }

    if (loginType === "admin" && user.role !== "ADMIN") {
      return res.render("login", {
        error: "This account is not an admin account.",
      });
    }

    req.session.user = {
      id: user.id,
      fullname: user.fullname,
      email: user.email,
      role: user.role,
    };

    if (user.role === "ADMIN") return res.redirect("/admin");
    return res.redirect("/books");
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.render("login", { error: "Login failed." });
  }
});

app.get("/admin-login", (req, res) => {
  res.render("admin_login", { error: null });
});

app.post("/admin-login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    const [rows] = await db.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (!rows.length) {
      return res.render("admin_login", {
        error: "Invalid admin email or password.",
      });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok || user.role !== "ADMIN") {
      return res.render("admin_login", {
        error: "Invalid admin email or password.",
      });
    }

    req.session.user = {
      id: user.id,
      fullname: user.fullname,
      email: user.email,
      role: user.role,
    };

    res.redirect("/admin");
  } catch (err) {
    console.error("ADMIN LOGIN ERROR:", err);
    res.render("admin_login", { error: "Admin login failed." });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// =====================================================
// BOOKS
// =====================================================
app.get("/books", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const category = String(req.query.category || "").trim();

    const [categories] = await db.query(
      "SELECT * FROM categories ORDER BY name"
    );

    let sql = `
      SELECT b.*, c.name AS category_name
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.is_active = 1
    `;
    const params = [];

    if (q) {
      sql += " AND (b.name LIKE ? OR b.author LIKE ? OR c.name LIKE ?)";
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    if (category) {
      sql += " AND c.name = ?";
      params.push(category);
    }

    sql += " ORDER BY b.id DESC";

    const [books] = await db.query(sql, params);

    res.render("books", {
      books,
      categories,
      q,
      category,
    });
  } catch (err) {
    console.error("BOOKS ERROR:", err);
    res.status(500).send("Books page load error");
  }
});

app.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    const [books] = await db.query(
      `
      SELECT b.*, c.name AS category_name
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.is_active = 1
      AND (b.name LIKE ? OR b.author LIKE ?)
      ORDER BY b.id DESC
      `,
      [`%${q}%`, `%${q}%`]
    );

    res.render("search", { books, q });
  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).send("Search error");
  }
});

app.get("/books/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [rows] = await db.query(
      `
      SELECT b.*, c.name AS category_name
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.id = ? AND b.is_active = 1
      `,
      [id]
    );

    if (!rows.length) return res.status(404).send("Book not found");

    const book = rows[0];

    const [similar] = await db.query(
      `
      SELECT b.*, c.name AS category_name
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.category_id = ? AND b.id <> ? AND b.is_active = 1
      ORDER BY b.id DESC
      LIMIT 4
      `,
      [book.category_id, id]
    );

    const [reviews] = await db.query(
      `
      SELECT r.*, u.fullname
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      WHERE r.book_id = ?
      ORDER BY r.id DESC
      `,
      [id]
    );

    const [avg] = await db.query(
      "SELECT AVG(rating) AS avgRating FROM reviews WHERE book_id = ?",
      [id]
    );

    res.render("book_details", {
      book,
      similar,
      reviews,
      avgRating: avg[0].avgRating || 0,
    });
  } catch (err) {
    console.error("BOOK DETAILS ERROR:", err);
    res.status(500).send("Book details load error");
  }
});

// =====================================================
// REVIEWS
// =====================================================
app.post("/review/add/:id", requireLogin, async (req, res) => {
  try {
    const bookId = Number(req.params.id);
    const rating = Number(req.body.rating || 5);
    const comment = String(req.body.comment || "").trim();

    await db.query(
      `
      INSERT INTO reviews(user_id, book_id, rating, comment)
      VALUES(?,?,?,?)
      ON DUPLICATE KEY UPDATE rating=?, comment=?
      `,
      [req.session.user.id, bookId, rating, comment, rating, comment]
    );

    res.redirect("/books/" + bookId);
  } catch (err) {
    console.error("REVIEW ERROR:", err);
    res.send("Review error");
  }
});

app.get("/review/delete/:id/:bookId", requireLogin, async (req, res) => {
  try {
    await db.query(
      "DELETE FROM reviews WHERE id = ? AND user_id = ?",
      [req.params.id, req.session.user.id]
    );

    res.redirect("/books/" + req.params.bookId);
  } catch (err) {
    console.error("DELETE REVIEW ERROR:", err);
    res.send("Delete error");
  }
});

// =====================================================
// WISHLIST
// =====================================================
app.get("/wishlist", requireLogin, async (req, res) => {
  try {
    const [items] = await db.query(
      `
      SELECT w.id AS wishlist_id, b.*, c.name AS category_name
      FROM wishlist w
      JOIN books b ON b.id = w.book_id
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE w.user_id = ?
      ORDER BY w.id DESC
      `,
      [req.session.user.id]
    );

    res.render("wishlist", { items });
  } catch (err) {
    console.error("WISHLIST PAGE ERROR:", err);
    res.status(500).send("Wishlist load error");
  }
});

app.get("/wishlist/add/:id", requireLogin, async (req, res) => {
  try {
    const bookId = Number(req.params.id);

    await db.query(
      "INSERT IGNORE INTO wishlist(user_id, book_id) VALUES(?, ?)",
      [req.session.user.id, bookId]
    );

    res.redirect("back");
  } catch (err) {
    console.error("WISHLIST ADD ERROR:", err);
    res.redirect("/books");
  }
});

app.get("/wishlist/remove/:id", requireLogin, async (req, res) => {
  try {
    const bookId = Number(req.params.id);

    await db.query(
      "DELETE FROM wishlist WHERE user_id = ? AND book_id = ?",
      [req.session.user.id, bookId]
    );

    res.redirect("back");
  } catch (err) {
    console.error("WISHLIST REMOVE ERROR:", err);
    res.redirect("/wishlist");
  }
});

// =====================================================
// CART
// =====================================================
app.get("/cart/add/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [rows] = await db.query(
      `
      SELECT b.*, c.name AS category_name
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.id = ? AND b.is_active = 1
      `,
      [id]
    );

    if (!rows.length) return res.redirect("/books");

    const book = rows[0];
    const finalPrice = calculateFinalPrice(book.price, book.discount);

    ensureCart(req);

    const existing = req.session.cart.find((item) => item.id === id);

    if (existing) {
      if (existing.qty < Number(book.available || 0)) {
        existing.qty += 1;
        existing.lineTotal = existing.qty * existing.finalPrice;
      }
    } else {
      req.session.cart.push({
        id: book.id,
        name: book.name,
        author: book.author,
        category_name: book.category_name || "Book",
        image: book.image || "/uploads/default.png",
        price: Number(book.price || 0),
        discount: Number(book.discount || 0),
        finalPrice,
        available: Number(book.available || 0),
        qty: 1,
        lineTotal: finalPrice,
      });
    }

    res.redirect("/cart");
  } catch (err) {
    console.error("CART ADD ERROR:", err);
    res.send("Error adding to cart");
  }
});

app.get("/cart", (req, res) => {
  ensureCart(req);
  const cart = req.session.cart;
  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.lineTotal || 0),
    0
  );

  res.render("cart", { cart, subtotal });
});

app.get("/cart/increase/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    ensureCart(req);

    const [rows] = await db.query(
      "SELECT available FROM books WHERE id = ?",
      [id]
    );

    const available = rows.length ? Number(rows[0].available || 0) : 0;
    const item = req.session.cart.find((x) => x.id === id);

    if (item && item.qty < available) {
      item.qty += 1;
      item.lineTotal = item.qty * item.finalPrice;
    }

    res.redirect("/cart");
  } catch (err) {
    console.error("CART INCREASE ERROR:", err);
    res.redirect("/cart");
  }
});

app.get("/cart/decrease/:id", (req, res) => {
  const id = Number(req.params.id);
  ensureCart(req);

  const item = req.session.cart.find((x) => x.id === id);

  if (item) {
    item.qty -= 1;

    if (item.qty <= 0) {
      req.session.cart = req.session.cart.filter((x) => x.id !== id);
    } else {
      item.lineTotal = item.qty * item.finalPrice;
    }
  }

  res.redirect("/cart");
});

app.get("/cart/remove/:id", (req, res) => {
  const id = Number(req.params.id);
  ensureCart(req);
  req.session.cart = req.session.cart.filter((x) => x.id !== id);
  res.redirect("/cart");
});

app.get("/cart/clear", (req, res) => {
  req.session.cart = [];
  res.redirect("/cart");
});

// =====================================================
// CHECKOUT / ORDER PLACE
// =====================================================
app.get("/checkout", requireLogin, (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect("/cart");

  const total = cart.reduce(
    (sum, item) => sum + Number(item.lineTotal || 0),
    0
  );

  res.render("checkout", {
    cart,
    total,
    error: null,
    formData: {
      full_name: req.session.user?.fullname || "",
      email_address: req.session.user?.email || "",
      phone: "",
      city: "",
      pincode: "",
      address_line: "",
    },
    razorpayEnabled: false,
  });
});

app.post("/order/place", requireLogin, async (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect("/cart");

  const conn = await db.getConnection();

  try {
    const full_name = String(req.body.full_name || "").trim();
    const email_address = String(req.body.email_address || "").trim();
    const phone = String(req.body.phone || "").trim();
    const city = String(req.body.city || "").trim();
    const pincode = String(req.body.pincode || "").trim();
    const address_line = String(req.body.address_line || "").trim();
    const payment_method = String(req.body.payment_method || "COD")
      .trim()
      .toUpperCase();

    if (
      !full_name ||
      !email_address ||
      !phone ||
      !city ||
      !pincode ||
      !address_line
    ) {
      const total = cart.reduce(
        (sum, item) => sum + Number(item.lineTotal || 0),
        0
      );

      return res.render("checkout", {
        cart,
        total,
        error: "Please fill all delivery details.",
        formData: {
          full_name,
          email_address,
          phone,
          city,
          pincode,
          address_line,
        },
        razorpayEnabled: false,
      });
    }

    await conn.beginTransaction();

    let total = 0;

    for (const item of cart) {
      const [rows] = await conn.query(
        "SELECT id, name, available, price, discount, is_active FROM books WHERE id = ? FOR UPDATE",
        [item.id]
      );

      if (!rows.length || Number(rows[0].is_active) !== 1) {
        throw new Error(`Book not available: ${item.name}`);
      }

      const dbBook = rows[0];
      const qty = Number(item.qty || 0);

      if (qty <= 0 || qty > Number(dbBook.available || 0)) {
        throw new Error(`Insufficient stock for ${dbBook.name}`);
      }

      total += calculateFinalPrice(dbBook.price, dbBook.discount) * qty;
    }

    const [orderRes] = await conn.query(
      `
      INSERT INTO orders
      (user_id, total, status, full_name, email_address, phone, city, pincode, address_line, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.session.user.id,
        total,
        payment_method === "COD" ? "PLACED" : "PAID",
        full_name,
        email_address,
        phone,
        city,
        pincode,
        address_line,
        payment_method,
      ]
    );

    const orderId = orderRes.insertId;

    for (const item of cart) {
      const [rows] = await conn.query(
        "SELECT id, price, discount FROM books WHERE id = ? FOR UPDATE",
        [item.id]
      );

      const dbBook = rows[0];
      const qty = Number(item.qty || 0);
      const finalPrice = calculateFinalPrice(dbBook.price, dbBook.discount);

      await conn.query(
        "INSERT INTO order_items(order_id, book_id, qty, price_each) VALUES (?, ?, ?, ?)",
        [orderId, item.id, qty, finalPrice]
      );

      await conn.query(
        "UPDATE books SET available = available - ? WHERE id = ?",
        [qty, item.id]
      );
    }

    await conn.commit();
    req.session.cart = [];

    res.redirect(`/payment/success?order_id=${orderId}`);
  } catch (err) {
    await conn.rollback();
    console.error("ORDER PLACE ERROR:", err);
    res.status(500).send(err.message || "Order placement failed.");
  } finally {
    conn.release();
  }
});

// =====================================================
// PAYMENT SUCCESS
// =====================================================
app.get("/payment/success", requireLogin, async (req, res) => {
  try {
    const orderId = Number(req.query.order_id || 0);

    const [rows] = await db.query(
      `
      SELECT o.*, u.fullname, u.email
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.id = ? AND o.user_id = ?
      `,
      [orderId, req.session.user.id]
    );

    if (!rows.length) return res.redirect("/my-orders");

    res.render("payment_success", { order: rows[0] });
  } catch (err) {
    console.error("PAYMENT SUCCESS ERROR:", err);
    res.status(500).send("Payment success page error");
  }
});

// =====================================================
// MY ORDERS
// =====================================================
app.get("/my-orders", requireLogin, async (req, res) => {
  try {
    const [orders] = await db.query(
      "SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC",
      [req.session.user.id]
    );

    res.render("order", {
      orders,
      placed: req.query.placed || "",
    });
  } catch (err) {
    console.error("MY ORDERS ERROR:", err);
    res.status(500).send("My orders load error");
  }
});

// =====================================================
// ORDER DETAILS
// =====================================================
app.get("/my-orders/:id", requireLogin, async (req, res) => {
  try {
    const orderId = Number(req.params.id);

    const [oRows] = await db.query(
      `
      SELECT o.*, u.fullname, u.email
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.id = ? AND o.user_id = ?
      `,
      [orderId, req.session.user.id]
    );

    if (!oRows.length) {
      return res.status(404).send("Order not found");
    }

    const order = oRows[0];

    const [items] = await db.query(
      `
      SELECT oi.*, b.name, b.author, b.image
      FROM order_items oi
      JOIN books b ON b.id = oi.book_id
      WHERE oi.order_id = ?
      ORDER BY oi.id DESC
      `,
      [orderId]
    );

    const itemsTotal = items.reduce((sum, item) => {
      return sum + Number(item.price_each || 0) * Number(item.qty || 0);
    }, 0);

    res.render("order_details", {
      order,
      items,
      itemsTotal,
    });
  } catch (err) {
    console.error("ORDER DETAILS ERROR:", err);
    res.status(500).send("Order details load error");
  }
});

// =====================================================
// CANCEL ORDER
// =====================================================
app.post("/my-orders/:id/cancel", requireLogin, async (req, res) => {
  const orderId = Number(req.params.id);
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [orderRows] = await conn.query(
      "SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE",
      [orderId, req.session.user.id]
    );

    if (!orderRows.length) {
      await conn.rollback();
      return res.status(404).send("Order not found");
    }

    const order = orderRows[0];

    if (!["PLACED", "PAID"].includes(String(order.status || "").toUpperCase())) {
      await conn.rollback();
      return res.status(400).send("This order cannot be cancelled now.");
    }

    const [items] = await conn.query(
      "SELECT * FROM order_items WHERE order_id = ?",
      [orderId]
    );

    for (const item of items) {
      await conn.query(
        "UPDATE books SET available = available + ? WHERE id = ?",
        [Number(item.qty || 0), item.book_id]
      );
    }

    await conn.query(
      "UPDATE orders SET status = ? WHERE id = ?",
      ["CANCELLED", orderId]
    );

    await conn.commit();
    res.redirect(`/my-orders/${orderId}`);
  } catch (err) {
    await conn.rollback();
    console.error("CANCEL ORDER ERROR:", err);
    res.status(500).send("Unable to cancel order");
  } finally {
    conn.release();
  }
});

// =====================================================
// INVOICE DOWNLOAD
// =====================================================
app.get("/my-orders/:id/invoice", requireLogin, async (req, res) => {
  try {
    const orderId = Number(req.params.id);

    const [oRows] = await db.query(
      `
      SELECT o.*, u.fullname, u.email
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.id = ? AND o.user_id = ?
      `,
      [orderId, req.session.user.id]
    );

    if (!oRows.length) {
      return res.status(404).send("Order not found");
    }

    const order = oRows[0];

    const [items] = await db.query(
      `
      SELECT oi.*, b.name, b.author
      FROM order_items oi
      JOIN books b ON b.id = oi.book_id
      WHERE oi.order_id = ?
      `,
      [orderId]
    );

    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=invoice-${order.id}.pdf`
    );

    doc.pipe(res);

    doc.fontSize(22).text("BookHub Invoice", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`Order ID: #${order.id}`);
    doc.text(`Date: ${new Date(order.created_at).toLocaleString()}`);
    doc.text(`Customer: ${order.full_name || order.fullname || ""}`);
    doc.text(`Email: ${order.email_address || order.email || ""}`);
    doc.text(`Phone: ${order.phone || ""}`);
    doc.text(`Payment Method: ${order.payment_method || "COD"}`);
    doc.text(`Status: ${order.status || ""}`);
    doc.moveDown();

    doc.fontSize(13).text("Delivery Address", { underline: true });
    doc.fontSize(11).text(
      `${order.address_line || ""}, ${order.city || ""} ${order.pincode || ""}`
    );
    doc.moveDown();

    doc.fontSize(13).text("Items", { underline: true });
    doc.moveDown(0.5);

    items.forEach((item, index) => {
      const lineTotal = Number(item.qty || 0) * Number(item.price_each || 0);

      doc.fontSize(11).text(
        `${index + 1}. ${item.name} by ${item.author} | Qty: ${item.qty} | Price: ₹${item.price_each} | Total: ₹${lineTotal}`
      );
      doc.moveDown(0.4);
    });

    doc.moveDown();
    doc.fontSize(14).text(`Grand Total: ₹${order.total}`, { align: "right" });

    doc.end();
  } catch (err) {
    console.error("INVOICE ERROR:", err);
    res.status(500).send("Invoice download error");
  }
});

// =====================================================
// PROFILE
// =====================================================
app.get("/profile", requireLogin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [
      req.session.user.id,
    ]);

    res.render("profile", { userData: rows[0] });
  } catch (err) {
    console.error("PROFILE PAGE ERROR:", err);
    res.send("Profile error");
  }
});

app.post(
  "/profile/update",
  requireLogin,
  uploadProfile.single("profile"),
  async (req, res) => {
    try {
      const { fullname, phone, city, gender } = req.body;

      const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [
        req.session.user.id,
      ]);
      const currentUser = rows[0];

      let image = currentUser.profile_image || null;

      if (req.file) {
        image = "/uploads/" + req.file.filename;
      }

      await db.query(
        "UPDATE users SET fullname = ?, phone = ?, city = ?, gender = ?, profile_image = ? WHERE id = ?",
        [fullname, phone, city, gender, image, req.session.user.id]
      );

      req.session.user.fullname = fullname;

      res.redirect("/profile");
    } catch (err) {
      console.error("PROFILE UPDATE ERROR:", err);
      res.send("Profile update error");
    }
  }
);

// =====================================================
// ADMIN DASHBOARD
// =====================================================
app.get("/admin", requireAdmin, async (req, res) => {
  try {
    const [[{ usersCount }]] = await db.query(
      "SELECT COUNT(*) AS usersCount FROM users"
    );
    const [[{ booksCount }]] = await db.query(
      "SELECT COUNT(*) AS booksCount FROM books"
    );
    const [[{ ordersCount }]] = await db.query(
      "SELECT COUNT(*) AS ordersCount FROM orders"
    );
    const [[{ revenueTotal }]] = await db.query(
      "SELECT COALESCE(SUM(total),0) AS revenueTotal FROM orders WHERE status <> 'CANCELLED'"
    );

    const [latestOrders] = await db.query(`
      SELECT o.id, o.total, o.status, o.created_at, u.fullname
      FROM orders o
      JOIN users u ON u.id = o.user_id
      ORDER BY o.id DESC
      LIMIT 5
    `);

    res.render("admin/dashboard", {
      usersCount,
      booksCount,
      ordersCount,
      revenueTotal,
      latestOrders,
    });
  } catch (err) {
    console.error("ADMIN DASHBOARD ERROR:", err);
    res.status(500).send("Admin dashboard load error");
  }
});

// =====================================================
// ADMIN BOOKS
// =====================================================
app.get("/admin/books", requireAdmin, async (req, res) => {
  try {
    const [books] = await db.query(`
      SELECT b.*, c.name AS category_name
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      ORDER BY b.id DESC
    `);

    res.render("admin/books", { books });
  } catch (err) {
    console.error("ADMIN BOOKS ERROR:", err);
    res.status(500).send("Admin books load error");
  }
});

app.get("/admin/books/new", requireAdmin, async (req, res) => {
  try {
    const [categories] = await db.query(
      "SELECT * FROM categories ORDER BY name"
    );

    res.render("admin/book_form", {
      mode: "new",
      book: null,
      categories,
      errors: [],
    });
  } catch (err) {
    console.error("ADMIN NEW BOOK PAGE ERROR:", err);
    res.status(500).send("Admin add book page error");
  }
});

app.post("/admin/books/new", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const author = String(req.body.author || "").trim();
    const category_id = Number(req.body.category_id || 0);
    const available = Number(req.body.available || 0);
    const price = Number(req.body.price || 0);
    const discount = Number(req.body.discount || 0);

    const image = req.file
      ? "/uploads/" + req.file.filename
      : "/uploads/default.png";

    await db.query(
      `
      INSERT INTO books(name, author, category_id, available, price, discount, image, is_active)
      VALUES(?,?,?,?,?,?,?,?)
      `,
      [name, author, category_id, available, price, discount, image, 1]
    );

    res.redirect("/admin/books");
  } catch (err) {
    console.error("ADMIN ADD BOOK ERROR:", err);
    res.status(500).send("Admin add book error");
  }
});

app.get("/admin/books/:id/edit", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [categories] = await db.query(
      "SELECT * FROM categories ORDER BY name"
    );
    const [rows] = await db.query("SELECT * FROM books WHERE id = ?", [id]);

    if (!rows.length) return res.redirect("/admin/books");

    res.render("admin/book_form", {
      mode: "edit",
      book: rows[0],
      categories,
      errors: [],
    });
  } catch (err) {
    console.error("ADMIN EDIT PAGE ERROR:", err);
    res.status(500).send("Admin edit page error");
  }
});

app.post("/admin/books/:id/edit", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || "").trim();
    const author = String(req.body.author || "").trim();
    const category_id = Number(req.body.category_id || 0);
    const available = Number(req.body.available || 0);
    const price = Number(req.body.price || 0);
    const discount = Number(req.body.discount || 0);
    const is_active = Number(req.body.is_active || 0);

    if (req.file) {
      const image = "/uploads/" + req.file.filename;

      await db.query(
        `
        UPDATE books
        SET name = ?, author = ?, category_id = ?, available = ?, price = ?, discount = ?, is_active = ?, image = ?
        WHERE id = ?
        `,
        [name, author, category_id, available, price, discount, is_active, image, id]
      );
    } else {
      await db.query(
        `
        UPDATE books
        SET name = ?, author = ?, category_id = ?, available = ?, price = ?, discount = ?, is_active = ?
        WHERE id = ?
        `,
        [name, author, category_id, available, price, discount, is_active, id]
      );
    }

    res.redirect("/admin/books");
  } catch (err) {
    console.error("ADMIN EDIT BOOK ERROR:", err);
    res.status(500).send("Admin edit book error");
  }
});

app.post("/admin/books/:id/delete", requireAdmin, async (req, res) => {
  try {
    await db.query("DELETE FROM books WHERE id = ?", [Number(req.params.id)]);
    res.redirect("/admin/books");
  } catch (err) {
    console.error("ADMIN DELETE BOOK ERROR:", err);
    res.status(500).send("Admin delete error");
  }
});

// =====================================================
// ADMIN CATEGORIES
// =====================================================
app.get("/admin/categories", requireAdmin, async (req, res) => {
  try {
    const [categories] = await db.query(`
      SELECT c.*,
      (SELECT COUNT(*) FROM books b WHERE b.category_id = c.id) AS books_count
      FROM categories c
      ORDER BY c.name
    `);

    res.render("admin/categories", { categories });
  } catch (err) {
    console.error("ADMIN CATEGORIES ERROR:", err);
    res.status(500).send("Categories load error");
  }
});

app.post("/admin/categories/new", requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.redirect("/admin/categories");

    await db.query("INSERT INTO categories(name) VALUES(?)", [name]);
    res.redirect("/admin/categories");
  } catch (err) {
    console.error("CATEGORY ADD ERROR:", err);
    res.redirect("/admin/categories");
  }
});

app.post("/admin/categories/:id/edit", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || "").trim();
    if (!name) return res.redirect("/admin/categories");

    await db.query("UPDATE categories SET name = ? WHERE id = ?", [name, id]);
    res.redirect("/admin/categories");
  } catch (err) {
    console.error("CATEGORY UPDATE ERROR:", err);
    res.redirect("/admin/categories");
  }
});

app.post("/admin/categories/:id/delete", requireAdmin, async (req, res) => {
  try {
    await db.query("DELETE FROM categories WHERE id = ?", [
      Number(req.params.id),
    ]);
    res.redirect("/admin/categories");
  } catch (err) {
    console.error("CATEGORY DELETE ERROR:", err);
    res.redirect("/admin/categories");
  }
});

// =====================================================
// ADMIN ORDERS
// =====================================================
app.get("/admin/orders", requireAdmin, async (req, res) => {
  try {
    const [orders] = await db.query(`
      SELECT o.*, u.fullname, u.email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.id DESC
    `);

    res.render("admin/orders", { orders });
  } catch (err) {
    console.error("ADMIN ORDERS ERROR:", err);
    res.status(500).send("Admin orders load error");
  }
});

app.get("/admin/orders/:id", requireAdmin, async (req, res) => {
  try {
    const orderId = Number(req.params.id);

    const [oRows] = await db.query(
      `
      SELECT o.*, u.fullname, u.email
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.id = ?
      `,
      [orderId]
    );

    if (!oRows.length) return res.status(404).send("Order not found");

    const order = oRows[0];

    const [items] = await db.query(
      `
      SELECT oi.*, b.name, b.author, b.image
      FROM order_items oi
      JOIN books b ON b.id = oi.book_id
      WHERE oi.order_id = ?
      ORDER BY oi.id DESC
      `,
      [orderId]
    );

    const itemsTotal = items.reduce(
      (sum, item) => sum + Number(item.price_each || 0) * Number(item.qty || 0),
      0
    );

    res.render("admin/order_details", {
      order,
      items,
      itemsTotal,
    });
  } catch (err) {
    console.error("ADMIN ORDER DETAILS ERROR:", err);
    res.status(500).send("Admin order details load error");
  }
});

app.post("/admin/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body.status || "").trim();

    const allowed = [
      "PLACED",
      "PAID",
      "SHIPPED",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "CANCELLED",
    ];

    if (!allowed.includes(status)) {
      return res.status(400).send("Invalid status");
    }

    await db.query("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
    res.redirect("/admin/orders");
  } catch (err) {
    console.error("ADMIN STATUS UPDATE ERROR:", err);
    res.status(500).send("Admin order status update error");
  }
});

// =====================================================
// 404
// =====================================================
app.use((req, res) => {
  res.status(404).send("Page not found");
});

// =====================================================
// START
// =====================================================
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});