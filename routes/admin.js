// routes/admin.js
const express = require("express");
const db = require("../db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { requireAdmin } = require("../middleware/auth");
const { bookRules } = require("../middleware/validators");
const { validationResult } = require("express-validator");

const router = express.Router();

// ensure uploads folder exists
const uploadDir = path.join(__dirname, "..", "public", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

const fileFilter = (req, file, cb) => {
  const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
  cb(ok ? null : new Error("Only JPG/PNG/WEBP allowed"), ok);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
});

router.get("/admin", requireAdmin, async (req, res) => {
  const [[stats]] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM books) AS books,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COALESCE(SUM(total),0) FROM orders) AS revenue
  `);
  res.render("admin/dashboard", { stats });
});

router.get("/admin/books", requireAdmin, async (req, res) => {
  const [books] = await db.query(
    `SELECT b.*, c.name AS category_name
     FROM books b JOIN categories c ON c.id=b.category_id
     ORDER BY b.created_at DESC`
  );
  res.render("admin/books", { books });
});

router.get("/admin/books/new", requireAdmin, async (req, res) => {
  const [categories] = await db.query("SELECT * FROM categories ORDER BY name");
  res.render("admin/book_form", { mode: "new", book: null, categories, errors: [] });
});

router.post("/admin/books/new", requireAdmin, upload.single("image"), bookRules, async (req, res) => {
  const errors = validationResult(req);
  const [categories] = await db.query("SELECT * FROM categories ORDER BY name");

  if (!errors.isEmpty()) {
    return res.render("admin/book_form", {
      mode: "new",
      book: req.body,
      categories,
      errors: errors.array(),
    });
  }

  const image = req.file ? "/uploads/" + req.file.filename : "/uploads/default.png";
  const { name, author, category_id, price, discount, stock } = req.body;

  await db.query(
    "INSERT INTO books(name,author,category_id,price,discount,stock,image) VALUES (?,?,?,?,?,?,?)",
    [name, author, category_id, price, discount, stock, image]
  );

  res.redirect("/admin/books");
});

router.get("/admin/books/:id/edit", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [categories] = await db.query("SELECT * FROM categories ORDER BY name");
  const [rows] = await db.query("SELECT * FROM books WHERE id=?", [id]);
  if (!rows.length) return res.redirect("/admin/books");
  res.render("admin/book_form", { mode: "edit", book: rows[0], categories, errors: [] });
});

router.post("/admin/books/:id/edit", requireAdmin, upload.single("image"), bookRules, async (req, res) => {
  const id = Number(req.params.id);
  const errors = validationResult(req);
  const [categories] = await db.query("SELECT * FROM categories ORDER BY name");

  if (!errors.isEmpty()) {
    return res.render("admin/book_form", {
      mode: "edit",
      book: { ...req.body, id },
      categories,
      errors: errors.array(),
    });
  }

  const { name, author, category_id, price, discount, stock, is_active } = req.body;

  if (req.file) {
    const image = "/uploads/" + req.file.filename;
    await db.query(
      "UPDATE books SET name=?,author=?,category_id=?,price=?,discount=?,stock=?,is_active=?,image=? WHERE id=?",
      [name, author, category_id, price, discount, stock, Number(is_active || 0), image, id]
    );
  } else {
    await db.query(
      "UPDATE books SET name=?,author=?,category_id=?,price=?,discount=?,stock=?,is_active=? WHERE id=?",
      [name, author, category_id, price, discount, stock, Number(is_active || 0), id]
    );
  }

  res.redirect("/admin/books");
});

router.post("/admin/books/:id/delete", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  // delete image file (optional)
  const [rows] = await db.query("SELECT image FROM books WHERE id=?", [id]);
  if (rows.length) {
    const img = rows[0].image;
    if (img && img.startsWith("/uploads/") && !img.endsWith("default.png")) {
      const p = path.join(__dirname, "..", "public", img);
      fs.unlink(p, () => {});
    }
  }

  await db.query("DELETE FROM books WHERE id=?", [id]);
  res.redirect("/admin/books");
});

router.get("/admin/orders", requireAdmin, async (req, res) => {
  const [orders] = await db.query(
    `SELECT o.*, u.fullname, u.email
     FROM orders o JOIN users u ON u.id=o.user_id
     ORDER BY o.created_at DESC`
  );
  res.render("admin/orders", { orders });
});

router.post("/admin/orders/:id/status", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  await db.query("UPDATE orders SET status=? WHERE id=?", [status, id]);
  res.redirect("/admin/orders");
});

module.exports = router;
