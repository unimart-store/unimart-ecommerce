const test = require("node:test");
const assert = require("node:assert/strict");
const fake = require("./helpers/fakeDb");

const restore = fake.install();
test.after(() => restore());
const { checkout } = require("../controllers/checkoutController");
const { quote } = require("../controllers/deliveryController");
const { cancelMyOrder, updateOrderStatus } = require("../controllers/orderController");
const settingsRouter = require("../routes/settingsRoutes");

const KEY_A = "3f2b8c1e-9d4a-4f6b-8a1c-2e5d7b9c0a11";
const LOCAL = "aaaaaaaa11", PAID = "bbbbbbbb22", VIA_COURIER = "cccccccc33", NOPE = "dddddddd44", MIN = "eeeeeeee55";

const contact = (extra = {}) => ({ customerName: "Ram Bahadur Thapa", customerPhone: "9812345678",
  customerAddress: "Aawaroad, opposite Lumbini Bikas Bank, Siddharthanagar", paymentMethod: "WhatsApp", ...extra });
const run = async (fn, req) => { const res = fake.makeRes(); let err; await fn(req, res, (e) => { err = e; }); if (err) throw err; return res; };
const order = (body, user) => run(checkout, { body, user });
const ask = (body, user) => run(quote, { body, user });

// Owner has configured: local (free), a paid area, a courier-priced area, an unsupported area, and a min-order area.
const configured = (delivery = {}, more = {}) => fake.setSettings({
  delivery: { enabled: true, localEnabled: true, localFee: null, freeDeliveryMinOrder: null, deliveryHours: "", notes: "", areas: [
    { id: LOCAL, name: "Siddharthanagar", type: "local", enabled: true, fee: null, minOrder: null, courierId: null, message: "" },
    { id: PAID, name: "Kathmandu", type: "paid", enabled: true, fee: 250, minOrder: null, courierId: null, message: "" },
    { id: VIA_COURIER, name: "Pokhara", type: "paid", enabled: true, fee: null, minOrder: null, courierId: "cccccccc99", message: "" },
    { id: NOPE, name: "Remote Valley", type: "unsupported", enabled: true, fee: null, minOrder: null, courierId: null, message: "We cannot deliver to Remote Valley yet." },
    { id: MIN, name: "Butwal", type: "paid", enabled: true, fee: 100, minOrder: 1000, courierId: null, message: "" },
  ], ...delivery },
  couriers: [{ id: "cccccccc99", name: "NCM", enabled: true, coverage: "", fee: 180, feeNotes: "", codSupported: false, notes: "" }],
  ...more,
});
const shop = () => { fake.reset(); return { pid: fake.addProduct({ name: "Blue Toy", price: 500, stockQuantity: 10 }) }; };
const items = (pid, quantity = 1) => [{ productId: pid, quantity }];

// ---------------- server-calculated quote ----------------

test("quote: subtotal comes from DATABASE prices - client-sent prices/fees/totals are ignored", async () => {
  const { pid } = shop(); configured();
  const res = await ask({ areaId: PAID, items: [{ productId: pid, quantity: 2, price: 1, name: "hacked" }], price: 1, subtotal: 1, deliveryFee: 0, total: 1 });
  assert.equal(res.statusCode, 200);
  const d = res.body.data;
  assert.equal(d.deliverable, true); assert.equal(d.subtotal, 1000); assert.equal(d.delivery.fee, 250); assert.equal(d.total, 1250); assert.equal(d.currency, "NPR");
});

test("quote: local free, courier-priced, unsupported, missing/unknown area, below minimum", async () => {
  const { pid } = shop(); configured();
  const get = async (areaId, qty = 1) => (await ask({ areaId, items: items(pid, qty) })).body.data;
  assert.deepEqual([(await get(LOCAL)).delivery.fee, (await get(LOCAL)).delivery.freeApplied], [0, true]);
  const courier = await get(VIA_COURIER); assert.equal(courier.delivery.fee, 180); assert.equal(courier.delivery.courier, "NCM");
  const nope = await get(NOPE); assert.equal(nope.deliverable, false); assert.equal(nope.code, "AREA_UNSUPPORTED"); assert.match(nope.message, /Remote Valley/);
  assert.equal((await get(undefined)).code, "AREA_REQUIRED");
  assert.equal((await get("zzzzzzzz99")).code, "AREA_NOT_FOUND");
  assert.equal((await get(MIN, 1)).code, "BELOW_MINIMUM");          // 500 < 1000
  assert.equal((await get(MIN, 2)).deliverable, true);              // 1000 >= 1000
});

