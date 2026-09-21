/**
 * Settings persistence + shaping. The ONLY module that reads/writes the
 * Settings collection; controllers and checkout go through it.
 */
const Settings = require("../models/Settings");
const { DAYS, PAYMENT_METHODS, buildDefaultSettings } = require("../utils/settingsDefaults");
const { describeArea } = require("../utils/delivery");
const { mergeNotifications } = require("../utils/notificationSettings");

const KEY = "business";

const isDuplicateKey = (error) => error && error.code === 11000;

// Fills anything missing from the stored document with the defaults, so
// settings added in a later release never appear as undefined for a document
// saved before that release.
const withDefaults = (stored) => {
  const defaults = buildDefaultSettings();
  const s = stored || {};
  const section = (name) => ({ ...defaults[name], ...(s[name] || {}) });

  const hours = section("hours");
  if (!Array.isArray(hours.days) || hours.days.length !== 7) hours.days = defaults.hours.days;

  const delivery = section("delivery");
  delivery.areas = Array.isArray(delivery.areas) ? delivery.areas : [];

  return {
    business: section("business"),
    social: section("social"),
    hours,
    delivery,
    payment: section("payment"),
    couriers: Array.isArray(s.couriers) ? s.couriers : [],
    notifications: mergeNotifications(s.notifications),
    revision: Number.isInteger(s.revision) ? s.revision : 0,
    updatedAt: s.updatedAt,
  };
};

// Get-or-create the singleton. Safe under concurrent first requests: the
// unique `key` index makes a losing insert fail, and we simply read the winner.
// (A plain create - not an upsert - so no update-operator/default-value path
// conflicts are possible.)
const getSettings = async () => {
  let stored = await Settings.findOne({ key: KEY }).lean();
  if (!stored) {
    try {
      const created = await Settings.create({ key: KEY, ...buildDefaultSettings(), revision: 0 });
      stored = created.toObject ? created.toObject() : created;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      stored = await Settings.findOne({ key: KEY }).lean();
    }
  }
  return withDefaults(stored);
};

// Replaces the validated sections. `expectedRevision` (optimistic lock) makes a
// stale form fail with `{conflict:true}` instead of overwriting newer changes.
const saveSettings = async (sections, { expectedRevision, userId } = {}) => {
  await getSettings(); // make sure the document exists

  const filter = { key: KEY };
  if (expectedRevision !== undefined) filter.revision = expectedRevision;

  const updated = await Settings.findOneAndUpdate(
    filter,
    { $set: { ...sections, updatedBy: userId }, $inc: { revision: 1 } },
    { new: true, lean: true, runValidators: true }
  );
  if (!updated) return { conflict: true };
  return { settings: withDefaults(updated) };
};

// ---- Shaping ----

// Everything the owner sees/edits. Never contains secrets (none are stored here).
const toAdminSettings = (s) => ({
  business: s.business,
  social: s.social,
  hours: s.hours,
  delivery: s.delivery,
  payment: s.payment,
  couriers: s.couriers,
  notifications: s.notifications, // owner-only (holds their personal WhatsApp number); NEVER part of toPublicSettings
  revision: s.revision,
  updatedAt: s.updatedAt,
});

// The ONLY data exposed to the public storefront. Deliberately excludes
// couriers (coverage/fees/notes), fees, revision and audit fields.
const toPublicSettings = (s) => ({
  currency: "NPR",
  business: {
    name: s.business.name,
    address: s.business.address,
    locationText: s.business.locationText,
    mapUrl: s.business.mapUrl,
    phone: s.business.phone,
    whatsappNumber: s.business.whatsappNumber,
    email: s.business.email,
  },
  social: { ...s.social },
  hours: {
    enabled: Boolean(s.hours.enabled),
    days: s.hours.enabled ? s.hours.days.map((d) => ({ day: d.day, closed: d.closed, open: d.open, close: d.close })) : [],
  },
  delivery: {
    enabled: Boolean(s.delivery.enabled),
    deliveryHours: s.delivery.deliveryHours,
    notes: s.delivery.notes,
    areas: s.delivery.enabled
      ? s.delivery.areas
          .filter((a) => a.enabled)
          .map((a) => {
            const info = describeArea(s, a);
            return {
              id: a.id,
              name: a.name,
              type: a.type,
              available: info.available,
              minOrder: a.minOrder === undefined ? null : a.minOrder,
              message: a.type === "unsupported" ? a.message || "" : "",
            };
          })
      : [],
  },
  payment: { methods: getEnabledPaymentMethods(s) },
});

// [{code, label}] for methods the owner has switched on. label is what an
// order stores in `paymentMethod`.
const getEnabledPaymentMethods = (s) => {
  const methods = [];
  if (s.payment.whatsappEnabled) methods.push({ code: "whatsapp", label: PAYMENT_METHODS.whatsapp });
  if (s.payment.codEnabled) methods.push({ code: "cod", label: PAYMENT_METHODS.cod });
  return methods;
};

module.exports = { getSettings, saveSettings, toAdminSettings, toPublicSettings, getEnabledPaymentMethods, withDefaults, KEY, DAYS };
