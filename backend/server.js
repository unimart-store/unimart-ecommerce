//const dns = require("dns");

// TEMPORARY TEST
require("dotenv").config();

if (process.env.NODE_ENV !== "production") {
  const dns = require("dns");
  dns.setServers(["8.8.8.8"]);
}
// const dns = require("dns");

// TEMPORARY TEST
// dns.setServers(["8.8.8.8"]);
// console.log("DNS Servers:", dns.getServers());

// require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const { parseAllowedOrigins, isAllowedOrigin } = require("./utils/cors");

const app = express();

app.set('trust proxy', 1);

// 1. SETUP FIRST
app.use(helmet());

// 2. PARSE JSON FIRST (Crucial: Data must exist before it can be sanitized)
// 1mb is far above any legitimate JSON body here (product/order/cart data).
// Image uploads use multipart via multer with its own 5MB limit, not this parser.
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser()); // makes req.cookies available, needed to read the httpOnly auth cookie
// Add this block directly above app.use(mongoSanitize())
app.use((req, res, next) => {
    Object.defineProperty(req, 'query', {
        value: req.query,
        writable: true,
        configurable: true,
        enumerable: true,
    });
    next();
});



// 3. SANITIZE SECOND
app.use(mongoSanitize());

// 4. CORS (moved before the rate limiter - a rate-limited response must
// still carry CORS headers, otherwise the browser reports it as a CORS
// failure instead of the real 429, masking the actual cause)
// Exact-match origin policy (see utils/cors.js): configured origins must match
// exactly, and localhost is only accepted outside production. Never substring
// matching - credentials are enabled, so "https://localhost.evil.com" must
// not be treated as a trusted origin.
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && allowedOrigins.length === 0) {
    console.warn("⚠️  ALLOWED_ORIGINS is empty - every browser origin will be rejected by CORS.");
}

app.use(cors({
    origin: function (origin, callback) {
        // No Origin header = not a browser CORS request (curl, server-to-server).
        // Denied origins get `false` (no CORS headers), never an Error.
        callback(null, isAllowedOrigin(origin, { allowedOrigins, isProduction }));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true
}));

// 5. RATE LIMITER
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { message: "Too many requests, please slow down." }
});
app.use("/api/", limiter);

// 🔗 MONGODB CONNECTION
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ MongoDB Connected Successfully");
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err.message);
        process.exit(1);
    }
};
connectDB();

// 🚀 ROUTES
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/uploads", require("./routes/uploadRoutes"));
app.use("/api/cart", require("./routes/cartRoutes"));
app.use("/api/checkout", require("./routes/checkoutRoutes"));
app.use("/api/settings", require("./routes/settingsRoutes"));
app.use("/api/delivery", require("./routes/deliveryRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.get("/api/health", (req, res) => res.status(200).json({ status: "ok" }));

// 4. GLOBAL ERROR HANDLER (Don't let errors leak internal details!)
app.use((err, req, res, next) => {
    // Malformed / oversized request bodies are the CLIENT's fault: answer with
    // a proper 4xx instead of logging a stack trace and returning a 500.
    if (err && err.type === "entity.parse.failed") {
        return res.status(400).json({ success: false, message: "Invalid JSON in request body" });
    }
    if (err && err.type === "entity.too.large") {
        return res.status(413).json({ success: false, message: "Request body is too large" });
    }

    console.error("============== ERROR ==============");
    console.error(err);
    console.error("===================================");

    res.status(err.status || 500).json({
        success: false,
        message:
            process.env.NODE_ENV === "production"
                ? "Internal Server Error"
                : err.message
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
