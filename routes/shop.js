const express = require("express");
const db = require("../db");
const { requireLogin } = require("../middleware/auth");
const { checkoutRules } = require("../middleware/validators");
const { validationResult } = require("express-validator");

const router = express.Router();

function getCart(req) {
  if (!req.session.cart) req.session.cart = [];
  return req.session.cart;
}

router.get("/", async (req, res) => {
  const [categories] = await db.query("SELECT * FROM categories ORDER BY name");
  const [books] = await db.query(
    `SELECT b.*, c.name AS category_name
     FROM books b JOIN categories c ON c.id=b.category_id
     WHERE b.is_active=1
     ORDER BY b.created_at DESC LIMIT 6`
  );
  res.render("index", { categories, books });
});

router.get("/books", async (req, res) => {
  const q = (req.query.q || "").trim();
  const category = req.query.category || "";

  const [categories] = await db.query("SELECT * FROM categories ORDER BY name");

  let sql = `
    SELECT b.*, c.name AS category_name
    FROM books b JOIN categories c ON c.id=b.category_id
    WHERE b.is_active=1
      AND (b.name LIKE ? OR b.author LIKE ?)
  `;
  const vals = [`%${q}%`, `%${q}%`];

  if (category) {
    sql += " AND c.id = ? ";
    vals.push(category);
  }

  sql += " ORDER BY b.created_at DESC";

  const [books] = await db.query(sql, vals);
  res.render("books", { categories, books, q, category });
});

router.post("/cart/add/:id", async (req, res) => {
  const bookId = Number(req.params.id);
  const [rows] = await db.query("SELECT * FROM books WHERE id=? AND is_active=1", [bookId]);
  if (!rows.length) return res.redirect("/books");

  const cart = getCart(req);
  const item = cart.find((x) => x.bookId === bookId);
  if (item) item.qty += 1;
  else cart.push({ bookId, qty: 1 });

  res.redirect("/cart");
});

router.post("/cart/update", (req, res) => {
  const cart = getCart(req);
  const { bookId, qty } = req.body;
  const id = Number(bookId);
  const q = Math.max(1, Number(qty || 1));
  const item = cart.find((x) => x.bookId === id);
  if (item) item.qty = q;
  res.redirect("/cart");
});

router.post("/cart/remove/:id", (req, res) => {
  const id = Number(req.params.id);
  req.session.cart = getCart(req).filter((x) => x.bookId !== id);
  res.redirect("/cart");
});

router.get("/cart", async (req, res) => {
  const cart = getCart(req);
  if (!cart.length) return res.render("cart", { items: [], total: 0 });

  const ids = cart.map((x) => x.bookId);
  const [books] = await db.query(
    `SELECT b.*, c.name AS category_name
     FROM books b JOIN categories c ON c.id=b.category_id
     WHERE b.id IN (${ids.map(() => "?").join(",")})`,
    ids
  );

  const items = cart.map((c) => {
    const b = books.find((x) => x.id === c.bookId);
    const price = Number(b.price);
    const discount = Number(b.discount);
    const final = price - (price * discount) / 100;
    return {
      ...b,
      qty: c.qty,
      finalPrice: final,
      lineTotal: final * c.qty,
    };
  });

  const total = items.reduce((s, it) => s + it.lineTotal, 0);
  res.render("cart", { items, total });
});

router.get("/checkout", requireLogin, async (req, res) => {
  const cart = getCart(req);
  if (!cart.length) return res.redirect("/cart");
  res.render("checkout", { errors: [], old: {} });
});

router.post("/checkout", requireLogin, checkoutRules, async (req, res) => {
  const errors = validationResult(req);
  const old = req.body;
  if (!errors.isEmpty()) return res.render("checkout", { errors: errors.array(), old });

  const cart = getCart(req);
  if (!cart.length) return res.redirect("/cart");

  const ids = cart.map((x) => x.bookId);
  const [books] = await db.query(`SELECT * FROM books WHERE id IN (${ids.map(() => "?").join(",")})`, ids);

  // stock check
  for (const c of cart) {
    const b = books.find((x) => x.id === c.bookId);
    if (!b || b.stock < c.qty) {
      return res.render("checkout", { errors: [{ msg: "Stock not available for some items" }], old });
    }
  }

  // total
  const items = cart.map((c) => {
    const b = books.find((x) => x.id === c.bookId);
    const final = Number(b.price) - (Number(b.price) * Number(b.discount)) / 100;
    return { book: b, qty: c.qty, final };
  });

  const total = items.reduce((s, it) => s + it.final * it.qty, 0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { address_line1, city, pincode } = req.body;
    const [orderRes] = await conn.query(
      "INSERT INTO orders(user_id,total,status,address_line1,city,pincode) VALUES (?,?, 'PLACED',?,?,?)",
      [req.session.user.id, total.toFixed(2), address_line1, city, pincode]
    );
    const orderId = orderRes.insertId;

    for (const it of items) {
      await conn.query(
        "INSERT INTO order_items(order_id,book_id,qty,price_each,discount_each) VALUES (?,?,?,?,?)",
        [orderId, it.book.id, it.qty, it.book.price, it.book.discount]
      );
      await conn.query("UPDATE books SET stock = stock - ? WHERE id=?", [it.qty, it.book.id]);
    }

    await conn.commit();
    req.session.cart = [];
    res.redirect("/orders");
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).send("DB error");
  } finally {
    conn.release();
  }
});

router.get("/orders", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const [orders] = await db.query("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC", [userId]);

  // attach items
  for (const o of orders) {
    const [items] = await db.query(
      `SELECT oi.*, b.name, b.author, b.image
       FROM order_items oi JOIN books b ON b.id=oi.book_id
       WHERE oi.order_id=?`,
      [o.id]
    );
    o.items = items;
  }

  res.render("orders", { orders });
});

module.exports = router;
