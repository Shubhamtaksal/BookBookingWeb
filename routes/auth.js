// routes/auth.js
const express = require("express");
const db = require("../db");
const bcrypt = require("bcrypt");

const router = express.Router();

router.get("/login", (req, res) => res.render("auth/login", { error: null }));

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await db.query("SELECT * FROM users WHERE email=?", [email]);
    if (!rows.length) return res.render("auth/login", { error: "Invalid email/password" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.render("auth/login", { error: "Invalid email/password" });

    // ✅ MUST: session मध्ये role save
    req.session.user = {
      id: user.id,
      fullname: user.fullname,
      email: user.email,
      role: user.role,
    };

    // admin असेल तर थेट /admin
    if (user.role === "admin") return res.redirect("/admin");
    return res.redirect("/");
  } catch (e) {
    console.error(e);
    res.render("auth/login", { error: "Something went wrong" });
  }
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

module.exports = router;
