const test = require("node:test");
const assert = require("node:assert/strict");
const v = require("../utils/validators");

test("Nepal phone: accepted formats normalize to +977 E.164", () => {
  const ok = ["9812345678", "98 1234 5678", "98-12345678", "+977 9812345678", "+9779812345678",
    "9779812345678", "009779812345678", "9741234567", "9612345678", "9861234567"];
  for (const input of ok) {
    const r = v.normalizeNepalMobile(input);
    assert.ok(r.value, `${input} should be accepted`);
    assert.match(r.value, /^\+9779[6-8]\d{8}$/);
  }
  assert.equal(v.normalizeNepalMobile("98 1234 5678").value, "+9779812345678");
  assert.equal(v.normalizeNepalMobile("009779812345678").value, "+9779812345678");
});

test("Nepal phone: junk, wrong country, landline, wrong length rejected", () => {
  const bad = ["1234567890", "abc", "", "98123", "981234567890123", "+919812345678", "+14155552671",
    "0981234567", "9912345678", "9500000000", "9800000000", "9811111111", "01-4123456", "98123456a8",
    "+977 12345678"];
  for (const input of bad) assert.ok(v.normalizeNepalMobile(input).error, `${JSON.stringify(input)} should be rejected`);
  for (const nonString of [undefined, null, 9812345678, {}, [], ["9812345678"]]) {
    assert.ok(v.normalizeNepalMobile(nonString).error, "non-string must be a clean error, not a throw");
  }
});

test("Name: real names incl. Devanagari accepted", () => {
  for (const n of ["Ram Bahadur Thapa", "Sita Kumari", "Om", "Anil K. Shrestha", "O'Neil", "Jean-Luc",
    "राम बहादुर", "सीता कुमारी थापा", "  Ram   Thapa  "]) {
    assert.ok(v.validateCustomerName(n).value, `${n} should be accepted`);
  }
  assert.equal(v.validateCustomerName("  Ram   Thapa  ").value, "Ram Thapa");
});

test("Name: placeholders, digits, symbols, empty, wrong types rejected", () => {
  for (const n of ["", " ", "a", "abc", "123", "aaaa", "test", "Test", "asdf", "xxxx", "test test",
    "Ram123", "<script>", "R@m", "x".repeat(81)]) {
    assert.ok(v.validateCustomerName(n).error, `${JSON.stringify(n)} should be rejected`);
  }
  for (const n of [undefined, null, 5, {}, [], ["Ram"]]) assert.ok(v.validateCustomerName(n).error);
});

test("Address: meaningful addresses accepted", () => {
  for (const a of ["Aawaroad, opposite of Lumbini Bikas Bank, Siddharthanagar", "Butwal-11, near Traffic Chowk",
    "Siddharthanagar-8 Tilottama", "वडा नं ५, सिद्धार्थनगर, रुपन्देही"]) {
    assert.ok(v.validateAddress(a).value, `${a} should be accepted`);
  }
});

test("Address: junk rejected", () => {
  for (const a of ["", "   ", "test", "abc", "123", "1234567890", "random address", "aaaaaaaaaaaa", "..........",
    "Butwal", "x", "<b>Butwal ward 5</b>", "a".repeat(301), "asdf", "n/a"]) {
    assert.ok(v.validateAddress(a).error, `${JSON.stringify(a)} should be rejected`);
  }
  for (const a of [undefined, null, 5, {}, ["Butwal ward 5"]]) assert.ok(v.validateAddress(a).error);
});

test("Country: only Nepal; omitted defaults to Nepal", () => {
  assert.equal(v.validateCountry(undefined).value, "Nepal");
  assert.equal(v.validateCountry("nepal").value, "Nepal");
  assert.equal(v.validateCountry(" NP ").value, "Nepal");
  for (const c of ["India", "USA", "Nepal, India", "random", 5, {}]) assert.ok(v.validateCountry(c).error);
});

test("Payment method: allowlist only", () => {
  assert.equal(v.validatePaymentMethod("WhatsApp").value, "WhatsApp");
  assert.equal(v.validatePaymentMethod("whatsapp").value, "WhatsApp");
  assert.equal(v.validatePaymentMethod(undefined).value, "WhatsApp");
  for (const p of ["esewa", "Bitcoin", "x".repeat(1000), 5, {}]) assert.ok(v.validatePaymentMethod(p).error);
});

