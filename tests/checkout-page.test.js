const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const { createStorefront, read } = require("./frontend-harness");

const FORM_IDS = ["userName", "userPhone", "userAddress", "errorName", "errorPhone", "errorAddress", "checkoutBtn", "mobileCheckoutBtn", "orderOverlay", "priceSummary", "mobileTotalAmount"];
const GOOD = { name: "Ram Bahadur Thapa", phone: "98 1234 5678", address: "Aawaroad, opposite Lumbini Bikas Bank, Siddharthanagar" };

// Loads the REAL config.js formatting helpers + checkout.js into the stub browser.
const boot = async (opts = {}) => {
  const sf = createStorefront({ orderResult: opts.orderResult, loggedIn: opts.loggedIn, sessionStorage: opts.sessionStorage });
  sf.sandbox.UniMartConfig = {
    getPath: (p) => "https://site/" + p, getWhatsAppUrl: (t) => "https://wa.me/9779700013011?text=" + encodeURIComponent(t),
    formatPrice: (n) => "NPR " + n,
  };
  sf.sandbox.CartState = {
    getItems: async () => opts.items || [{ productId: "p1", name: "Toy", price: 250, quantity: 2 }],
    clearLocalCartAfterOrder: opts.cleanupThrows ? () => { throw new Error("storage blocked"); } : () => { sf.cleared = true; },
    clearCart: async () => { throw new Error("must not be called after checkout"); },
  };
  sf.sandbox.document.querySelector = () => null;
  sf.sandbox.window.open = (url) => (sf.opened = url);
  FORM_IDS.forEach((id) => sf.getEl(id));
  sf.getEl("userName").value = GOOD.name; sf.getEl("userPhone").value = GOOD.phone; sf.getEl("userAddress").value = GOOD.address;
  sf.sandbox.document.querySelector = (sel) => (sel === ".checkout-container" ? (sf.container ||= sf.getEl("container")) : null);
  vm.runInContext(read("checkout.js"), sf.sandbox, { filename: "checkout.js" });
  await sf.state.domReady();
  sf.setForm = (v) => { sf.getEl("userName").value = v.name; sf.getEl("userPhone").value = v.phone; sf.getEl("userAddress").value = v.address; };
  sf.submit = () => sf.getEl("checkoutBtn").click();
  return sf;
};

test("summary shows subtotal only - no invented delivery fee or FREE claim", async () => {
  const sf = await boot({ items: [{ productId: "p1", price: 100, quantity: 1 }] });
  const html = sf.getEl("priceSummary").innerHTML;
  assert.match(html, /NPR 100/); assert.match(html, /To be confirmed/); assert.doesNotMatch(html, /FREE|40|₹|INR/);
  assert.equal(sf.getEl("mobileTotalAmount").textContent, "NPR 100");
});

test("invalid inputs are stopped in the browser: nothing is sent", async () => {
  const cases = [
    [{ ...GOOD, phone: "1234567890" }, "errorPhone"], [{ ...GOOD, phone: "+919812345678" }, "errorPhone"], [{ ...GOOD, phone: "" }, "errorPhone"],
    [{ ...GOOD, name: "" }, "errorName"], [{ ...GOOD, name: "12345" }, "errorName"], [{ ...GOOD, name: "a" }, "errorName"],
    [{ ...GOOD, address: "" }, "errorAddress"], [{ ...GOOD, address: "test" }, "errorAddress"], [{ ...GOOD, address: "123" }, "errorAddress"],
  ];
  for (const [values, errorId] of cases) {
    const sf = await boot(); const calls = [];
    sf.sandbox.CheckoutService.placeOrder = async (...a) => { calls.push(a); return {}; };
    sf.setForm(values); await sf.submit();
    assert.equal(calls.length, 0, JSON.stringify(values));
    assert.ok(sf.getEl(errorId).classList.contains("show"), `${errorId} for ${JSON.stringify(values)}`);
  }
});

test("valid Nepal number in every accepted format is normalized and sent", async () => {
  for (const phone of ["9812345678", "98-1234-5678", "+977 9812345678", "9779812345678", "009779812345678"]) {
    const sf = await boot(); const sent = [];
    sf.sandbox.CheckoutService.placeOrder = async (contact, items, key) => { sent.push({ contact, items, key }); return { _id: "o", orderId: "ORD-1", totalAmount: 500 }; };
    sf.setForm({ ...GOOD, phone }); await sf.submit();
    assert.equal(sent.length, 1, phone);
    assert.match(sent[0].key, /^[A-Za-z0-9-]{16,64}$/);
  }
});

test("guest sends items (no price/total); logged-in sends none", async () => {
  let sf = await boot(); let sent;
  sf.sandbox.CheckoutService.placeOrder = async (c, items) => { sent = { c, items }; return { _id: "o", orderId: "O", totalAmount: 1 }; };
  await sf.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(sent.items)), [{ productId: "p1", quantity: 2 }]); // JSON copy: objects come from another vm realm
  assert.deepEqual(Object.keys(sent.c).sort(), ["customerAddress", "customerName", "customerPhone", "paymentMethod"]);
  sf = await boot({ loggedIn: true }); sf.sandbox.CheckoutService.placeOrder = async (c, items) => { sent = { c, items }; return { _id: "o", orderId: "O", totalAmount: 1 }; };
  await sf.state.domReady; await sf.sandbox.AuthState.init(); await sf.submit();
  assert.equal(sent.items, undefined);
});

