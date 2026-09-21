/**
 * Centralised notification service - the ONLY place notifications are created.
 *
 *   order / stock event  ->  emit*()  ->  planner (who gets what)
 *        ->  in-app record (Notification collection, deduplicated)
 *        ->  optional WhatsApp delivery through the existing WhatsApp service
 *
 * Isolation guarantee: every public function returns immediately and never
 * throws. Work happens on a later tick and all failures are caught and logged
 * safely, so an order/checkout/cancel that already succeeded can NEVER be
 * failed, slowed or rolled back by a notification problem.
 */
const Notification = require("../../models/Notification");
const User = require("../../models/User");
const settingsService = require("../settingsService");
const planner = require("./notificationPlanner");
const whatsappChannel = require("./whatsappChannel");

const MAX_WHATSAPP_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [30 * 1000, 5 * 60 * 1000]; // after attempt 1 and 2

// ---- safe logging: short, no objects, no tokens, no customer message text ----
const describeError = (error) =>
  `${(error && error.name) || "Error"}: ${String((error && error.message) || error).slice(0, 160)}`
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/[A-Za-z0-9_-]{30,}/g, "[redacted]");
const logFailure = (what, error) => console.error(`[notifications] ${what} - ${describeError(error)}`);

const isDuplicateKey = (error) => Boolean(error && error.code === 11000);

// ---- WhatsApp delivery for one stored notification ----
const settingsAllowWhatsApp = (settings) => {
  const n = settings.notifications;
  return Boolean(n.channels.whatsapp && n.whatsapp.costAcknowledged);
};

const attemptWhatsApp = async (record, spec, settings, attempt) => {
  const cfg = settings.notifications.whatsapp;
  const template = spec.audience === "admin" ? cfg.adminTemplate : cfg.customerTemplate;

  const result = await whatsappChannel.send({
    to: spec.whatsappTo,
    text: spec.waText,
    template,
    templateParams: [spec.title, spec.message],
  });

  const set = { "channels.whatsapp.lastAttemptAt": new Date() };
  if (result.status === "sent") {
    set["channels.whatsapp.status"] = "sent";
    set["channels.whatsapp.sentAt"] = new Date();
  } else if (result.status === "failed") {
    const willRetry = result.retryable && attempt < MAX_WHATSAPP_ATTEMPTS;
    set["channels.whatsapp.status"] = willRetry ? "pending" : "failed";
    set["channels.whatsapp.reason"] = String(result.reason || "").slice(0, 200);
  } else {
    set["channels.whatsapp.status"] = result.status; // skipped | disabled
    set["channels.whatsapp.reason"] = String(result.reason || "").slice(0, 200);
  }
  await Notification.updateOne({ _id: record._id }, { $set: set, $inc: { "channels.whatsapp.attempts": 1 } });

  // Bounded, in-process retry for transient failures (429 / 5xx / network).
  if (result.status === "failed" && result.retryable && attempt < MAX_WHATSAPP_ATTEMPTS) {
    setTimeout(() => {
      attemptWhatsApp(record, spec, settings, attempt + 1).catch((e) => logFailure("WhatsApp retry", e));
    }, RETRY_DELAYS_MS[attempt - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]).unref();
  }
};

// ---- one planned notification -> stored record (+ WhatsApp) ----
const deliver = async (spec, settings) => {
  const cfg = settings.notifications;
  const whatsappOn = settingsAllowWhatsApp(settings) && Boolean(spec.whatsappTo);
  const guest = spec.audience === "customer" && !spec.recipientId;

  let record;
  try {
    record = await Notification.create({
      recipientType: spec.audience,
      recipientId: spec.recipientId || null,
      orderId: spec.orderId || undefined,
      type: spec.type,
      title: spec.title,
      message: spec.message,
      data: spec.data,
      channels: {
        inApp: { status: guest ? "not_applicable" : cfg.channels.inApp ? "delivered" : "disabled" },
        whatsapp: { status: whatsappOn ? "pending" : settingsAllowWhatsApp(settings) ? "not_applicable" : "disabled" },
      },
      dedupeKey: spec.dedupeKey,
    });
  } catch (error) {
    if (isDuplicateKey(error)) return; // this exact event was already processed - idempotent
    throw error;
  }

  if (whatsappOn) {
    await attemptWhatsApp(record, spec, settings, 1).catch((error) => logFailure("WhatsApp delivery", error));
  }
};

// ---- event handling ----
const loadAdminIds = async () => {
  const admins = await User.find({ role: "admin", isActive: true }).select("_id").lean();
  return admins.map((u) => String(u._id));
};

const handle = async (event, payload) => {
  const settings = await settingsService.getSettings();
  const adminIds = event === "ORDER_STATUS_CHANGED" || event === "ORDER_CREATED" || event === "LOW_STOCK" ? await loadAdminIds() : [];
  const specs = planner.plan({ event, ...payload, settings, adminIds });
  for (const spec of specs) {
    try {
      await deliver(spec, settings);
    } catch (error) {
      logFailure(`could not record ${spec.type} for ${spec.audience}`, error); // one bad notification never blocks the rest
    }
  }
};

// Schedules the work for a later tick and returns immediately. Never throws.
const emit = (event, payload) => {
  try {
    setImmediate(() => {
      handle(event, payload).catch((error) => logFailure(`${event} failed`, error));
    });
  } catch (error) {
    logFailure(`${event} could not be scheduled`, error);
  }
};

// Plain snapshot so nothing holds a live Mongoose document.
const snapshot = (order) => ({
  _id: String(order._id),
  orderId: order.orderId,
  user: order.user ? String(order.user) : null,
  customerName: order.customerName,
  customerPhone: order.customerPhone,
  totalAmount: order.totalAmount,
  deliveryArea: order.deliveryArea,
  status: order.status,
});

/** A new order was committed. */
const emitOrderCreated = (order) => {
  try { emit("ORDER_CREATED", { order: snapshot(order) }); } catch (error) { logFailure("ORDER_CREATED snapshot", error); }
};

/** An order really moved from `from` to `to` (validation already passed). actor: {type:'admin'|'customer', id} */
const emitOrderStatusChanged = ({ order, from, to, actor }) => {
  try { emit("ORDER_STATUS_CHANGED", { order: snapshot(order), from, to, actor: actor ? { type: actor.type, id: actor.id ? String(actor.id) : null } : undefined }); }
  catch (error) { logFailure("ORDER_STATUS_CHANGED snapshot", error); }
};

/** A product's stock fell to `stock` because of `orderId`. */
const emitLowStock = ({ productId, name, stock, orderId }) => {
  try { emit("LOW_STOCK", { product: { id: String(productId), name }, stock, orderId: orderId ? String(orderId) : undefined }); }
  catch (error) { logFailure("LOW_STOCK", error); }
};

module.exports = { emitOrderCreated, emitOrderStatusChanged, emitLowStock, emit, _handle: handle };
