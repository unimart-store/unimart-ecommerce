const test = require("node:test");
const assert = require("node:assert/strict");
const fake = require("./helpers/fakeDb");

const restore = fake.install();
test.after(() => restore());
const { checkout } = require("../controllers/checkoutController");

const KEY_A = "3f2b8c1e-9d4a-4f6b-8a1c-2e5d7b9c0a11";
const KEY_B = "b7c9d1e3-5f70-4a2b-9c4d-6e8f0a1b2c3d";
const contact = (extra = {}) => ({
  customerName: "Ram Bahadur Thapa", customerPhone: "98 1234 5678",
  customerAddress: "Aawaroad, opposite Lumbini Bikas Bank, Siddharthanagar", paymentMethod: "WhatsApp", ...extra,
});
const run = async (body, user) => {
  const res = fake.makeRes();
  let err;
  await checkout({ body, user }, res, (e) => { err = e; });
  if (err) throw err;
  return res;
};
const setup = () => { fake.reset(); return { pid: fake.addProduct({ name: "Blue Toy", price: 250, stockQuantity: 5 }) }; };

test("valid guest order: server price, normalized phone, stock decremented, snapshot stored", async () => {
  const { pid } = setup();
  const res = await run({ ...contact(), items: [{ productId: pid, quantity: 2, price: 1, name: "hacked" }],
    price: 1, total: 1, totalAmount: 1, deliveryFee: 0, subtotal: 1, stockQuantity: 9999, status: "Delivered", paymentStatus: "Paid", source: "whatsapp", user: "x" });
  assert.equal(res.statusCode, 201);
  const o = res.body.data;
  assert.equal(o.totalAmount, 500);                                   // 2 x 250 from DB, not the client's 1
  assert.deepEqual(o.items.map((i) => [i.name, i.price, i.quantity]), [["Blue Toy", 250, 2]]);
  assert.equal(o.customerPhone, "+9779812345678");
  assert.equal(o.customerCountry, "Nepal");
  assert.equal(o.status, "Pending"); assert.equal(o.paymentStatus, "Unpaid"); assert.equal(o.source, "website");
  assert.equal(o.user, undefined);
  assert.equal(fake.stockOf(pid), 3);
  assert.equal(fake.db.orders.length, 1);
  assert.equal("idempotencyFingerprint" in o, false);
});

test("later price change does not alter the stored order", async () => {
  const { pid } = setup();
  await run({ ...contact(), items: [{ productId: pid, quantity: 1 }] });
  fake.db.products[0].price = 9999; fake.db.products[0].name = "Renamed";
  assert.equal(fake.db.orders[0].totalAmount, 250);
  assert.equal(fake.db.orders[0].items[0].price, 250);
  assert.equal(fake.db.orders[0].items[0].name, "Blue Toy");
});

test("every invalid customer field is rejected with 400 and nothing is created", async () => {
  const { pid } = setup();
  const items = [{ productId: pid, quantity: 1 }];
  const cases = [
    [{ customerName: "" }, "customerName"], [{ customerName: "abc" }, "customerName"], [{ customerName: "12345" }, "customerName"],
    [{ customerName: { a: 1 } }, "customerName"], [{ customerPhone: "1234567890" }, "customerPhone"], [{ customerPhone: "+919812345678" }, "customerPhone"],
    [{ customerPhone: "" }, "customerPhone"], [{ customerAddress: "" }, "customerAddress"], [{ customerAddress: "test" }, "customerAddress"],
    [{ customerAddress: "a b ".repeat(200) }, "customerAddress"], [{ country: "India" }, "country"], [{ paymentMethod: "Bitcoin" }, "paymentMethod"],
    [{ idempotencyKey: "short" }, "idempotencyKey"],
  ];
  for (const [override, field] of cases) {
    const res = await run({ ...contact(override), items });
    assert.equal(res.statusCode, 400, JSON.stringify(override));
    assert.ok(res.body.errors[field], `${field} error expected for ${JSON.stringify(override)}`);
  }
  assert.equal(fake.db.orders.length, 0); assert.equal(fake.stockOf(pid), 5);
});

