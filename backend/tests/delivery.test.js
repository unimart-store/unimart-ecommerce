const test = require("node:test");
const assert = require("node:assert/strict");
const { buildQuote, describeArea } = require("../utils/delivery");
const { buildDefaultSettings } = require("../utils/settingsDefaults");

const area = (o) => ({ id: "aaaaaaaa1", name: "Area", type: "local", enabled: true, fee: null, minOrder: null, courierId: null, message: "", ...o });
const courier = (o) => ({ id: "cccccccc1", name: "NCM", enabled: true, fee: null, ...o });
const settings = ({ delivery = {}, couriers = [] } = {}) => {
  const s = buildDefaultSettings();
  s.delivery = { ...s.delivery, ...delivery };
  s.couriers = couriers;
  return s;
};
const q = (s, subtotal, areaId) => buildQuote(s, { subtotal, areaId });

test("default (nothing configured): orders still accepted, fee 0, marked manual, total = subtotal", () => {
  const r = q(settings(), 1200);
  assert.deepEqual(r, { ok: true, delivery: { mode: "manual", fee: 0, freeApplied: false }, total: 1200 });
  assert.equal(q(settings(), 1200, "zzzzzzzz").ok, true, "a stray area id is ignored when no areas exist");
});

test("delivery disabled: rejected even when areas exist", () => {
  const s = settings({ delivery: { enabled: false, areas: [area({})] } });
  const r = q(s, 1000, "aaaaaaaa1");
  assert.equal(r.ok, false); assert.equal(r.code, "DELIVERY_DISABLED");
  assert.equal(q(settings({ delivery: { enabled: false } }), 1000).code, "DELIVERY_DISABLED");
});

test("areas configured: an area must be chosen, and it must exist and be enabled", () => {
  const s = settings({ delivery: { areas: [area({}), area({ id: "bbbbbbbb1", name: "Off", enabled: false })] } });
  assert.equal(q(s, 500).code, "AREA_REQUIRED");
  assert.equal(q(s, 500, "nopenope1").code, "AREA_NOT_FOUND");
  assert.equal(q(s, 500, "bbbbbbbb1").code, "AREA_NOT_FOUND", "disabled areas cannot be chosen");
});

test("unsupported area: rejected with the owner's message (or a default one)", () => {
  const custom = settings({ delivery: { areas: [area({ type: "unsupported", message: "We do not deliver here yet." })] } });
  const r = q(custom, 1000, "aaaaaaaa1");
  assert.equal(r.code, "AREA_UNSUPPORTED"); assert.equal(r.message, "We do not deliver here yet.");
  const plain = settings({ delivery: { areas: [area({ type: "unsupported", name: "Mars" })] } });
  assert.match(q(plain, 1000, "aaaaaaaa1").message, /Mars/);
});

test("local area: free when no local fee is set", () => {
  const r = q(settings({ delivery: { areas: [area({})] } }), 300, "aaaaaaaa1");
  assert.equal(r.ok, true); assert.equal(r.delivery.fee, 0); assert.equal(r.delivery.freeApplied, true);
  assert.equal(r.delivery.mode, "local"); assert.equal(r.delivery.areaName, "Area"); assert.equal(r.total, 300);
});

test("local area with a fee: charged below the free-delivery minimum, free at/above it", () => {
  const s = settings({ delivery: { localFee: 50, freeDeliveryMinOrder: 1000, areas: [area({})] } });
  assert.equal(q(s, 999.99, "aaaaaaaa1").delivery.fee, 50);
  assert.equal(q(s, 999.99, "aaaaaaaa1").total, 1049.99);
  assert.equal(q(s, 1000, "aaaaaaaa1").delivery.fee, 0);
  assert.equal(q(s, 5000, "aaaaaaaa1").delivery.freeApplied, true);
});

test("local fee with no free-delivery minimum: always charged", () => {
  const r = q(settings({ delivery: { localFee: 50, areas: [area({})] } }), 100000, "aaaaaaaa1");
  assert.equal(r.delivery.fee, 50); assert.equal(r.delivery.freeApplied, false);
});

