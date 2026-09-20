/**
 * Delivery rules engine - PURE functions (no DB, no Express).
 *
 * The server is the only place a delivery fee is ever decided. The browser
 * may ASK for a quote, but a fee or total it sends is never used as truth.
 *
 * Rule model (see settingsDefaults.js / settingsValidator.js):
 *   delivery.enabled  master switch
 *   delivery.areas[]  {id, name, type: local|paid|unsupported, enabled, fee,
 *                      minOrder, courierId, message}
 *   type "local"       own-bike delivery. Fee = delivery.localFee, waived when
 *                      subtotal >= delivery.freeDeliveryMinOrder. localFee
 *                      null/0 means local delivery is simply free.
 *   type "paid"        fee = area.fee, else the fee of the area's courier.
 *   type "unsupported" delivery refused with the owner's message.
 *   area.minOrder      minimum items subtotal required for that area.
 *
 * If NO enabled areas exist the shop is "unconfigured" and behaves exactly
 * like Phase 1: fee 0, marked "manual" (to be confirmed by the owner).
 */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const formatNpr = (n) => `NPR ${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const fail = (code, message) => ({ ok: false, code, message });

const findCourier = (couriers, id) => (id ? (couriers || []).find((c) => c.id === id) : undefined);

// Fee (or reason it is unavailable) for a "paid" area.
const resolvePaidFee = (area, couriers) => {
  let courier;
  if (area.courierId) {
    courier = findCourier(couriers, area.courierId);
    if (!courier || !courier.enabled) return { unavailable: true };
  }
  const fee = area.fee !== null && area.fee !== undefined ? area.fee : courier ? courier.fee : null;
  if (fee === null || fee === undefined) return { unavailable: true };
  return { fee, courier };
};

// Can customers currently choose this area at all? (used for the public list)
const describeArea = (settings, area) => {
  const d = settings.delivery;
  if (!d.enabled || !area.enabled) return { available: false };
  if (area.type === "unsupported") return { available: false, reason: area.message || "" };
  if (area.type === "local") return { available: Boolean(d.localEnabled) };
  return { available: !resolvePaidFee(area, settings.couriers).unavailable };
};

/**
 * @returns {{ok:true, delivery:{mode,fee,areaId,areaName,courier,freeApplied}, total:number}
 *         |{ok:false, code:string, message:string}}
 */
const buildQuote = (settings, { subtotal, areaId }) => {
  const d = settings.delivery;
  const sub = round2(subtotal);

  if (!d.enabled) return fail("DELIVERY_DISABLED", "Delivery is currently unavailable.");

  const areas = (d.areas || []).filter((a) => a.enabled);

  if (areas.length === 0) {
    // Owner has not entered delivery rules yet: Phase 1 behaviour.
    return { ok: true, delivery: { mode: "manual", fee: 0, freeApplied: false }, total: sub };
  }

  if (!areaId) return fail("AREA_REQUIRED", "Please select your delivery area.");

  const area = areas.find((a) => a.id === areaId);
  if (!area) return fail("AREA_NOT_FOUND", "That delivery area is no longer available. Please choose another.");

  if (area.type === "unsupported") {
    return fail("AREA_UNSUPPORTED", area.message || `Sorry, we don't deliver to ${area.name} yet.`);
  }

  if (area.minOrder !== null && area.minOrder !== undefined && sub < area.minOrder) {
    return fail("BELOW_MINIMUM", `The minimum order for ${area.name} is ${formatNpr(area.minOrder)}.`);
  }

  let fee;
  let courierName;

  if (area.type === "local") {
    if (!d.localEnabled) return fail("LOCAL_DISABLED", "Local delivery is currently unavailable.");
    const localFee = d.localFee || 0;
    const waived = d.freeDeliveryMinOrder !== null && d.freeDeliveryMinOrder !== undefined && sub >= d.freeDeliveryMinOrder;
    fee = localFee > 0 && !waived ? localFee : 0;
  } else {
    const paid = resolvePaidFee(area, settings.couriers);
    if (paid.unavailable) return fail("FEE_UNAVAILABLE", `Delivery to ${area.name} is temporarily unavailable.`);
    fee = paid.fee;
    courierName = paid.courier ? paid.courier.name : undefined;
  }

  fee = round2(fee);
  return {
    ok: true,
    delivery: {
      mode: area.type, // "local" | "paid"
      fee,
      areaId: area.id,
      areaName: area.name,
      courier: courierName,
      freeApplied: fee === 0,
    },
    total: round2(sub + fee),
  };
};

module.exports = { buildQuote, describeArea, resolvePaidFee, round2, formatNpr };
