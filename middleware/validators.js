const { body } = require("express-validator");

const registerRules = [
  body("fullname").trim().isLength({ min: 3 }).withMessage("Name too short"),
  body("email").isEmail().withMessage("Invalid email"),
  body("password").isLength({ min: 6 }).withMessage("Password min 6 chars"),
];

const loginRules = [
  body("email").isEmail().withMessage("Invalid email"),
  body("password").notEmpty().withMessage("Password required"),
];

const bookRules = [
  body("name").trim().isLength({ min: 2 }).withMessage("Book name required"),
  body("author").trim().isLength({ min: 2 }).withMessage("Author required"),
  body("category_id").isInt().withMessage("Category required"),
  body("price").isFloat({ min: 0 }).withMessage("Price invalid"),
  body("discount").isInt({ min: 0, max: 90 }).withMessage("Discount 0-90"),
  body("stock").isInt({ min: 0 }).withMessage("Stock invalid"),
];

const checkoutRules = [
  body("address_line1").trim().isLength({ min: 5 }).withMessage("Address required"),
  body("city").trim().isLength({ min: 2 }).withMessage("City required"),
  body("pincode").trim().isLength({ min: 6, max: 10 }).withMessage("Pincode invalid"),
];

module.exports = { registerRules, loginRules, bookRules, checkoutRules };
