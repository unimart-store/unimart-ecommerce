/**
 * UNiMART Admin - order detail helpers (pure string builders, unit-tested).
 * Orders placed before dynamic delivery have no delivery fields: they show
 * their original total and nothing is invented for them.
 */
const AdminOrderView = (() => {
  const deliveryTypeLabel = (order) =>
    ({ local: "Local delivery", paid: "Paid delivery", manual: "To be confirmed with customer" }[order.deliveryType] || "");

  const renderTotalsRows = (order, itemsTotal) => {
    const hasBreakdown = order && order.subtotal !== undefined && order.subtotal !== null;
    if (!hasBreakdown) {
      const legacyTotal = order && order.totalAmount !== undefined ? order.totalAmount : itemsTotal;
      return `<tr><td colspan="3">Total</td><td>${AdminFormat.currency(legacyTotal)}</td></tr>`;
    }
    const manual = order.deliveryType === "manual" || order.deliveryFee === undefined || order.deliveryFee === null;
    const feeText = manual ? "To be confirmed" : order.deliveryFee === 0 ? "FREE" : AdminFormat.currency(order.deliveryFee);
    const area = order.deliveryArea ? ` (${AdminFormat.escapeHtml(order.deliveryArea)})` : "";
    return `
      <tr><td colspan="3">Items subtotal</td><td>${AdminFormat.currency(order.subtotal)}</td></tr>
      <tr><td colspan="3">Delivery${area}</td><td>${feeText}</td></tr>
      <tr><td colspan="3"><strong>Total${manual ? " (excl. delivery)" : ""}</strong></td><td><strong>${AdminFormat.currency(order.totalAmount)}</strong></td></tr>`;
  };

  const renderDeliverySection = (order) => {
    if (!order.deliveryType) return "";
    return `
      <div class="admin-order-detail-section">
        <h3>Delivery</h3>
        <dl class="admin-order-detail-grid">
          <div><dt>Type</dt><dd>${AdminFormat.escapeHtml(deliveryTypeLabel(order))}</dd></div>
          <div><dt>Area</dt><dd>${AdminFormat.escapeHtml(order.deliveryArea || "—")}</dd></div>
          ${order.deliveryCourier ? `<div><dt>Courier</dt><dd>${AdminFormat.escapeHtml(order.deliveryCourier)}</dd></div>` : ""}
          <div><dt>Delivery fee</dt><dd>${order.deliveryType === "manual" ? "To be confirmed" : AdminFormat.currency(order.deliveryFee)}</dd></div>
        </dl>
      </div>`;
  };

  return { deliveryTypeLabel, renderTotalsRows, renderDeliverySection };
})();

window.AdminOrderView = AdminOrderView;