test("quote: unconfigured shop = Phase 1 behaviour (manual, fee 0); disabled delivery is reported", async () => {
  const { pid } = shop();
  const unconfigured = (await ask({ items: items(pid) })).body.data;
  assert.equal(unconfigured.delivery.mode, "manual"); assert.equal(unconfigured.total, 500);
  configured({ enabled: false });
  assert.equal((await ask({ areaId: LOCAL, items: items(pid) })).body.data.code, "DELIVERY_DISABLED");
});

test("quote: logged-in customers are priced from their stored cart; empty cart / bad items rejected", async () => {
  const { pid } = shop(); configured();
  const user = { _id: "a".repeat(24) };
  assert.equal((await ask({ areaId: PAID }, user)).statusCode, 400);
  fake.db.carts.push({ user: user._id, items: [{ product: pid, quantity: 3 }] });
  const d = (await ask({ areaId: PAID, items: [{ productId: pid, quantity: 99 }] }, user)).body.data;
  assert.equal(d.subtotal, 1500); assert.equal(d.total, 1750);
  for (const body of [{ areaId: PAID }, { areaId: PAID, items: [] }, { areaId: PAID, items: [{ productId: "x", quantity: 1 }] }, { areaId: { $ne: 1 }, items: items(pid) }, { areaId: "A!", items: items(pid) }]) {
    assert.equal((await ask(body)).statusCode, 400, JSON.stringify(body));
  }
  fake.db.products[0].status = "inactive";
  assert.equal((await ask({ areaId: PAID, items: items(pid) })).statusCode, 400);
});

// ---------------- checkout: server-authoritative delivery + total ----------------

test("checkout: total = server subtotal + server delivery fee; stored on the order as a snapshot", async () => {
  const { pid } = shop(); configured();
  const res = await order({ ...contact(), deliveryAreaId: PAID, items: items(pid, 2) });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const o = res.body.data;
  assert.deepEqual([o.subtotal, o.deliveryFee, o.totalAmount], [1000, 250, 1250]);
  assert.deepEqual([o.deliveryType, o.deliveryArea, o.deliveryAreaId], ["paid", "Kathmandu", PAID]);
  assert.equal(fake.stockOf(pid), 8);
});

test("checkout: local area is free and recorded as local; courier name is snapshotted", async () => {
  const { pid } = shop(); configured();
  const local = (await order({ ...contact(), deliveryAreaId: LOCAL, items: items(pid) })).body.data;
  assert.deepEqual([local.deliveryFee, local.deliveryType, local.totalAmount], [0, "local", 500]);
  const viaCourier = (await order({ ...contact(), deliveryAreaId: VIA_COURIER, items: items(pid) })).body.data;
  assert.deepEqual([viaCourier.deliveryFee, viaCourier.deliveryCourier, viaCourier.totalAmount], [180, "NCM", 680]);
});

test("checkout: the browser CANNOT set the delivery fee, subtotal or total", async () => {
  const { pid } = shop(); configured();
  const res = await order({ ...contact(), deliveryAreaId: PAID, items: items(pid), deliveryFee: 0, subtotal: 1, total: 1, totalAmount: 1, deliveryType: "local", deliveryArea: "Siddharthanagar", price: 1 });
  assert.equal(res.statusCode, 201);
  const o = res.body.data;
  assert.deepEqual([o.deliveryFee, o.subtotal, o.totalAmount, o.deliveryType, o.deliveryArea], [250, 500, 750, "paid", "Kathmandu"]);
});

