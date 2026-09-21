/**
 * Notification behaviour settings (the "Notifications" section of Admin ->
 * Settings): defaults, validation and merge. PURE - no DB, no Express.
 *
 * These control BUSINESS BEHAVIOUR only. Infrastructure secrets (Meta access
 * token, app secret, webhook verify token, ...) are environment variables on
 * the backend and must NEVER be stored here. The only contact detail stored
 * is the owner's own WhatsApp number to alert, plus Meta template NAMES
 * (public identifiers, not credentials).
 */
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;   // Meta template names: lowercase letters, digits, underscore
const TEMPLATE_LANG = /^[a-z]{2}(_[A-Z]{2})?$/; // e.g. en, en_US

const buildDefaultNotifications = () => ({
  channels: {
    inApp: true, // free, always available: the bell in Admin and on the storefront
    // Business-initiated WhatsApp messages can be billed by Meta and need an
    // approved template outside the 24h customer-service window, so this is
    // OFF until the owner deliberately turns it on and acknowledges that.
    whatsapp: false,
  },
  whatsapp: {
    costAcknowledged: false,
    adminNumber: "", // the OWNER'S own WhatsApp number to alert (not the bot's business number)
    adminTemplate: { name: "", language: "en" },
    customerTemplate: { name: "", language: "en" },
  },
  admin: { newOrder: true, statusChange: true, cancellation: true, lowStock: false, lowStockThreshold: null },
  customer: { orderCreated: true, statusChange: true, cancellation: true },
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Completes a stored (possibly older / partial) notifications object with defaults.
const mergeNotifications = (stored) => {
  const d = buildDefaultNotifications();
  const s = isObj(stored) ? stored : {};
  const sub = (k) => ({ ...d[k], ...(isObj(s[k]) ? s[k] : {}) });
  const whatsapp = sub("whatsapp");
  whatsapp.adminTemplate = { ...d.whatsapp.adminTemplate, ...(isObj(whatsapp.adminTemplate) ? whatsapp.adminTemplate : {}) };
  whatsapp.customerTemplate = { ...d.whatsapp.customerTemplate, ...(isObj(whatsapp.customerTemplate) ? whatsapp.customerTemplate : {}) };
  return { channels: sub("channels"), whatsapp, admin: sub("admin"), customer: sub("customer") };
};

/**
 * @param raw     the `notifications` object from the request (untrusted)
 * @param r       the shared field reader from settingsValidator (records errors by path)
 * @param errors  the shared errors object
 * @param helpers { normalizeWhatsAppNumber }  (passed in to avoid a circular import)
 */
const validateNotifications = (raw, r, errors, helpers) => {
  const src = isObj(raw) ? raw : {};
  const d = buildDefaultNotifications();
  const ch = isObj(src.channels) ? src.channels : {};
  const wa = isObj(src.whatsapp) ? src.whatsapp : {};
  const ad = isObj(src.admin) ? src.admin : {};
  const cu = isObj(src.customer) ? src.customer : {};

  const out = {
    channels: {
      inApp: r.bool("notifications.channels.inApp", ch.inApp, d.channels.inApp),
      whatsapp: r.bool("notifications.channels.whatsapp", ch.whatsapp, d.channels.whatsapp),
    },
    whatsapp: {
      costAcknowledged: r.bool("notifications.whatsapp.costAcknowledged", wa.costAcknowledged, false),
      adminNumber: "",
      adminTemplate: { name: "", language: "en" },
      customerTemplate: { name: "", language: "en" },
    },
    admin: {
      newOrder: r.bool("notifications.admin.newOrder", ad.newOrder, d.admin.newOrder),
      statusChange: r.bool("notifications.admin.statusChange", ad.statusChange, d.admin.statusChange),
      cancellation: r.bool("notifications.admin.cancellation", ad.cancellation, d.admin.cancellation),
      lowStock: r.bool("notifications.admin.lowStock", ad.lowStock, d.admin.lowStock),
      lowStockThreshold: null,
    },
    customer: {
      orderCreated: r.bool("notifications.customer.orderCreated", cu.orderCreated, d.customer.orderCreated),
      statusChange: r.bool("notifications.customer.statusChange", cu.statusChange, d.customer.statusChange),
      cancellation: r.bool("notifications.customer.cancellation", cu.cancellation, d.customer.cancellation),
    },
  };

  // Owner's WhatsApp number (digits with country code, as Meta expects).
  if (wa.adminNumber !== undefined && wa.adminNumber !== null && wa.adminNumber !== "") {
    const digits = helpers.normalizeWhatsAppNumber(wa.adminNumber);
    if (!digits) errors["notifications.whatsapp.adminNumber"] = "Enter a valid WhatsApp number with country code (e.g. +977 98XXXXXXXX)";
    else out.whatsapp.adminNumber = digits;
  }

  // Template names/languages (identifiers only - never credentials).
  [["adminTemplate", "Admin"], ["customerTemplate", "Customer"]].forEach(([key, label]) => {
    const t = isObj(wa[key]) ? wa[key] : {};
    const name = typeof t.name === "string" ? t.name.trim() : "";
    const language = typeof t.language === "string" && t.language.trim() ? t.language.trim() : "en";
    if (t.name !== undefined && t.name !== null && typeof t.name !== "string") errors[`notifications.whatsapp.${key}.name`] = `${label} template name must be text`;
    else if (name && !TEMPLATE_NAME.test(name)) errors[`notifications.whatsapp.${key}.name`] = "Use the template name exactly as approved in Meta (lowercase letters, digits and underscores)";
    else out.whatsapp[key].name = name;
    if (!TEMPLATE_LANG.test(language)) errors[`notifications.whatsapp.${key}.language`] = "Use a language code such as en or en_US";
    else out.whatsapp[key].language = language;
  });

  // Turning WhatsApp on is a deliberate, acknowledged decision (Meta may bill business-initiated messages).
  if (out.channels.whatsapp && !out.whatsapp.costAcknowledged) {
    errors["notifications.whatsapp.costAcknowledged"] = "Confirm that you understand Meta may charge for business-initiated WhatsApp messages before enabling this channel";
  }

  // Low-stock alerts need a threshold the OWNER chooses (none is invented).
  const rawThreshold = ad.lowStockThreshold;
  const hasThreshold = rawThreshold !== undefined && rawThreshold !== null && rawThreshold !== "";
  if (hasThreshold) {
    const n = typeof rawThreshold === "number" ? rawThreshold : Number(rawThreshold);
    if (!Number.isInteger(n) || n < 0 || n > 100000) errors["notifications.admin.lowStockThreshold"] = "Enter a whole number between 0 and 100000";
    else out.admin.lowStockThreshold = n;
  } else if (out.admin.lowStock) {
    errors["notifications.admin.lowStockThreshold"] = "Enter the stock level at or below which you want to be alerted";
  }

  return out;
};

module.exports = { buildDefaultNotifications, mergeNotifications, validateNotifications, TEMPLATE_NAME, TEMPLATE_LANG };