test("Idempotency key: optional unless required, strict format", () => {
  assert.equal(v.validateIdempotencyKey(undefined).value, undefined);
  assert.ok(v.validateIdempotencyKey(undefined, { required: true }).error);
  assert.ok(v.validateIdempotencyKey("3f2b8c1e-9d4a-4f6b-8a1c-2e5d7b9c0a11").value);
  for (const k of ["short", "has spaces in the key 1234567890", "x".repeat(65), 12345678901234567, {}]) {
    assert.ok(v.validateIdempotencyKey(k).error);
  }
});

test("Guest items: shape validated, duplicates merged, caps enforced", () => {
  const id = "64f0c0ffee0c0ffee0c0ffee";
  assert.deepEqual(v.validateGuestItems([{ productId: id, quantity: 2 }, { productId: id, quantity: 3 }]).items,
    [{ productId: id, quantity: 5 }]);
  for (const bad of [undefined, [], "x", [null], [{ productId: "nope", quantity: 1 }], [{ productId: id, quantity: 0 }],
    [{ productId: id, quantity: 1.5 }], [{ productId: id, quantity: "2" }], [{ productId: id, quantity: -1 }],
    [{ productId: { $ne: null }, quantity: 1 }], [{ productId: id, quantity: 60 }, { productId: id, quantity: 60 }],
    Array.from({ length: 51 }, (_, i) => ({ productId: (i.toString(16).padStart(24, "0")), quantity: 1 }))]) {
    assert.ok(v.validateGuestItems(bad).error, `${String(JSON.stringify(bad)).slice(0, 60)} should be rejected`);
  }
});

test("Checkout body: valid guest + logged-in bodies pass; client price/total/fee are ignored", () => {
  const id = "64f0c0ffee0c0ffee0c0ffee";
  const guest = v.validateCheckoutBody({
    customerName: "Ram Thapa", customerPhone: "9812345678", customerAddress: "Aawaroad, Siddharthanagar",
    paymentMethod: "WhatsApp", items: [{ productId: id, quantity: 1, price: 1, name: "hacked" }],
    price: 1, total: 1, totalAmount: 1, deliveryFee: 0, stockQuantity: 9999,
  }, { isGuest: true });
  assert.ok(guest.value, JSON.stringify(guest.errors));
  assert.deepEqual(Object.keys(guest.value).sort(),
    ["country", "customerAddress", "customerName", "customerPhone", "idempotencyKey", "items", "paymentMethod"]);
  assert.deepEqual(guest.value.items, [{ productId: id, quantity: 1 }]); // price/name stripped
  assert.equal(guest.value.customerPhone, "+9779812345678");

  const loggedIn = v.validateCheckoutBody({ customerName: "Sita Kumari", customerPhone: "+977 9861234567",
    customerAddress: "Butwal-11, near Traffic Chowk" }, { isGuest: false });
  assert.ok(loggedIn.value && !("items" in loggedIn.value));
});

test("Checkout body: reports every bad field; malformed bodies never throw", () => {
  const r = v.validateCheckoutBody({ customerName: "abc", customerPhone: "1234567890", customerAddress: "test",
    country: "India", paymentMethod: "Bitcoin" }, { isGuest: false });
  assert.deepEqual(Object.keys(r.errors).sort(), ["country", "customerAddress", "customerName", "customerPhone", "paymentMethod"]);
  for (const body of [null, undefined, "str", 5, [], { customerName: {}, customerPhone: [], customerAddress: 5 }]) {
    assert.doesNotThrow(() => v.validateCheckoutBody(body, { isGuest: true }));
    assert.ok(v.validateCheckoutBody(body, { isGuest: true }).errors);
  }
});

test("Fingerprint: same intent = same hash; any change = different hash", () => {
  const base = { customerName: "Ram Thapa", customerPhone: "+9779812345678", customerAddress: "Aawaroad, Siddharthanagar",
    country: "Nepal", paymentMethod: "WhatsApp", items: [{ productId: "a".repeat(24), quantity: 1 }] };
  const h = v.buildRequestFingerprint(base);
  assert.equal(h, v.buildRequestFingerprint({ ...base }));
  assert.notEqual(h, v.buildRequestFingerprint({ ...base, customerPhone: "+9779812345679" }));
  assert.notEqual(h, v.buildRequestFingerprint({ ...base, items: [{ productId: "a".repeat(24), quantity: 2 }] }));
});