test("checkout: a total the customer was shown that no longer matches is refused (409) - never silently changed", async () => {
  const { pid } = shop(); configured();
  const tamper = await order({ ...contact(), deliveryAreaId: PAID, items: items(pid), quotedTotal: 500 }); // pretends delivery is free
  assert.equal(tamper.statusCode, 409); assert.equal(tamper.body.code, "QUOTE_CHANGED"); assert.equal(tamper.body.quote.total, 750);
  assert.equal(fake.db.orders.length, 0); assert.equal(fake.stockOf(pid), 10);
  const fine = await order({ ...contact(), deliveryAreaId: PAID, items: items(pid), quotedTotal: 750 });
  assert.equal(fine.statusCode, 201); assert.equal(fine.body.data.totalAmount, 750);
  const strNum = await order({ ...contact(), deliveryAreaId: PAID, items: items(pid), quotedTotal: "750.00" });
  assert.equal(strNum.statusCode, 201);
});

test("checkout: unsupported / missing / unknown area, disabled delivery, below minimum -> clear 400, NO order, stock untouched", async () => {
  const { pid } = shop(); configured();
  const cases = [[{ deliveryAreaId: NOPE }, "AREA_UNSUPPORTED", /Remote Valley/], [{}, "AREA_REQUIRED", /select/i], [{ deliveryAreaId: "zzzzzzzz99" }, "AREA_NOT_FOUND", /no longer/],
    [{ deliveryAreaId: MIN }, "BELOW_MINIMUM", /minimum order/i]];
  for (const [extra, code, msg] of cases) {
    const res = await order({ ...contact(), items: items(pid), ...extra });
    assert.equal(res.statusCode, 400, code); assert.equal(res.body.code, code); assert.match(res.body.message, msg);
  }
  configured({ enabled: false });
  const off = await order({ ...contact(), deliveryAreaId: LOCAL, items: items(pid) });
  assert.equal(off.statusCode, 400); assert.equal(off.body.code, "DELIVERY_DISABLED");
  assert.equal(fake.db.orders.length, 0); assert.equal(fake.stockOf(pid), 10, "reserved stock must be rolled back");
});

test("checkout: no rules configured yet = Phase 1 behaviour (accepted, fee 0, manual, total = subtotal)", async () => {
  const { pid } = shop();
  const res = await order({ ...contact(), items: items(pid, 2) });
  assert.equal(res.statusCode, 201);
  const o = res.body.data;
  assert.deepEqual([o.subtotal, o.deliveryFee, o.deliveryType, o.totalAmount], [1000, 0, "manual", 1000]);
  assert.equal(o.deliveryArea, undefined);
});

test("checkout: invalid area id / quoted total formats are rejected as 400 field errors", async () => {
  const { pid } = shop(); configured();
  for (const extra of [{ deliveryAreaId: "BAD ID!" }, { deliveryAreaId: { $ne: 1 } }, { deliveryAreaId: 5 }, { quotedTotal: "abc" }, { quotedTotal: -5 }, { quotedTotal: {} }]) {
    const res = await order({ ...contact(), items: items(pid), deliveryAreaId: LOCAL, ...extra });
    assert.equal(res.statusCode, 400, JSON.stringify(extra));
  }
  assert.equal(fake.db.orders.length, 0);
});

test("checkout: logged-in customer - cart priced on the server, delivery added, cart cleared", async () => {
  const { pid } = shop(); configured();
  const user = { _id: "b".repeat(24) };
  fake.db.carts.push({ user: user._id, items: [{ product: pid, quantity: 2 }] });
  const res = await order({ ...contact(), deliveryAreaId: PAID, quotedTotal: 1250 }, user);
  assert.equal(res.statusCode, 201); assert.equal(res.body.data.totalAmount, 1250);
  assert.deepEqual(fake.db.carts[0].items, []);
});

// ---------------- idempotency + history are unaffected ----------------

test("idempotent replay returns the ORIGINAL order even after the owner changed delivery rules", async () => {
  const { pid } = shop(); configured();
  const body = { ...contact(), deliveryAreaId: PAID, idempotencyKey: KEY_A, items: items(pid) };
  const first = await order(body);
  configured({}, {}); fake.db.settings[0].delivery.areas.find((a) => a.id === PAID).fee = 9999;
  const replay = await order(body);
  assert.equal(replay.statusCode, 200); assert.equal(replay.body.data.orderId, first.body.data.orderId);
  assert.equal(replay.body.data.deliveryFee, 250); assert.equal(fake.db.orders.length, 1); assert.equal(fake.stockOf(pid), 9);
});

