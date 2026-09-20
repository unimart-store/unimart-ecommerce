const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const { quote } = require("../controllers/deliveryController");
const optionalAuth = require("../middleware/optionalAuth");

// A quote is requested each time the customer changes their area or cart on
// the checkout page, so this is looser than the checkout limiter but still
// bounded (each call reads the database).
const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 90,
  message: { success: false, message: "Too many requests, please slow down." },
});

router.post("/quote", quoteLimiter, optionalAuth, quote);

module.exports = router;
