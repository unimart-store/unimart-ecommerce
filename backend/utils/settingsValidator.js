/**
 * Validation for Admin -> Settings writes. PURE (no DB / Express).
 *
 * Principles:
 *  - Output is BUILT field by field from known keys, so unknown/extra input
 *    (role, key, revision, updatedBy, __proto__ ...) can never reach MongoDB.
 *  - Only sections present in the request are validated and replaced; omitted
 *    sections are left as they are.
 *  - Errors are keyed by path ("delivery.areas.2.fee") so the admin form can
 *    show each message next to its field.
 *  - Free text may not contain angle brackets or control characters, and
 *    every URL must be https - settings are rendered on the public storefront.
 */
const crypto = require("crypto");
const { DAYS, AREA_TYPES } = require("./settingsDefaults");
const { validateNotifications } = require("./notificationSettings");

const LIMITS = Object.freeze({
  MAX_AREAS: 50,
  MAX_COURIERS: 20,
  MAX_MONEY: 1000000,
});

const ID_PATTERN = /^[a-z0-9]{8,32}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const newId = () => crypto.randomBytes(6).toString("hex");

const hasControlChars = (s) => /[\u0000-\u001F\u007F]/.test(s);
const cleanText = (s) => s.normalize("NFC").replace(/\s+/g, " ").trim();

// ---- primitive readers: each returns the clean value, recording an error on failure ----

const makeReader = (errors) => {
  const text = (path, raw, { max, required = false, label = "This field" } = {}) => {
    if (raw === undefined || raw === null || raw === "") {
      if (required) errors[path] = `${label} is required`;
      return "";
    }
    if (typeof raw !== "string") { errors[path] = `${label} must be text`; return ""; }
    if (hasControlChars(raw.replace(/[\t\r\n]/g, " "))) { errors[path] = `${label} contains unsupported characters`; return ""; }
    const value = cleanText(raw);
    if (/[<>]/.test(value)) { errors[path] = `${label} cannot contain < or >`; return ""; }
    if (required && !value) { errors[path] = `${label} is required`; return ""; }
    if (value.length > max) { errors[path] = `${label} must be at most ${max} characters`; return ""; }
    return value;
  };

  const bool = (path, raw, fallback) => {
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw !== "boolean") { errors[path] = "Must be true or false"; return fallback; }
    return raw;
  };

  // Money/threshold: null/""/undefined -> null (not set). Otherwise 0..MAX, 2 decimals.
  const money = (path, raw, label = "Amount") => {
    if (raw === undefined || raw === null || raw === "") return null;
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(n)) { errors[path] = `${label} must be a number`; return null; }
    if (n < 0) { errors[path] = `${label} cannot be negative`; return null; }
    if (n > LIMITS.MAX_MONEY) { errors[path] = `${label} is too large`; return null; }
    return Math.round((n + Number.EPSILON) * 100) / 100;
  };

  const url = (path, raw, label = "Link") => {
    const value = text(path, raw, { max: 500, label });
    if (!value || errors[path]) return "";
    let parsed;
    try { parsed = new URL(value); } catch (e) { errors[path] = `${label} must be a full link starting with https://`; return ""; }
    if (parsed.protocol !== "https:") { errors[path] = `${label} must start with https://`; return ""; }
    if (parsed.username || parsed.password) { errors[path] = `${label} cannot contain a username or password`; return ""; }
    if (!parsed.hostname.includes(".")) { errors[path] = `${label} is not a valid link`; return ""; }
    return value;
  };

  return { text, bool, money, url };
};

// "+977 9700013011" / "9700013011" / "009779700013011" -> "9779700013011" (digits only, as wa.me expects)
const normalizeWhatsAppNumber = (raw) => {
  if (typeof raw !== "string") return null;
  let digits = raw.trim().replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) return null;
  if (/^9[6-8]\d{8}$/.test(digits)) digits = "977" + digits; // bare Nepal mobile
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return digits;
};

// ---- sections ----