test("malformed bodies return 400, never a thrown TypeError/500", async () => {
  const { pid } = setup();
  for (const body of [undefined, null, "x", [], {}, { customerName: [], customerPhone: {}, customerAddress: 7, items: "x" },
    { ...contact(), items: [null] }, { ...contact(), items: [{ productId: { $ne: null }, quantity: 1 }] },
    { ...contact(), items: [{ productId: pid, quantity: "1; drop" }] }]) {
    const res = await run(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(fake.db.orders.length, 0);
});

test("unknown product / inactive product / insufficient stock are rejected and roll back earlier lines", async () => {
  const { pid } = setup();
  const inactive = fake.addProduct({ status: "inactive" });
  const scarce = fake.addProduct({ stockQuantity: 1 });
  const ghost = "f".repeat(24);

  assert.equal((await run({ ...contact(), items: [{ productId: ghost, quantity: 1 }] })).statusCode, 400);
  assert.equal((await run({ ...contact(), items: [{ productId: inactive, quantity: 1 }] })).statusCode, 400);
  const short = await run({ ...contact(), items: [{ productId: pid, quantity: 2 }, { productId: scarce, quantity: 5 }] });
  assert.equal(short.statusCode, 409);
  assert.equal(fake.stockOf(pid), 5, "first line's decrement must roll back");
  assert.equal(fake.stockOf(scarce), 1);
  assert.equal(fake.db.orders.length, 0);
});

test("same idempotency key twice (sequential): ONE order, stock decremented once, same order returned", async () => {
  const { pid } = setup();
  const body = { ...contact(), idempotencyKey: KEY_A, items: [{ productId: pid, quantity: 1 }] };
  const first = await run(body);
  const second = await run(body);
  assert.equal(first.statusCode, 201); assert.equal(second.statusCode, 200);
  assert.equal(second.body.replayed, true);
  assert.equal(second.body.data.orderId, first.body.data.orderId);
  assert.equal(fake.db.orders.length, 1); assert.equal(fake.stockOf(pid), 4);
});

test("same key, concurrent requests: ONE order, stock decremented once", async () => {
  const { pid } = setup();
  const body = { ...contact(), idempotencyKey: KEY_A, items: [{ productId: pid, quantity: 1 }] };
  const results = await Promise.all([run(body), run(body), run(body), run(body)]);
  assert.equal(results.filter((r) => r.statusCode === 201).length, 1);
  assert.ok(results.every((r) => [200, 201].includes(r.statusCode)));
  assert.equal(new Set(results.map((r) => r.body.data.orderId)).size, 1);
  assert.equal(fake.db.orders.length, 1); assert.equal(fake.stockOf(pid), 4);
});

test("unique-index race path: duplicate-key error rolls back and returns the winner's order", async () => {
  const { pid } = setup();
  const body = { ...contact(), idempotencyKey: KEY_A, items: [{ productId: pid, quantity: 1 }] };
  const winner = await run(body);
  fake.control.hideKeyLookups = 2;                 // both pre-checks miss the committed order, like a real race
  const loser = await run(body);
  assert.equal(loser.statusCode, 200);
  assert.equal(loser.body.data.orderId, winner.body.data.orderId);
  assert.equal(fake.db.orders.length, 1); assert.equal(fake.stockOf(pid), 4, "loser's stock decrement must roll back");
});

test("same key but different order details is refused (409), not silently merged", async () => {
  const { pid } = setup();
  await run({ ...contact(), idempotencyKey: KEY_A, items: [{ productId: pid, quantity: 1 }] });
  const res = await run({ ...contact(), idempotencyKey: KEY_A, items: [{ productId: pid, quantity: 3 }] });
  assert.equal(res.statusCode, 409);
  assert.equal(fake.db.orders.length, 1); assert.equal(fake.stockOf(pid), 4);
});

test("different keys = separate intentional orders", async () => {
  const { pid } = setup();
  const base = { ...contact(), items: [{ productId: pid, quantity: 1 }] };
  const a = await run({ ...base, idempotencyKey: KEY_A });
  const b = await run({ ...base, idempotencyKey: KEY_B });
  assert.equal(a.statusCode, 201); assert.equal(b.statusCode, 201);
  assert.notEqual(a.body.data.orderId, b.body.data.orderId);
  assert.equal(fake.db.orders.length, 2); assert.equal(fake.stockOf(pid), 3);
});

test("key is scoped: a guest and a logged-in user using the same key never see each other's order", async () => {
  const { pid } = setup();
  const user = { _id: "a".repeat(24) };
  fake.db.carts.push({ user: user._id, items: [{ product: pid, quantity: 1 }] });
  const g = await run({ ...contact(), idempotencyKey: KEY_A, items: [{ productId: pid, quantity: 1 }] });
  const u = await run({ ...contact(), idempotencyKey: KEY_A }, user);
  assert.equal(g.statusCode, 201); assert.equal(u.statusCode, 201);
  assert.notEqual(g.body.data.orderId, u.body.data.orderId);
});

test("logged-in: order comes from the stored cart (client items ignored) and the cart is cleared in the same transaction", async () => {
  const { pid } = setup();
  const other = fake.addProduct({ price: 1, stockQuantity: 100 });
  const user = { _id: "b".repeat(24) };
  fake.db.carts.push({ user: user._id, items: [{ product: pid, quantity: 2 }] });
  const res = await run({ ...contact(), items: [{ productId: other, quantity: 50 }] }, user);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body.data.items.map((i) => i.quantity), [2]);
  assert.equal(res.body.data.totalAmount, 500);
  assert.equal(res.body.data.user, user._id);
  assert.deepEqual(fake.db.carts[0].items, []);
  assert.equal(fake.stockOf(other), 100);
});

test("logged-in: two concurrent checkouts with DIFFERENT keys produce one order; the other gets 'cart is empty'", async () => {
  const { pid } = setup();
  const user = { _id: "c".repeat(24) };
  fake.db.carts.push({ user: user._id, items: [{ product: pid, quantity: 1 }] });
  const [r1, r2] = await Promise.all([run({ ...contact(), idempotencyKey: KEY_A }, user), run({ ...contact(), idempotencyKey: KEY_B }, user)]);
  assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [201, 400]);
  assert.equal(fake.db.orders.length, 1); assert.equal(fake.stockOf(pid), 4);
});

