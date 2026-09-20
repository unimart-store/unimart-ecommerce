/**
 * Server-side checkout validation. The backend is the security boundary:
 * nothing here trusts the browser, and the frontend's own checks are only a
 * convenience for the customer.
 *
 * IMPORTANT - what this does NOT do:
 *  - Phone: FORMAT validation only. A well-formed Nepal mobile number is not
 *    proof that the customer owns it (that would need OTP/WhatsApp
 *    verification - not part of Phase 1).
 *  - Address: plain-text sanity checks only. Software cannot prove an address
 *    exists; the uncle still verifies orders manually. Structured Nepal
 *    address fields arrive with Phase 2.
 *
 * Pure functions (no DB, no Express) so they are unit-testable.
 */
const crypto = require("crypto");
const defaultConfig = require("../config/business");

const LIMITS = Object.freeze({
  NAME_MIN: 2,
  NAME_MAX: 80,
  ADDRESS_MIN: 10,
  ADDRESS_MAX: 300,
  MAX_ORDER_LINES: 50,
  MAX_QTY_PER_LINE: 99, // same cap the server-side cart already uses
});

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

// Placeholder/junk values we refuse outright. Kept short on purpose - the
// goal is to stop lazy test input, not to police real names.
const NAME_PLACEHOLDERS = new Set([
  "test", "testing", "tester", "abc", "abcd", "abcde", "asdf", "asdfg",
  "qwerty", "xxx", "xxxx", "name", "none", "null", "undefined", "unknown",
  "fake", "random", "demo", "sample",
]);
const ADDRESS_PLACEHOLDERS = new Set([
  "test", "test address", "testing", "abc", "abcd", "asdf", "asdfg", "qwerty",
  "xxx", "xxxx", "xyz", "none", "null", "undefined", "unknown", "fake",
  "random", "random address", "address", "my address", "demo", "sample",
  "na", "n/a", "nil",
]);

const cleanText = (value) =>
  value.normalize("NFC").replace(/\s+/g, " ").trim();

const countLetters = (value) => (value.match(/\p{L}/gu) || []).length;

const hasControlChars = (value) => /[\u0000-\u001F\u007F]/.test(value);

// ---- Name -----------------------------------------------------------------

const validateCustomerName = (raw) => {
  if (typeof raw !== "string") return { error: "Please enter your full name" };
  const value = cleanText(raw);

  if (value.length < LIMITS.NAME_MIN) return { error: "Name is too short" };
  if (value.length > LIMITS.NAME_MAX) return { error: `Name must be at most ${LIMITS.NAME_MAX} characters` };

  // Unicode letters + combining marks (Devanagari vowel signs etc.), spaces,
  // dot, apostrophe, hyphen. No digits, no symbols, no angle brackets.
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(value)) {
    return { error: "Name can contain only letters, spaces, . ' and -" };
  }
  if (countLetters(value) < LIMITS.NAME_MIN) return { error: "Name is too short" };

  const tokens = value.toLowerCase().split(/[ .'’-]+/).filter(Boolean);
  const compact = tokens.join("");
  if (
    tokens.every((t) => NAME_PLACEHOLDERS.has(t)) ||
    NAME_PLACEHOLDERS.has(compact) ||
    /^(\p{L})\1{2,}$/u.test(compact) // "aaa", "xxxxx"
  ) {
    return { error: "Please enter your real name" };
  }
  return { value };
};

// ---- Phone (Nepal mobile, FORMAT ONLY) ------------------------------------

// Nepal mobile numbers are 10 digits starting with 9, where the 2nd digit
// identifies the technology/operator family (6 = Smart, 7 = NTC/UTL/Ncell
// ranges, 8 = NTC/Ncell/Smart GSM ranges). We validate that STRUCTURE
// instead of a hand-maintained list of exact 3-digit prefixes, because
// operators get new ranges (e.g. Ncell's 971 in 2025) and an over-strict
// list would reject real customers. Tighten here if the business wants to.
// Source cross-checks: NTA-published numbering summaries as reported by
// nepalitelecom.com / Himalayan Times (secondary sources - re-verify with
// the NTA numbering plan before making this stricter).
const NEPAL_MOBILE_NATIONAL = /^9[6-8]\d{8}$/;

const normalizeNepalMobile = (raw, config = defaultConfig) => {
  if (typeof raw !== "string") return { error: "Please enter a valid Nepal mobile number" };

  let digits = raw.trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits)) {
    return { error: "Mobile number can contain only digits (and a leading +977)" };
  }

  const cc = config.phoneCountryCode.replace("+", ""); // "977"
  if (digits.startsWith("+")) {
    if (!digits.startsWith("+" + cc)) return { error: `Only Nepal (${config.phoneCountryCode}) numbers are supported` };
    digits = digits.slice(1 + cc.length);
  } else if (digits.startsWith("00" + cc)) {
    digits = digits.slice(2 + cc.length);
  } else if (digits.startsWith(cc) && digits.length === cc.length + 10) {
    digits = digits.slice(cc.length);
  }

  if (!NEPAL_MOBILE_NATIONAL.test(digits)) {
    return { error: "Enter a valid Nepal mobile number (10 digits, e.g. 98XXXXXXXX)" };
  }
  // Reject obviously fake subscriber parts such as 9800000000 / 9811111111.
  if (/^(\d)\1{6}$/.test(digits.slice(3))) {
    return { error: "Enter a valid Nepal mobile number (10 digits, e.g. 98XXXXXXXX)" };
  }
  return { value: config.phoneCountryCode + digits }; // E.164, e.g. +9779812345678
};