const validateBusiness = (raw, r, errors) => {
  const src = isPlainObject(raw) ? raw : {};
  const out = {
    name: r.text("business.name", src.name, { max: 100, required: true, label: "Business name" }),
    address: r.text("business.address", src.address, { max: 200, label: "Address" }),
    locationText: r.text("business.locationText", src.locationText, { max: 200, label: "Location" }),
    mapUrl: r.url("business.mapUrl", src.mapUrl, "Map link"),
    phone: "",
    whatsappNumber: "",
    email: "",
  };

  const phone = r.text("business.phone", src.phone, { max: 30, label: "Phone" });
  if (phone && !errors["business.phone"]) {
    if (!/^[0-9+()\-\s]+$/.test(phone) || (phone.match(/\d/g) || []).length < 7) {
      errors["business.phone"] = "Enter a valid phone number";
    } else out.phone = phone;
  }

  if (src.whatsappNumber !== undefined && src.whatsappNumber !== null && src.whatsappNumber !== "") {
    const wa = normalizeWhatsAppNumber(src.whatsappNumber);
    if (!wa) errors["business.whatsappNumber"] = "Enter a valid WhatsApp number with country code (e.g. +977 98XXXXXXXX)";
    else out.whatsappNumber = wa;
  }

  const email = r.text("business.email", src.email, { max: 120, label: "Email" });
  if (email && !errors["business.email"]) {
    if (!EMAIL_PATTERN.test(email)) errors["business.email"] = "Enter a valid email address";
    else out.email = email;
  }
  return out;
};

const validateSocial = (raw, r) => {
  const src = isPlainObject(raw) ? raw : {};
  return {
    facebook: r.url("social.facebook", src.facebook, "Facebook link"),
    instagram: r.url("social.instagram", src.instagram, "Instagram link"),
    tiktok: r.url("social.tiktok", src.tiktok, "TikTok link"),
  };
};

const validateHours = (raw, r, errors) => {
  const src = isPlainObject(raw) ? raw : {};
  const enabled = r.bool("hours.enabled", src.enabled, false);
  const inDays = Array.isArray(src.days) ? src.days : [];
  const byDay = new Map();

  if (inDays.length > 0 && inDays.length !== 7) errors["hours.days"] = "Provide all 7 days of the week";
  inDays.forEach((d, i) => {
    if (!isPlainObject(d) || !DAYS.includes(d.day)) { errors[`hours.days.${i}.day`] = "Invalid day"; return; }
    if (byDay.has(d.day)) { errors[`hours.days.${i}.day`] = "Duplicate day"; return; }
    byDay.set(d.day, { d, i });
  });

  const days = DAYS.map((day) => {
    const entry = byDay.get(day);
    if (!entry) return { day, closed: true, open: "", close: "" };
    const { d, i } = entry;
    const closed = r.bool(`hours.days.${i}.closed`, d.closed, true);
    if (closed) return { day, closed: true, open: "", close: "" };
    const open = typeof d.open === "string" ? d.open.trim() : "";
    const close = typeof d.close === "string" ? d.close.trim() : "";
    if (!TIME_PATTERN.test(open)) errors[`hours.days.${i}.open`] = "Enter opening time as HH:MM (24-hour)";
    if (!TIME_PATTERN.test(close)) errors[`hours.days.${i}.close`] = "Enter closing time as HH:MM (24-hour)";
    if (TIME_PATTERN.test(open) && TIME_PATTERN.test(close) && close <= open) {
      errors[`hours.days.${i}.close`] = "Closing time must be after opening time";
    }
    return { day, closed: false, open, close };
  });
  return { enabled, days };
};

