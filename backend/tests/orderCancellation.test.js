const test = require("node:test");
const assert = require("node:assert/strict");
const fake = require("./helpers/fakeDb");

const restore = fake.install();
test.after(() => restore());
const { cancelMyOrder, updateOrderStatus } = require("../controllers/orderController");

const USER = { _id: "a".repeat(24) };
const call = async (fn, req) => { const res = fake.makeRes(); let err; await fn(req, res, (e) => { err = e; }); if (err) throw err; return res; };
const cancelAsCustomer = (id, user = USER) => call(cancelMyOrder, { params: { id }, user });
const adminSet = (id, status) => call(updateOrderStatus, { params: { id }, body: { status } });

const seed = (status = "Pending", qtyA = 2, qtyB = 1) => {
  fake.reset();
  const a = fake.addProduct({ stockQuantity: 10 });
  const b = fake.addProduct({ stockQuantity: 4 });
  const orderId = fake.nextId();
  fake.db.orders.push({ _id: orderId, orderId: "ORD-1", user: USER._id, status,
    items: [{ productId: a, quantity: qtyA, price: 10, name: "A" }, { productId: b, quantity: qtyB, price: 10, name: "B" }] });
  return { a, b, orderId };
};

test("customer cancels own Pending order: stock restored exactly once, repeat cancel changes nothing", async () => {
  const { a, b, orderId } = seed("Pending", 2, 1);
  const first = await cancelAsCustomer(orderId);
  assert.equal(first.statusCode, 200); assert.equal(first.body.status, "Cancelled");
  assert.equal(fake.stockOf(a), 12); assert.equal(fake.stockOf(b), 5);
  assert.ok(fake.db.orders[0].stockRestoredAt && fake.db.orders[0].cancelledAt);

  const again = await cancelAsCustomer(orderId);
  assert.equal(again.statusCode, 400); assert.match(again.body.message, /already cancelled/i);
  assert.equal(fake.stockOf(a), 12); assert.equal(fake.stockOf(b), 5);
});

test("customer cannot cancel once Processing/Shipped/Delivered; stock untouched", async () => {
  for (const status of ["Processing", "Shipped", "Delivered"]) {
    const { a, orderId } = seed(status);
    const res = await cancelAsCustomer(orderId);
    assert.equal(res.statusCode, 400); assert.match(res.body.message, new RegExp(status));
    assert.equal(fake.stockOf(a), 10); assert.equal(fake.db.orders[0].status, status);
  }
});

test("customer cannot cancel someone else's order or a malformed id (404, stock untouched)", async () => {
  const { a, orderId } = seed();
  assert.equal((await cancelAsCustomer(orderId, { _id: "9".repeat(24) })).statusCode, 404);
  assert.equal((await cancelAsCustomer("not-an-id")).statusCode, 404);
  assert.equal(fake.stockOf(a), 10); assert.equal(fake.db.orders[0].status, "Pending");
});

test("concurrent double-cancel: exactly one succeeds, stock restored once", async () => {
  const { a, orderId } = seed("Pending", 3, 1);
  const results = await Promise.all([cancelAsCustomer(orderId), cancelAsCustomer(orderId), adminSet(orderId, "Cancelled")]);
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
  assert.equal(fake.stockOf(a), 13);
});

test("admin cancel: Pending, Processing and Shipped restock; Delivered/Cancelled do not and are rejected", async () => {
  for (const status of ["Pending", "Processing", "Shipped"]) {
    const { a, orderId } = seed(status, 2, 1);
    const res = await adminSet(orderId, "Cancelled");
    assert.equal(res.statusCode, 200, status); assert.equal(fake.stockOf(a), 12, status);
  }
  for (const status of ["Delivered", "Cancelled"]) {
    const { a, orderId } = seed(status);
    const res = await adminSet(orderId, "Cancelled");
    assert.equal(res.statusCode, 400, status); assert.equal(fake.stockOf(a), 10, status);
  }
});

test("admin cannot resurrect a cancelled order (Cancelled -> Pending/Processing/etc.) and stock never re-decrements", async () => {
  const { a, orderId } = seed("Pending", 2, 1);
  await adminSet(orderId, "Cancelled");
  for (const target of ["Pending", "Processing", "Shipped", "Delivered"]) {
    const res = await adminSet(orderId, target);
    assert.equal(res.statusCode, 400, target); assert.match(res.body.message, /cannot be changed/i);
  }
  assert.equal(fake.db.orders[0].status, "Cancelled"); assert.equal(fake.stockOf(a), 12);
});

test("admin forward transitions work; backward and same-status are rejected; invalid input is 4xx", async () => {
  const { orderId } = seed("Pending");
  assert.equal((await adminSet(orderId, "Processing")).statusCode, 200);
  assert.equal((await adminSet(orderId, "Pending")).statusCode, 400);
  assert.equal((await adminSet(orderId, "Processing")).statusCode, 400);
  assert.equal((await adminSet(orderId, "Shipped")).statusCode, 200);
  assert.equal((await adminSet(orderId, "Delivered")).statusCode, 200);
  assert.equal((await adminSet(orderId, "Shipped")).statusCode, 400);
  for (const bad of ["Bogus", "", undefined, null, 5, { $ne: 1 }, ["Pending"]]) {
    const res = await call(updateOrderStatus, { params: { id: orderId }, body: { status: bad } });
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
  }
  assert.equal((await adminSet("nope", "Processing")).statusCode, 404);
  assert.equal((await adminSet("1".repeat(24), "Processing")).statusCode, 404);
});

test("cancelling an order whose product was deleted does not fail", async () => {
  const { a, orderId } = seed("Pending", 2, 1);
  fake.db.products = fake.db.products.filter((p) => p._id === a);
  const res = await adminSet(orderId, "Cancelled");
  assert.equal(res.statusCode, 200); assert.equal(fake.stockOf(a), 12);
});
