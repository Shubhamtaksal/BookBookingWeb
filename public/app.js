const express = require("express");
const path = require("path");
const session = require("express-session");

const app = express();
const PORT = 3000;

// -------------------- SETTINGS --------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// -------------------- MIDDLEWARE --------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "bookhub_admin_secret",
    resave: false,
    saveUninitialized: false,
  })
);

// -------------------- ADMIN MIDDLEWARE --------------------
function isAdmin(req, res, next) {
  if (req.session.admin) {
    return next();
  }
  return res.redirect("/admin/login");
}

// -------------------- ROUTES --------------------

// Home page
app.get("/", (req, res) => {
  res.render("index");
});

// Normal user login page
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

// Normal user register page
app.get("/register", (req, res) => {
  res.render("register");
});

// Cart page dummy
app.get("/cart", (req, res) => {
  res.send("<h1>Cart Page</h1><a href='/'>Back Home</a>");
});

// Books page dummy
app.get("/books", (req, res) => {
  res.send("<h1>Books Page</h1><a href='/'>Back Home</a>");
});

// -------------------- ADMIN ROUTES --------------------

// direct /admin -> login page
app.get("/admin", (req, res) => {
  res.redirect("/admin/login");
});

// admin login page
app.get("/admin/login", (req, res) => {
  res.render("admin/login", { error: null });
});

// admin login check
app.post("/admin/login", (req, res) => {
  const { email, password } = req.body;

  if (email === "admin@gmail.com" && password === "admin123") {
    req.session.admin = true;
    req.session.adminEmail = email;
    return res.redirect("/admin/dashboard");
  }

  return res.render("admin/login", {
    error: "Invalid admin email or password",
  });
});

// admin dashboard
app.get("/admin/dashboard", isAdmin, (req, res) => {
  res.render("admin/dashboard", {
    adminEmail: req.session.adminEmail,
  });
});

// admin logout
app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
});

// -------------------- 404 --------------------
app.use((req, res) => {
  res.status(404).send("Page not found");
});

// -------------------- SERVER --------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});