test("local delivery switched off: local areas are refused, paid areas still work", () => {
  const s = settings({ delivery: { localEnabled: false, areas: [area({}), area({ id: "pppppppp1", name: "Far", type: "paid", fee: 200 })] } });
  assert.equal(q(s, 500, "aaaaaaaa1").code, "LOCAL_DISABLED");
  assert.equal(q(s, 500, "pppppppp1").ok, true);
  assert.equal(describeArea(s, s.delivery.areas[0]).available, false);
  assert.equal(describeArea(s, s.delivery.areas[1]).available, true);
});

test("paid area: uses its own fee; total = subtotal + fee", () => {
  const s = settings({ delivery: { areas: [area({ type: "paid", fee: 250, name: "Kathmandu" })] } });
  const r = q(s, 1500, "aaaaaaaa1");
  assert.equal(r.delivery.fee, 250); assert.equal(r.delivery.mode, "paid"); assert.equal(r.total, 1750); assert.equal(r.delivery.freeApplied, false);
});

test("paid area via courier: courier fee is used, own fee overrides it", () => {
  const c = courier({ fee: 180 });
  const viaCourier = settings({ couriers: [c], delivery: { areas: [area({ type: "paid", courierId: "cccccccc1" })] } });
  const r = q(viaCourier, 1000, "aaaaaaaa1");
  assert.equal(r.delivery.fee, 180); assert.equal(r.delivery.courier, "NCM");
  const override = settings({ couriers: [c], delivery: { areas: [area({ type: "paid", courierId: "cccccccc1", fee: 99 })] } });
  assert.equal(q(override, 1000, "aaaaaaaa1").delivery.fee, 99);
});

test("paid area whose courier is disabled, missing, or has no fee: unavailable (never silently free)", () => {
  const disabled = settings({ couriers: [courier({ fee: 180, enabled: false })], delivery: { areas: [area({ type: "paid", courierId: "cccccccc1", fee: 99 })] } });
  assert.equal(q(disabled, 1000, "aaaaaaaa1").code, "FEE_UNAVAILABLE");
  const missing = settings({ couriers: [], delivery: { areas: [area({ type: "paid", courierId: "cccccccc1" })] } });
  assert.equal(q(missing, 1000, "aaaaaaaa1").code, "FEE_UNAVAILABLE");
  const noFee = settings({ couriers: [courier({ fee: null })], delivery: { areas: [area({ type: "paid", courierId: "cccccccc1" })] } });
  assert.equal(q(noFee, 1000, "aaaaaaaa1").code, "FEE_UNAVAILABLE");
  const bare = settings({ delivery: { areas: [area({ type: "paid" })] } });
  assert.equal(q(bare, 1000, "aaaaaaaa1").code, "FEE_UNAVAILABLE");
  assert.equal(describeArea(bare, bare.delivery.areas[0]).available, false);
});

test("a free (0) paid fee is a real fee of zero, not 'missing'", () => {
  const r = q(settings({ delivery: { areas: [area({ type: "paid", fee: 0 })] } }), 400, "aaaaaaaa1");
  assert.equal(r.ok, true); assert.equal(r.delivery.fee, 0); assert.equal(r.delivery.freeApplied, true);
});

test("minimum order: below is refused with the amount in NPR, at the minimum is accepted", () => {
  const s = settings({ delivery: { areas: [area({ minOrder: 500, name: "Butwal", type: "paid", fee: 100 })] } });
  const below = q(s, 499.99, "aaaaaaaa1");
  assert.equal(below.code, "BELOW_MINIMUM"); assert.match(below.message, /NPR 500/); assert.match(below.message, /Butwal/);
  assert.equal(q(s, 500, "aaaaaaaa1").ok, true);
  assert.doesNotMatch(below.message, /₹|INR|Rs\./);
});

test("money is rounded to 2 decimals (no floating-point drift)", () => {
  const s = settings({ delivery: { areas: [area({ type: "paid", fee: 0.1 })] } });
  assert.equal(q(s, 0.2, "aaaaaaaa1").total, 0.3);
});

test("public availability flags: unsupported and disabled-delivery are never 'available'", () => {
  const s = settings({ delivery: { areas: [area({ type: "unsupported" })] } });
  assert.equal(describeArea(s, s.delivery.areas[0]).available, false);
  const off = settings({ delivery: { enabled: false, areas: [area({})] } });
  assert.equal(describeArea(off, off.delivery.areas[0]).available, false);
});
