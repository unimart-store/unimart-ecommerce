/**
 * Delivery price preview. The SERVER prices the items from its own database
 * and applies the delivery rules the owner configured; this sends only WHICH
 * items and WHICH area - never a price, fee or total.
 * Result: {deliverable, subtotal, delivery:{mode,fee,areaName,...}, total}
 *      or {deliverable:false, code, message}.
 */
const DeliveryService = {
  quote: async ({ areaId, items }) => {
    const payload = {};
    if (areaId) payload.areaId = areaId;
    if (items) payload.items = items; // guests only; logged-in users are priced from their stored cart
    const res = await ApiClient.post(UniMartConfig.getUrl("delivery", "/quote"), payload);
    return res?.data || null;
  },
};

window.DeliveryService = DeliveryService;
