/**
 * Checkout service. Calls POST /api/checkout only - the removed
 * POST /api/orders must never be referenced anywhere in the frontend.
 * Never sends a price or total - the server resolves those.
 */
const CheckoutService = {
  // contact: {customerName, customerPhone, customerAddress, paymentMethod}
  // items: [{productId, quantity}] - REQUIRED for guest checkout, ignored by
  // the server for a logged-in user (server reads their stored Cart instead).
  // idempotencyKey: random per intentional checkout attempt. Re-sending the
  // SAME key on a retry makes the server return the existing order instead
  // of creating a second one.
  placeOrder: async (contact, items, idempotencyKey) => {
    const payload = { ...contact };
    if (items) payload.items = items;
    if (idempotencyKey) payload.idempotencyKey = idempotencyKey;
    const res = await ApiClient.post(UniMartConfig.getUrl("checkout"), payload);
    return res?.data || null;
  },
};

window.CheckoutService = CheckoutService;