const validateCouriers = (raw, r, errors) => {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) { errors.couriers = "Couriers must be a list"; return []; }
  if (raw.length > LIMITS.MAX_COURIERS) { errors.couriers = `At most ${LIMITS.MAX_COURIERS} couriers`; return []; }

  const seenIds = new Set();
  const seenNames = new Set();
  return raw.map((c, i) => {
    const p = `couriers.${i}`;
    const src = isPlainObject(c) ? c : {};
    let id = typeof src.id === "string" && ID_PATTERN.test(src.id) ? src.id : newId();
    if (seenIds.has(id)) { errors[`${p}.name`] = "Duplicate courier entry"; id = newId(); }
    seenIds.add(id);

    const name = r.text(`${p}.name`, src.name, { max: 60, required: true, label: "Courier name" });
    if (name) {
      const key = name.toLowerCase();
      if (seenNames.has(key)) errors[`${p}.name`] = "Courier names must be unique";
      seenNames.add(key);
    }
    return {
      id,
      name,
      enabled: r.bool(`${p}.enabled`, src.enabled, true),
      coverage: r.text(`${p}.coverage`, src.coverage, { max: 300, label: "Coverage" }),
      fee: r.money(`${p}.fee`, src.fee, "Fee"),
      feeNotes: r.text(`${p}.feeNotes`, src.feeNotes, { max: 300, label: "Pricing notes" }),
      codSupported: r.bool(`${p}.codSupported`, src.codSupported, false),
      notes: r.text(`${p}.notes`, src.notes, { max: 300, label: "Notes" }),
    };
  });
};

const validateDelivery = (raw, r, errors, couriers) => {
  const src = isPlainObject(raw) ? raw : {};
  const out = {
    enabled: r.bool("delivery.enabled", src.enabled, true),
    localEnabled: r.bool("delivery.localEnabled", src.localEnabled, true),
    localFee: r.money("delivery.localFee", src.localFee, "Local delivery fee"),
    freeDeliveryMinOrder: r.money("delivery.freeDeliveryMinOrder", src.freeDeliveryMinOrder, "Free-delivery minimum"),
    deliveryHours: r.text("delivery.deliveryHours", src.deliveryHours, { max: 100, label: "Delivery hours" }),
    notes: r.text("delivery.notes", src.notes, { max: 300, label: "Delivery notes" }),
    areas: [],
  };

  if (out.freeDeliveryMinOrder !== null && !(out.localFee > 0)) {
    errors["delivery.freeDeliveryMinOrder"] = "Only used when a local delivery fee is set - set the fee first, or leave this empty";
  }

  const inAreas = src.areas === undefined ? [] : src.areas;
  if (!Array.isArray(inAreas)) { errors["delivery.areas"] = "Areas must be a list"; return out; }
  if (inAreas.length > LIMITS.MAX_AREAS) { errors["delivery.areas"] = `At most ${LIMITS.MAX_AREAS} areas`; return out; }

  const seenIds = new Set();
  const seenNames = new Set();
  out.areas = inAreas.map((a, i) => {
    const p = `delivery.areas.${i}`;
    const s = isPlainObject(a) ? a : {};
    let id = typeof s.id === "string" && ID_PATTERN.test(s.id) ? s.id : newId();
    if (seenIds.has(id)) { errors[`${p}.name`] = "Duplicate area entry"; id = newId(); }
    seenIds.add(id);

    const name = r.text(`${p}.name`, s.name, { max: 80, required: true, label: "Area name" });
    if (name) {
      const key = name.toLowerCase();
      if (seenNames.has(key)) errors[`${p}.name`] = "Area names must be unique";
      seenNames.add(key);
    }

    const type = s.type;
    if (!AREA_TYPES.includes(type)) errors[`${p}.type`] = "Choose local, paid or unsupported";

    const enabled = r.bool(`${p}.enabled`, s.enabled, true);
    const isUnsupported = type === "unsupported";
    const isPaid = type === "paid";

    const fee = isPaid ? r.money(`${p}.fee`, s.fee, "Fee") : null;
    const minOrder = isUnsupported ? null : r.money(`${p}.minOrder`, s.minOrder, "Minimum order");
    const message = isUnsupported ? r.text(`${p}.message`, s.message, { max: 200, label: "Message" }) : "";

    let courierId = null;
    if (isPaid && s.courierId !== undefined && s.courierId !== null && s.courierId !== "") {
      if (typeof s.courierId !== "string" || !couriers.some((c) => c.id === s.courierId)) {
        errors[`${p}.courierId`] = "Choose a courier from your Courier Services list";
      } else courierId = s.courierId;
    }

    // An ENABLED paid area must always resolve to a fee - otherwise customers
    // would hit "unavailable" (or worse, free delivery) by configuration accident.
    if (isPaid && enabled && !errors[`${p}.fee`] && !errors[`${p}.courierId`]) {
      const courier = courierId ? couriers.find((c) => c.id === courierId) : null;
      if (fee === null && !(courier && courier.fee !== null && courier.fee !== undefined)) {
        errors[`${p}.fee`] = "Enter a fee, or choose a courier that has a fee";
      }
    }

    return { id, name, type: AREA_TYPES.includes(type) ? type : "unsupported", enabled, fee, minOrder, courierId, message };
  });
  return out;
};

