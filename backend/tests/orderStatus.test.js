const test = require("node:test");
const assert = require("node:assert/strict");
const s = require("../utils/orderStatus");

test("forward transitions allowed (admin may skip steps)", () => {
  for (const [a, b] of [["Pending", "Processing"], ["Pending", "Delivered"], ["Processing", "Shipped"], ["Shipped", "Delivered"]]) {
    assert.equal(s.isLegalTransition(a, b), true, `${a}->${b}`);
  }
});

test("backward moves and leaving final states are rejected", () => {
  for (const [a, b] of [["Cancelled", "Pending"], ["Cancelled", "Processing"], ["Cancelled", "Delivered"], ["Delivered", "Pending"],
    ["Delivered", "Cancelled"], ["Shipped", "Pending"], ["Processing", "Pending"], ["Pending", "Pending"], ["Cancelled", "Cancelled"],
    ["Pending", "Bogus"], ["Bogus", "Pending"]]) {
    assert.equal(s.isLegalTransition(a, b), false, `${a}->${b}`);
  }
});

test("cancellable sets", () => {
  assert.deepEqual([...s.CUSTOMER_CANCELLABLE_FROM], ["Pending"]);
  assert.deepEqual([...s.ADMIN_CANCELLABLE_FROM].sort(), ["Pending", "Processing", "Shipped"]);
});

test("restock ops: one $inc per valid line, junk lines skipped", () => {
  const ops = s.buildRestockOps([{ productId: "p1", quantity: 2 }, { productId: "p2", quantity: 1 },
    { quantity: 3 }, { productId: "p3", quantity: 0 }, null, { productId: "p4", quantity: 1.5 }]);
  assert.deepEqual(ops, [
    { updateOne: { filter: { _id: "p1" }, update: { $inc: { stockQuantity: 2 } } } },
    { updateOne: { filter: { _id: "p2" }, update: { $inc: { stockQuantity: 1 } } } },
  ]);
  assert.deepEqual(s.buildRestockOps(undefined), []);
});
