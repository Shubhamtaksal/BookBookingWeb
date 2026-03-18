const express = require("express");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { Parser } = require("json2csv");

const router = express.Router();

router.get("/admin/reports", requireAdmin, async (req, res) => {
  const [orders] = await db.query(
    `SELECT o.id, o.total, o.status, o.created_at, u.fullname, u.email
     FROM orders o JOIN users u ON u.id=o.user_id
     ORDER BY o.created_at DESC`
  );
  res.render("admin/reports", { orders });
});

router.get("/admin/reports/orders.csv", requireAdmin, async (req, res) => {
  const [rows] = await db.query(
    `SELECT o.id, u.fullname, u.email, o.total, o.status, o.created_at
     FROM orders o JOIN users u ON u.id=o.user_id
     ORDER BY o.created_at DESC`
  );

  const parser = new Parser({
    fields: ["id", "fullname", "email", "total", "status", "created_at"],
  });
  const csv = parser.parse(rows);

  res.header("Content-Type", "text/csv");
  res.attachment("orders_report.csv");
  res.send(csv);
});

module.exports = router;