test("same idempotency key with a DIFFERENT delivery area is refused, not merged", async () => {
  const { pid } = shop(); configured();
  await order({ ...contact(), deliveryAreaId: PAID, idempotencyKey: KEY_A, items: items(pid) });
  const other = await order({ ...contact(), deliveryAreaId: LOCAL, idempotencyKey: KEY_A, items: items(pid) });
  assert.equal(other.statusCode, 409); assert.equal(fake.db.orders.length, 1);
});

test("historical orders are never rewritten when settings change", async () => {
  const { pid } = shop(); configured();
  const admin = fake.addUser({ role: "admin" });
  await order({ ...contact(), deliveryAreaId: PAID, items: items(pid) });
  const legacy = { _id: fake.nextId(), orderId: "ORD-OLD", status: "Delivered", totalAmount: 750, items: [{ productId: pid, name: "Blue Toy", price: 250, quantity: 3 }] };
  fake.db.orders.push(JSON.parse(JSON.stringify(legacy)));
  const before = JSON.stringify(fake.db.orders);
  const res = await fake.runRoute(settingsRouter, "put", "/", { headers: fake.bearer(admin), body: {
    delivery: { enabled: true, localFee: 500, freeDeliveryMinOrder: 9000, areas: [{ name: "Kathmandu", type: "paid", fee: 9999 }] }, payment: { whatsappEnabled: false, codEnabled: true } } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(fake.db.orders), before, "no order document may change");
});

// ---------------- backward compatibility with pre-Phase-2 orders ----------------

const legacyPending = (pid, qty = 2) => {
  const o = { _id: fake.nextId(), orderId: "ORD-LEGACY", user: "a".repeat(24), status: "Pending", totalAmount: qty * 500,
    items: [{ productId: pid, name: "Blue Toy", price: 500, quantity: qty }] }; // no subtotal/deliveryFee/deliveryType/... at all
  fake.db.orders.push(o); return o;
};

test("legacy orders (no delivery fields) can still be cancelled with correct restock and keep their total", async () => {
  const { pid } = shop(); fake.db.products[0].stockQuantity = 5;
  const o = legacyPending(pid);
  const res = await run(cancelMyOrder, { params: { id: o._id }, user: { _id: "a".repeat(24) } });
  assert.equal(res.statusCode, 200); assert.equal(res.body.status, "Cancelled");
  assert.equal(res.body.totalAmount, 1000); assert.equal(fake.stockOf(pid), 7);
  assert.equal(res.body.deliveryFee, undefined, "no fee is invented for old orders");
});

test("legacy orders can still be advanced by the admin", async () => {
  const { pid } = shop(); const o = legacyPending(pid);
  const res = await run(updateOrderStatus, { params: { id: o._id }, body: { status: "Processing" } });
  assert.equal(res.statusCode, 200); assert.equal(res.body.totalAmount, 1000);
});

// ---------------- payment methods follow the owner's settings ----------------

test("payment method must be one the owner currently accepts (COD off by default)", async () => {
  const { pid } = shop();
  const cod = await order({ ...contact({ paymentMethod: "Cash on Delivery" }), items: items(pid) });
  assert.equal(cod.statusCode, 400); assert.ok(cod.body.errors.paymentMethod);
  fake.setSettings({ payment: { whatsappEnabled: true, codEnabled: true } });
  const ok = await order({ ...contact({ paymentMethod: "Cash on Delivery" }), items: items(pid) });
  assert.equal(ok.statusCode, 201); assert.equal(ok.body.data.paymentMethod, "Cash on Delivery"); assert.equal(ok.body.data.paymentStatus, "Unpaid");
});

test("if the owner turns WhatsApp payment off, it is refused and the default becomes the first enabled method", async () => {
  const { pid } = shop();
  fake.setSettings({ payment: { whatsappEnabled: false, codEnabled: true } });
  assert.equal((await order({ ...contact({ paymentMethod: "WhatsApp" }), items: items(pid) })).statusCode, 400);
  const omitted = contact(); delete omitted.paymentMethod;
  const res = await order({ ...omitted, items: items(pid) });
  assert.equal(res.statusCode, 201); assert.equal(res.body.data.paymentMethod, "Cash on Delivery");
});