// ---- Address (free text in Phase 1) ---------------------------------------

const validateAddress = (raw) => {
  if (typeof raw !== "string") return { error: "Please enter your delivery address" };
  if (hasControlChars(raw.replace(/[\t\r\n]/g, " "))) return { error: "Address contains unsupported characters" };
  const value = cleanText(raw);

  if (value.length < LIMITS.ADDRESS_MIN) return { error: "Please enter a more complete delivery address" };
  if (value.length > LIMITS.ADDRESS_MAX) return { error: `Address must be at most ${LIMITS.ADDRESS_MAX} characters` };
  if (/[<>]/.test(value)) return { error: "Address contains unsupported characters" };

  if (countLetters(value) < 5) return { error: "Please enter a more complete delivery address" };
  if (/(.)\1{5,}/u.test(value)) return { error: "Please enter a real delivery address" };
  if (ADDRESS_PLACEHOLDERS.has(value.toLowerCase())) return { error: "Please enter a real delivery address" };

  // At least two "words" (area + landmark/ward/etc.).
  const tokens = value.split(/[\s,;/-]+/).filter(Boolean);
  if (tokens.length < 2) return { error: "Please enter a more complete delivery address" };

  return { value };
};

// ---- Country / payment / idempotency key ------------------------------------

const validateCountry = (raw, config = defaultConfig) => {
  if (raw === undefined || raw === null || raw === "") return { value: config.country };
  if (typeof raw !== "string") return { error: `Delivery is currently available in ${config.country} only` };
  if (config.countryAliases.includes(raw.trim().toLowerCase())) return { value: config.country };
  return { error: `Delivery is currently available in ${config.country} only` };
};

const validatePaymentMethod = (raw, config = defaultConfig) => {
  if (raw === undefined || raw === null || raw === "") return { value: config.defaultPaymentMethod };
  if (typeof raw !== "string") return { error: "Invalid payment method" };
  const match = config.paymentMethods.find((m) => m.toLowerCase() === raw.trim().toLowerCase());
  return match ? { value: match } : { error: "Invalid payment method" };
};

const validateIdempotencyKey = (raw, { required = false } = {}) => {
  if (raw === undefined || raw === null || raw === "") {
    return required ? { error: "Missing checkout key. Please refresh the page and try again." } : { value: undefined };
  }
  if (typeof raw !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(raw)) {
    return { error: "Invalid checkout key. Please refresh the page and try again." };
  }
  return { value: raw };
};

// ---- Delivery area / quoted total (Phase 2) -------------------------------------

// The area is chosen from the list the server published (settings). Only the
// ID's FORMAT is checked here; whether it exists, is deliverable and what it
// costs is decided from settings inside the order transaction.
const AREA_ID_PATTERN = /^[a-z0-9]{8,32}$/;

const validateDeliveryAreaId = (raw) => {
  if (raw === undefined || raw === null || raw === "") return { value: undefined };
  if (typeof raw !== "string" || !AREA_ID_PATTERN.test(raw)) return { error: "Please choose a valid delivery area" };
  return { value: raw };
};

