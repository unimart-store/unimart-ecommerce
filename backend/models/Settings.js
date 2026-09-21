const mongoose = require("mongoose");

// One document (key: "business") holding every owner-editable business
// setting. Shape is enforced by utils/settingsValidator.js on every write;
// the schema below is the persistence contract and keeps unknown fields out.
const areaSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ["local", "paid", "unsupported"], required: true },
    enabled: { type: Boolean, default: true },
    fee: { type: Number, default: null }, // paid areas: own flat fee (else the courier's fee)
    minOrder: { type: Number, default: null }, // minimum items subtotal accepted for this area
    courierId: { type: String, default: null },
    message: { type: String, default: "" }, // shown to customers for unsupported areas
  },
  { _id: false }
);

const courierSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    coverage: { type: String, default: "" },
    fee: { type: Number, default: null },
    feeNotes: { type: String, default: "" }, // pricing rules in words (weight bands, COD charges, ...)
    codSupported: { type: Boolean, default: false },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const daySchema = new mongoose.Schema(
  {
    day: { type: String, required: true },
    closed: { type: Boolean, default: true },
    open: { type: String, default: "" },
    close: { type: String, default: "" },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "business" },

    // Optimistic-lock counter: an admin who opened the page before someone
    // else saved gets a clear conflict instead of silently overwriting.
    revision: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    business: {
      name: { type: String, default: "" },
      address: { type: String, default: "" },
      locationText: { type: String, default: "" },
      mapUrl: { type: String, default: "" },
      phone: { type: String, default: "" },
      whatsappNumber: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    social: {
      facebook: { type: String, default: "" },
      instagram: { type: String, default: "" },
      tiktok: { type: String, default: "" },
    },
    hours: {
      enabled: { type: Boolean, default: false },
      days: { type: [daySchema], default: [] },
    },
    delivery: {
      enabled: { type: Boolean, default: true },
      localEnabled: { type: Boolean, default: true },
      localFee: { type: Number, default: null },
      freeDeliveryMinOrder: { type: Number, default: null },
      deliveryHours: { type: String, default: "" },
      notes: { type: String, default: "" },
      areas: { type: [areaSchema], default: [] },
    },
    payment: {
      whatsappEnabled: { type: Boolean, default: true },
      codEnabled: { type: Boolean, default: false },
    },
    couriers: { type: [courierSchema], default: [] },

    // Notification BEHAVIOUR (what is sent, on which channel). No secrets here:
    // Meta credentials are environment variables on the backend only.
    notifications: {
      channels: {
        inApp: { type: Boolean, default: true },
        whatsapp: { type: Boolean, default: false },
      },
      whatsapp: {
        costAcknowledged: { type: Boolean, default: false },
        adminNumber: { type: String, default: "" },
        adminTemplate: { name: { type: String, default: "" }, language: { type: String, default: "en" } },
        customerTemplate: { name: { type: String, default: "" }, language: { type: String, default: "en" } },
      },
      admin: {
        newOrder: { type: Boolean, default: true },
        statusChange: { type: Boolean, default: true },
        cancellation: { type: Boolean, default: true },
        lowStock: { type: Boolean, default: false },
        lowStockThreshold: { type: Number, default: null },
      },
      customer: {
        orderCreated: { type: Boolean, default: true },
        statusChange: { type: Boolean, default: true },
        cancellation: { type: Boolean, default: true },
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
