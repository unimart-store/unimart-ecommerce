/**
 * CORS origin policy - pure functions so the rules are unit-tested.
 *
 * Rules:
 *  - Browser origins must EXACTLY match an entry in ALLOWED_ORIGINS.
 *  - Localhost/127.0.0.1 (exact host, optional port) is allowed only when
 *    NODE_ENV is not "production".
 *  - Never substring matching: "https://localhost.evil.com" must not pass.
 *  - Requests without an Origin header (curl, server-to-server, same-origin
 *    navigation) are not CORS requests and are allowed through; browsers
 *    always send Origin on cross-site requests.
 */
const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

// "https://a.com/, https://b.com" -> ["https://a.com", "https://b.com"]
const parseAllowedOrigins = (raw) =>
  (raw || "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);

const isAllowedOrigin = (origin, { allowedOrigins = [], isProduction = false } = {}) => {
  if (!origin) return true;
  if (typeof origin !== "string") return false;
  if (allowedOrigins.includes(origin)) return true;
  if (!isProduction && LOCAL_DEV_ORIGIN.test(origin)) return true;
  return false;
};

module.exports = { parseAllowedOrigins, isAllowedOrigin, LOCAL_DEV_ORIGIN };
