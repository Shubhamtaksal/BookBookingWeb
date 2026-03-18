// middleware/auth.js
exports.requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect("/login");
  next();
};

exports.requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect("/login");

  // ✅ uppercase check
  if (req.session.user.role !== "ADMIN") {
    return res.status(403).send("Forbidden");
  }
  next();
};