test("double-click sends ONE request", async () => {
  const sf = await boot(); let n = 0;
  sf.sandbox.CheckoutService.placeOrder = async () => { n++; await new Promise((r) => setTimeout(r, 20)); return { _id: "o", orderId: "O", totalAmount: 1 }; };
  await Promise.all([sf.submit(), sf.submit(), sf.getEl("mobileCheckoutBtn").click()]);
  assert.equal(n, 1);
});

test("NETWORK FAILURE then retry re-sends the SAME idempotency key (no duplicate order possible)", async () => {
  const sf = await boot(); const keys = [];
  let attempt = 0;
  sf.sandbox.CheckoutService.placeOrder = async (c, i, key) => { keys.push(key); if (++attempt === 1) throw { networkError: true, message: "Could not reach the server." }; return { _id: "o", orderId: "O", totalAmount: 1 }; };
  await sf.submit();
  assert.match(sf.toasts.at(-1), /won't create a duplicate/);
  assert.equal(sf.getEl("checkoutBtn").disabled, false, "button must be usable again");
  await sf.submit();
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
});

test("5xx (outcome unknown) keeps the key; page REFRESH + retry still reuses it", async () => {
  const sf = await boot(); const keys = [];
  sf.sandbox.CheckoutService.placeOrder = async (c, i, key) => { keys.push(key); throw { status: 500, message: "Request failed (500)" }; };
  await sf.submit();
  // "refresh": brand-new page state, but sessionStorage survives a reload
  const sf2 = await boot({ sessionStorage: sf.sandbox.sessionStorage }); // new page load, same browser tab storage
  sf2.sandbox.CheckoutService.placeOrder = async (c, i, key) => { keys.push(key); return { _id: "o", orderId: "O", totalAmount: 1 }; };
  await sf2.submit();
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
});

test("changing the cart or any contact field is a NEW intentional order = NEW key", async () => {
  const sf = await boot(); const keys = [];
  sf.sandbox.CheckoutService.placeOrder = async (c, i, key) => { keys.push(key); throw { networkError: true, message: "x" }; };
  await sf.submit();
  sf.setForm({ ...GOOD, address: "Butwal-11, near Traffic Chowk" }); await sf.submit();
  assert.notEqual(keys[0], keys[1]);
});

test("success: key cleared, confirmation shown, NPR total, and cleanup can never turn success into an error", async () => {
  const sf = await boot({ cleanupThrows: true }); const keys = [];
  sf.sandbox.CheckoutService.placeOrder = async (c, i, key) => { keys.push(key); return { _id: "o1", orderId: "ORD-77", totalAmount: 500 }; };
  await sf.submit();
  assert.equal(sf.toasts.length, 0, "no error toast even though cleanup threw");
  assert.match(sf.getEl("container").innerHTML, /ORD-77/); assert.match(sf.getEl("container").innerHTML, /NPR 500/);
  assert.doesNotMatch(sf.getEl("container").innerHTML, /₹|INR/);
  assert.equal(sf.sandbox.sessionStorage.getItem("unimart_checkout_attempt"), null);
  await sf.getEl("sendWhatsappBtn").click();
  assert.match(sf.opened, /^https:\/\/wa\.me\/9779700013011\?text=/); assert.match(decodeURIComponent(sf.opened), /ORD-77.*NPR 500/);
});

test("server field errors are shown next to the right input; 4xx does not claim 'unknown outcome'", async () => {
  const sf = await boot();
  sf.sandbox.CheckoutService.placeOrder = async () => { throw { status: 400, message: "Please enter your real name", body: { errors: { customerName: "Please enter your real name", customerAddress: "Please enter a real delivery address" } } }; };
  await sf.submit();
  assert.equal(sf.getEl("errorName").textContent, "Please enter your real name");
  assert.ok(sf.getEl("errorAddress").classList.contains("show"));
  assert.equal(sf.toasts.length, 0); assert.equal(sf.getEl("checkoutBtn").disabled, false);
});

test("stock conflict (409) shows the server message and allows retry", async () => {
  const sf = await boot();
  sf.sandbox.CheckoutService.placeOrder = async () => { throw { status: 409, message: 'Insufficient stock for "Toy"' }; };
  await sf.submit();
  assert.equal(sf.toasts.at(-1), 'Insufficient stock for "Toy"'); assert.equal(sf.getEl("checkoutBtn").disabled, false);
});

test("'same key, different details' (409) starts a fresh attempt next time", async () => {
  const sf = await boot(); const keys = [];
  let n = 0;
  sf.sandbox.CheckoutService.placeOrder = async (c, i, key) => { keys.push(key); if (++n === 1) throw { status: 409, message: "This order request was already used with different details." }; return { _id: "o", orderId: "O", totalAmount: 1 }; };
  await sf.submit(); await sf.submit();
  assert.notEqual(keys[0], keys[1]);
});