// The total the customer was SHOWN. It is never used as the order total - it
// only lets the server refuse (409) when the real total has since changed, so
// nobody is charged something different from what they agreed to.
const validateQuotedTotal = (raw) => {
  if (raw === undefined || raw === null || raw === "") return { value: undefined };
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100000000) return { error: "Invalid order total" };
  return { value: Math.round((n + Number.EPSILON) * 100) / 100 };
};

// ---- Guest items -------------------------------------------------------------

// Guests have no server-side cart, so they submit {productId, quantity}
// lines. Only SHAPE is checked here; existence, active status, price and
// stock are always re-checked against MongoDB inside the order transaction.
const validateGuestItems = (rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return { error: "Cart is empty" };
  if (rawItems.length > LIMITS.MAX_ORDER_LINES) return { error: `An order can contain at most ${LIMITS.MAX_ORDER_LINES} different products` };

  const merged = new Map();
  for (const item of rawItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: "Each item must reference a valid product" };
    }
    if (typeof item.productId !== "string" || !OBJECT_ID_PATTERN.test(item.productId)) {
      return { error: "Each item must reference a valid product" };
    }
    const quantity = item.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      return { error: "Each item must have a positive whole number quantity" };
    }
    const id = item.productId.toLowerCase();
    merged.set(id, (merged.get(id) || 0) + quantity);
  }

  const items = [];
  for (const [productId, quantity] of merged) {
    if (quantity > LIMITS.MAX_QTY_PER_LINE) {
      return { error: `You can order at most ${LIMITS.MAX_QTY_PER_LINE} units of one product` };
    }
    items.push({ productId, quantity });
  }
  items.sort((a, b) => (a.productId < b.productId ? -1 : 1)); // stable order for hashing
  return { items };
};

// ---- Whole checkout body ---------------------------------------------------------

const validateCheckoutBody = (body, { isGuest, config = defaultConfig, requireIdempotencyKey = false } = {}) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: { _: "Invalid request" } };
  }

  const errors = {};
  const value = {};

  const name = validateCustomerName(body.customerName);
  if (name.error) errors.customerName = name.error; else value.customerName = name.value;

  const phone = normalizeNepalMobile(body.customerPhone, config);
  if (phone.error) errors.customerPhone = phone.error; else value.customerPhone = phone.value;

  const address = validateAddress(body.customerAddress);
  if (address.error) errors.customerAddress = address.error; else value.customerAddress = address.value;

  const country = validateCountry(body.country, config);
  if (country.error) errors.country = country.error; else value.country = country.value;

  const payment = validatePaymentMethod(body.paymentMethod, config);
  if (payment.error) errors.paymentMethod = payment.error; else value.paymentMethod = payment.value;

  const key = validateIdempotencyKey(body.idempotencyKey, { required: requireIdempotencyKey });
  if (key.error) errors.idempotencyKey = key.error; else value.idempotencyKey = key.value;

  // Optional extras: only added to the result when the client sent them.
  const area = validateDeliveryAreaId(body.deliveryAreaId);
  if (area.error) errors.deliveryAreaId = area.error;
  else if (area.value !== undefined) value.deliveryAreaId = area.value;

  const quoted = validateQuotedTotal(body.quotedTotal);
  if (quoted.error) errors.quotedTotal = quoted.error;
  else if (quoted.value !== undefined) value.quotedTotal = quoted.value;

  if (isGuest) {
    const items = validateGuestItems(body.items);
    if (items.error) errors.items = items.error; else value.items = items.items;
  }

  return Object.keys(errors).length ? { errors } : { value };
};

// Fingerprint of what the customer intended to order. Stored with the order
// so a replayed idempotency key can be checked: same key + same intent =
// same order returned; same key + different intent = rejected (409).
// Logged-in orders exclude items (they come from the server-side cart, which
// is cleared by the first successful attempt).
const buildRequestFingerprint = (value) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        n: value.customerName,
        p: value.customerPhone,
        a: value.customerAddress,
        c: value.country,
        m: value.paymentMethod,
        d: value.deliveryAreaId || null,
        i: value.items || null,
      })
    )
    .digest("hex");

const firstErrorMessage = (errors) => Object.values(errors)[0];

module.exports = {
  LIMITS,
  cleanText,
  validateCustomerName,
  normalizeNepalMobile,
  validateAddress,
  validateCountry,
  validatePaymentMethod,
  validateIdempotencyKey,
  validateGuestItems,
  validateDeliveryAreaId,
  validateQuotedTotal,
  validateCheckoutBody,
  buildRequestFingerprint,
  firstErrorMessage,
};
