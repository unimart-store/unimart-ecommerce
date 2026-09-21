const mongoose = require("mongoose");

// Days a notification is kept AFTER the recipient has read it. Unread
// notifications never expire (nothing important is deleted unseen).
const RETENTION_AFTER_READ_DAYS = 180;

const notificationSchema = new mongoose.Schema(
  {
    recipientType: { type: String, enum: ["admin", "customer"], required: true },

    // The authenticated user this notification belongs to. null only for a
    // GUEST customer's order (no account to show it to): such a record exists
    // to track WhatsApp delivery/dedupe and is unreachable through any API.
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },

    type: { type: String, enum: ["ORDER_CREATED", "ORDER_STATUS_CHANGED", "ORDER_CANCELLED", "LOW_STOCK"], required: true },
    title: { type: String, required: true, maxlength: 120 },
    message: { type: String, required: true, maxlength: 500 },

    // Display + navigation context, copied from the order/product at event
    // time so lists never need per-row lookups. The ORDER stays the source of
    // truth - nothing here is ever used to calculate money.
    data: {
      orderNumber: String, // e.g. ORD-... (used for admin deep links; safe to show)
      orderRef: String, // customer notifications only: the customer's own order link id
      status: String,
      fromStatus: String,
      toStatus: String,
      total: Number,
      deliveryArea: String,
      customerName: String, // admin notifications only
      productName: String,
      stock: Number,
    },

    channels: {
      inApp: {
        status: { type: String, enum: ["delivered", "disabled", "not_applicable"], default: "delivered" },
      },
      whatsapp: {
        status: { type: String, enum: ["pending", "sent", "failed", "skipped", "disabled", "not_applicable"], default: "disabled" },
        attempts: { type: Number, default: 0 },
        lastAttemptAt: Date,
        sentAt: Date,
        reason: { type: String, maxlength: 200 }, // short, sanitized - never a token or full API response
      },
    },

    readAt: { type: Date, default: null },
    expiresAt: { type: Date }, // set when read; TTL removes the row afterwards. Unset = never expires.

    // Deterministic per event + audience + recipient. UNIQUE, so the same event
    // processed twice (retries, cold starts, webhook replays) cannot duplicate.
    dedupeKey: { type: String, required: true },
  },
  { timestamps: true }
);

notificationSchema.index({ dedupeKey: 1 }, { unique: true });
notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, readAt: 1 });
notificationSchema.index({ orderId: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // documents without expiresAt are ignored by TTL

module.exports = mongoose.model("Notification", notificationSchema);
module.exports.RETENTION_AFTER_READ_DAYS = RETENTION_AFTER_READ_DAYS;