const validatePayment = (raw, r, errors) => {
  const src = isPlainObject(raw) ? raw : {};
  const out = {
    whatsappEnabled: r.bool("payment.whatsappEnabled", src.whatsappEnabled, true),
    codEnabled: r.bool("payment.codEnabled", src.codEnabled, false),
  };
  if (!out.whatsappEnabled && !out.codEnabled) {
    errors["payment.whatsappEnabled"] = "Enable at least one payment method, or customers cannot check out";
  }
  return out;
};

/**
 * @param body      request body (untrusted)
 * @param existing  currently stored settings (used to resolve courier references
 *                  when only `delivery` is being updated)
 * @returns {{value: object, errors?: undefined} | {errors: object}}
 *          value = { sections: {...validated sections}, revision?: number }
 */
const validateSettingsUpdate = (body, existing = {}) => {
  if (!isPlainObject(body)) return { errors: { _: "Invalid request" } };

  const errors = {};
  const r = makeReader(errors);
  const sections = {};

  const has = (k) => body[k] !== undefined;
  if (!["business", "social", "hours", "delivery", "payment", "couriers", "notifications"].some(has)) {
    return { errors: { _: "Nothing to update" } };
  }

  // Couriers first: delivery areas reference them.
  const couriers = has("couriers") ? validateCouriers(body.couriers, r, errors) : existing.couriers || [];
  if (has("couriers")) sections.couriers = couriers;
  if (has("business")) sections.business = validateBusiness(body.business, r, errors);
  if (has("social")) sections.social = validateSocial(body.social, r);
  if (has("hours")) sections.hours = validateHours(body.hours, r, errors);
  if (has("delivery")) sections.delivery = validateDelivery(body.delivery, r, errors, couriers);
  if (has("payment")) sections.payment = validatePayment(body.payment, r, errors);
  if (has("notifications")) sections.notifications = validateNotifications(body.notifications, r, errors, { normalizeWhatsAppNumber });

  // Changing couriers alone must not silently break areas that already use them.
  if (has("couriers") && !has("delivery") && existing.delivery && Array.isArray(existing.delivery.areas)) {
    existing.delivery.areas.forEach((area, i) => {
      if (area.type === "paid" && area.enabled) {
        const courier = area.courierId ? couriers.find((c) => c.id === area.courierId) : null;
        if (area.courierId && !courier) errors.couriers = `Courier used by area "${area.name}" cannot be removed - change that area first`;
        else if ((area.fee === null || area.fee === undefined) && !(courier && courier.fee !== null && courier.fee !== undefined)) {
          errors.couriers = `Area "${area.name}" relies on this courier's fee - keep a fee, or give the area its own fee first`;
        }
      }
    });
  }

  let revision;
  if (body.revision !== undefined && body.revision !== null) {
    if (!Number.isInteger(body.revision) || body.revision < 0) errors.revision = "Invalid revision";
    else revision = body.revision;
  }

  return Object.keys(errors).length ? { errors } : { value: { sections, revision } };
};

module.exports = { validateSettingsUpdate, normalizeWhatsAppNumber, LIMITS };