test("logged-in: retrying the SAME key after the cart was cleared returns the order, not 'cart is empty'", async () => {
  const { pid } = setup();
  const user = { _id: "d".repeat(24) };
  fake.db.carts.push({ user: user._id, items: [{ product: pid, quantity: 1 }] });
  const first = await run({ ...contact(), idempotencyKey: KEY_A }, user);
  const retry = await run({ ...contact(), idempotencyKey: KEY_A }, user);
  assert.equal(first.statusCode, 201); assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.data.orderId, first.body.data.orderId);
});

test("logged-in with an empty/missing cart is rejected", async () => {
  setup();
  const res = await run({ ...contact() }, { _id: "e".repeat(24) });
  assert.equal(res.statusCode, 400); assert.match(res.body.message, /empty/i);
});

test("unexpected DB failure inside the transaction rolls back stock and surfaces as an error, not a half-order", async () => {
  const { pid } = setup();
  fake.control.failNextOrderSave = true;
  await assert.rejects(run({ ...contact(), items: [{ productId: pid, quantity: 2 }] }), /boom/);
  assert.equal(fake.stockOf(pid), 5); assert.equal(fake.db.orders.length, 0);
});

test("key omitted still works (rollout compatibility) - documented: no duplicate protection without a key", async () => {
  const { pid } = setup();
  const body = { ...contact(), items: [{ productId: pid, quantity: 1 }] };
  assert.equal((await run(body)).statusCode, 201);
  assert.equal((await run(body)).statusCode, 201);
  assert.equal(fake.db.orders.length, 2);
});

test("REQUIRE_IDEMPOTENCY_KEY=true makes the key mandatory", async () => {
  const { pid } = setup();
  process.env.REQUIRE_IDEMPOTENCY_KEY = "true";
  delete require.cache[require.resolve("../controllers/checkoutController")];
  const strict = require("../controllers/checkoutController").checkout;
  const res = fake.makeRes();
  await strict({ body: { ...contact(), items: [{ productId: pid, quantity: 1 }] } }, res, () => {});
  delete process.env.REQUIRE_IDEMPOTENCY_KEY;
  assert.equal(res.statusCode, 400); assert.ok(res.body.errors.idempotencyKey);
});
