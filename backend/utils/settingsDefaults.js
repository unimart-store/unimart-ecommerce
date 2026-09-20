/**
 * UNiMART - Business Settings: shape, defaults and catalogs.
 *
 * Settings live in MongoDB (one document, key "business") and are edited from
 * Admin -> Settings. NOTHING here is a secret: environment secrets (JWT, DB
 * URI, Cloudinary, future WhatsApp tokens) stay in environment variables and
 * must never be added to this document.
 *
 * Seed values are ONLY facts that were already live on the site or confirmed
 * by the owner (name, address, phone, WhatsApp, email, map link, social links).
 * Everything the owner has not confirmed is empty / null / disabled:
 * business hours, delivery fees and areas, free-delivery minimum, couriers.
 */
const DAYS = Object.freeze(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

// Payment methods the platform actually IMPLEMENTS. Settings can switch these
// on/off; they cannot invent new ones (a method with no code behind it would
// let customers pick something nothing can process). New methods = new code.
const PAYMENT_METHODS = Object.freeze({
  whatsapp: "WhatsApp",
  cod: "Cash on Delivery",
});

const AREA_TYPES = Object.freeze(["local", "paid", "unsupported"]);

const buildDefaultSettings = () => ({
  business: {
    name: "UniMart",
    address: "Aawaroad, opposite of Lumbini Bikas Bank, Siddharthanagar, Nepal",
    locationText: "Siddharthanagar (Bhairahawa), Rupandehi, Nepal",
    mapUrl: "https://maps.app.goo.gl/A4eyLsyo5tmei9HPA", // already live in the storefront footer - owner to confirm it is the shop pin
    phone: "+977 9700013011",
    whatsappNumber: "9779700013011",
    email: "unimart.team@gmail.com",
  },
  social: {
    facebook: "https://www.facebook.com/share/1DSb6HU8iD/",
    instagram: "https://www.instagram.com/unimart2025?igsh=MWdmcjViZ21uZTh0aA==",
    tiktok: "https://www.tiktok.com/@unimart_25",
  },
  hours: {
    enabled: false, // hours are not confirmed - nothing is shown until the owner turns this on
    days: DAYS.map((day) => ({ day, closed: true, open: "", close: "" })),
  },
  delivery: {
    // "enabled" + NO areas configured = legacy Phase 1 behaviour: orders are
    // accepted, delivery fee is 0 and marked "to be confirmed" (manual). This
    // keeps the live shop taking orders after deploy, before the owner has
    // entered real rules. Once areas exist, customers must choose one.
    enabled: true,
    localEnabled: true,
    localFee: null,
    freeDeliveryMinOrder: null,
    deliveryHours: "",
    notes: "",
    areas: [],
  },
  payment: {
    whatsappEnabled: true, // the only method live today
    codEnabled: false,
  },
  couriers: [],
});

module.exports = { DAYS, PAYMENT_METHODS, AREA_TYPES, buildDefaultSettings };
