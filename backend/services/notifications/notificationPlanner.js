/**
 * Decides WHICH notifications an event produces and what they say.
 * PURE (no DB, no network): input = event facts + current settings, output =
 * plain specs. The service does the I/O. Every figure comes from the order
 * (source of truth) or settings - nothing is calculated or invented here.
 */
const { formatNpr } = require("../../utils/delivery");
const { ORDER_STATUSES } = require("../../utils/orderStatus");

const clean = (v, max) => String(v === undefined || v === null ? "" : v).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const digitsOnly = (v) => {
  const d = String(v || "").replace(/[^\d]/g, "");
  return /^\d{8,15}$/.test(d) ? d : null;
};

const orderData = (order, audience, extra = {}) => ({
  orderNumber: clean(order.orderId, 60),
  ...(audience === "customer" ? { orderRef: String(order._id) } : { customerName: clean(order.customerName, 80) }),
  status: order.status,
  total: order.totalAmount,
  ...(order.deliveryArea ? { deliveryArea: clean(order.deliveryArea, 80) } : {}),
  ...extra,
});

const waText = (title, message) => `*${title}*\n${message}`;

/**
 * @returns Array<{
 *   audience, recipientId, type, title, message, orderId, data, dedupeKey,
 *   whatsappTo   // digits to message on WhatsApp, or null
 * }>
 */
const plan = ({ event, order, from, to, actor, orderId, product, stock, settings, adminIds = [] }) => {
  const cfg = settings.notifications;
  const biz = clean(settings.business && settings.business.name, 60) || "UniMart";
  const phone = clean(settings.business && settings.business.phone, 30);
  const adminWa = digitsOnly(cfg.whatsapp.adminNumber);
  const specs = [];

  // Admin recipients, excluding whoever performed the action themselves.
  const actorAdmin = actor && actor.type === "admin" ? String(actor.id) : null;
  const admins = adminIds.map(String).filter((id) => id !== actorAdmin);

  const addAdmin = (base) =>
    admins.forEach((adminId, index) =>
      specs.push({
        audience: "admin",
        recipientId: adminId,
        ...base,
        dedupeKey: `${base.key}:ADMIN:${adminId}`,
        // The owner has ONE WhatsApp number: alert it once per event, not once per admin account.
        whatsappTo: index === 0 ? adminWa : null,
      })
    );

  const addCustomer = (base) => {
    const userId = order.user ? String(order.user) : null;
    // A guest has no account to show an in-app notification in: only worth
    // creating when the WhatsApp channel is on.
    if (!userId && !cfg.channels.whatsapp) return;
    specs.push({
      audience: "customer",
      recipientId: userId,
      ...base,
      dedupeKey: `${base.key}:CUSTOMER:${userId || "guest"}`,
      whatsappTo: digitsOnly(order.customerPhone),
    });
  };

  if (event === "ORDER_CREATED" && order) {
    const oid = String(order._id);
    if (cfg.admin.newOrder) {
      const title = `New order ${clean(order.orderId, 60)}`;
      const message = `${clean(order.customerName, 80)} - ${formatNpr(order.totalAmount)}${order.deliveryArea ? ` - ${clean(order.deliveryArea, 80)}` : ""}`;
      addAdmin({ key: `ORDER_CREATED:${oid}`, type: "ORDER_CREATED", title, message, orderId: oid, data: orderData(order, "admin"), waText: waText(title, message) });
    }
    if (cfg.customer.orderCreated) {
      const title = "Order placed";
      const message = `Your order ${clean(order.orderId, 60)} (${formatNpr(order.totalAmount)}) has been placed with ${biz}. We'll contact you shortly to confirm it.`;
      addCustomer({ key: `ORDER_CREATED:${oid}`, type: "ORDER_CREATED", title, message, orderId: oid, data: orderData(order, "customer"), waText: waText(title, message) });
    }
  }

  if (event === "ORDER_STATUS_CHANGED" && order && ORDER_STATUSES.includes(to)) {
    const oid = String(order._id);
    const fromLabel = ORDER_STATUSES.includes(from) ? from : "unknown";
    const key = `ORDER_STATUS:${oid}:${fromLabel}:${to}`;
    const extra = { fromStatus: fromLabel === "unknown" ? undefined : fromLabel, toStatus: to };
    const no = clean(order.orderId, 60);

    if (to === "Cancelled") {
      const byCustomer = actor && actor.type === "customer";
      if (cfg.customer.cancellation) {
        const title = "Order cancelled";
        const message = byCustomer ? `You cancelled order ${no}.` : `Order ${no} was cancelled by ${biz}.${phone ? ` Questions? Contact ${phone}.` : ""}`;
        addCustomer({ key, type: "ORDER_CANCELLED", title, message, orderId: oid, data: orderData(order, "customer", extra), waText: waText(title, message) });
      }
      if (cfg.admin.cancellation) {
        const title = `Order ${no} cancelled`;
        const message = byCustomer ? `${clean(order.customerName, 80)} cancelled this order (${formatNpr(order.totalAmount)}).` : "Cancelled by another admin.";
        addAdmin({ key, type: "ORDER_CANCELLED", title, message, orderId: oid, data: orderData(order, "admin", extra), waText: waText(title, message) });
      }
    } else {
      if (cfg.customer.statusChange) {
        const title = `Order ${to}`;
        const message = `Your order ${no} is now ${to}.`;
        addCustomer({ key, type: "ORDER_STATUS_CHANGED", title, message, orderId: oid, data: orderData(order, "customer", extra), waText: waText(title, message) });
      }
      if (cfg.admin.statusChange) {
        const title = `Order ${no}: ${to}`;
        const message = `Status changed${fromLabel === "unknown" ? "" : ` from ${fromLabel}`} to ${to}.`;
        addAdmin({ key, type: "ORDER_STATUS_CHANGED", title, message, orderId: oid, data: orderData(order, "admin", extra), waText: waText(title, message) });
      }
    }
  }

  if (event === "LOW_STOCK" && product && Number.isInteger(stock)) {
    const threshold = cfg.admin.lowStockThreshold;
    if (cfg.admin.lowStock && Number.isInteger(threshold) && stock <= threshold) {
      const name = clean(product.name, 80);
      const title = `Low stock: ${name}`;
      const message = `${name} has ${stock} left in stock.`;
      // One alert per (product, stock level, causing order): retries never duplicate,
      // but falling to the same level again after a restock alerts again.
      addAdmin({ key: `LOW_STOCK:${String(product.id)}:${stock}:${clean(orderId, 40)}`, type: "LOW_STOCK", title, message, orderId: orderId ? String(orderId) : undefined, data: { productName: name, stock }, waText: waText(title, message) });
    }
  }

  return specs;
};

module.exports = { plan, clean, digitsOnly };
