const test = require("node:test");
const assert = require("node:assert/strict");
const { createStorefront } = require("./frontend-harness");

const P = { _id: "p1", name: "Blue Toy", price: 250, status: "active", stockQuantity: 5 };

// Loads the REAL cartState.js + product.js against stubbed browser globals.
const boot = async (opts = {}) => {
  const sf = createStorefront({ search: "?id=p1", products: { p1: { ...P, ...(opts.product || {}) } }, ...opts });
  // CartState uses these two globals
  sf.load("state/cartState.js");
  sf.sandbox.CartState = sf.run("CartState");
  sf.sandbox.UniMartConfig = { getPath: (p) => "https://site/" + p, formatPrice: (n) => "NPR " + n, getWhatsAppUrl: (t) => "https://wa.me/x?text=" + encodeURIComponent(t) };
  sf.load("product.js");
  await sf.state.domReady();
  return sf;
};
const btn = (sf) => sf.getEl("btnCart");

test("guest, NOT in cart: shows Add to Cart; qty picker visible", async () => {
  const sf = await boot();
  assert.equal(btn(sf).textContent, "Add to Cart"); assert.equal(btn(sf).disabled, false);
  assert.equal(sf.getEl("qtySelector").classList.contains("hidden"), false);
});

test("guest, ALREADY in cart: shows Go to Cart (regression for the reported bug); qty picker hidden", async () => {
  const sf = await boot({ guestCart: [{ productId: "p1", name: "Blue Toy", price: 250, quantity: 2 }] });
  assert.equal(btn(sf).textContent, "Go to Cart"); assert.equal(btn(sf).disabled, false);
  assert.equal(sf.getEl("qtySelector").classList.contains("hidden"), true);
});

test("guest, in cart: clicking navigates to the cart and does NOT add another unit", async () => {
  const sf = await boot({ guestCart: [{ productId: "p1", name: "Blue Toy", price: 250, quantity: 2 }] });
  await btn(sf).click();
  assert.deepEqual(sf.nav, ["https://site/pages/cart.html"]);
  assert.equal(JSON.parse(sf.storage.get("unimart_guest_cart"))[0].quantity, 2, "quantity must be unchanged");
});

test("guest: Add -> button becomes Go to Cart from REAL cart state; second click only navigates", async () => {
  const sf = await boot();
  await btn(sf).click();
  assert.equal(btn(sf).textContent, "Go to Cart");
  assert.equal(JSON.parse(sf.storage.get("unimart_guest_cart"))[0].quantity, 1);
  await btn(sf).click(); await btn(sf).click();
  assert.equal(JSON.parse(sf.storage.get("unimart_guest_cart"))[0].quantity, 1, "still exactly 1");
  assert.equal(sf.nav.length, 2);
});

test("logged-in, ALREADY in server cart: Go to Cart even though AuthState resolves slowly (auth race)", async () => {
  const sf = await boot({ loggedIn: true, authDelayMs: 60, serverCart: [{ product: { ...P }, quantity: 3 }] });
  assert.equal(btn(sf).textContent, "Go to Cart");
  assert.equal(sf.calls.getCart, 1, "server cart was consulted (not the empty guest cart)");
});

test("logged-in, in cart: click navigates and sends NO add request (no accidental +1)", async () => {
  const sf = await boot({ loggedIn: true, authDelayMs: 20, serverCart: [{ product: { ...P }, quantity: 3 }] });
  await btn(sf).click();
  assert.deepEqual(sf.calls.addItem, []);
  assert.equal(sf.server.cart[0].quantity, 3);
  assert.deepEqual(sf.nav, ["https://site/pages/cart.html"]);
});

test("logged-in, NOT in cart: Add to Cart, then Go to Cart after adding; exactly one add request", async () => {
  const sf = await boot({ loggedIn: true, authDelayMs: 10 });
  assert.equal(btn(sf).textContent, "Add to Cart");
  await btn(sf).click();
  assert.equal(btn(sf).textContent, "Go to Cart");
  assert.deepEqual(sf.calls.addItem, [["p1", 1]]);
});

test("double-click on Add sends one request", async () => {
  const sf = await boot({ loggedIn: true });
  await Promise.all([btn(sf).click(), btn(sf).click(), btn(sf).click()]);
  assert.equal(sf.calls.addItem.length, 1);
});

test("inactive product: Unavailable/disabled; out of stock: Out of Stock/disabled; neither can add", async () => {
  let sf = await boot({ product: { status: "inactive" } });
  assert.equal(btn(sf).textContent, "Unavailable"); assert.equal(btn(sf).disabled, true);
  await btn(sf).click(); assert.equal(sf.storage.get("unimart_guest_cart"), undefined);
  sf = await boot({ product: { stockQuantity: 0 } });
  assert.equal(btn(sf).textContent, "Out of Stock"); assert.equal(btn(sf).disabled, true);
});

test("product already in cart but now out of stock/inactive still shows Go to Cart (so it can be reviewed/removed)", async () => {
  const sf = await boot({ product: { stockQuantity: 0, status: "inactive" }, guestCart: [{ productId: "p1", quantity: 1 }] });
  assert.equal(btn(sf).textContent, "Go to Cart"); assert.equal(btn(sf).disabled, false);
});

test("stock limit: qty picker stops at stock; guest cart refuses to exceed stock", async () => {
  const sf = await boot({ product: { stockQuantity: 2 } });
  const plus = sf.getEl("qtyPlus");
  await plus.click(); await plus.click(); await plus.click();
  assert.equal(sf.getEl("qtyValue").textContent, 2);
  assert.equal(plus.disabled, true);
  await btn(sf).click();
  assert.equal(JSON.parse(sf.storage.get("unimart_guest_cart"))[0].quantity, 2);
});

test("stock limit enforced by CartState itself for guests (not only by the picker)", async () => {
  const sf = createStorefront({});
  sf.load("state/cartState.js");
  const CartState = sf.run("CartState");
  await CartState.addItem({ _id: "p9", name: "X", price: 1, stockQuantity: 3 }, 3);
  // CartState throws plain {message} objects (same convention as ApiClient), so match on .message
  const msg = (re) => (e) => re.test(e.message);
  await assert.rejects(CartState.addItem({ _id: "p9", name: "X", price: 1, stockQuantity: 3 }, 1), msg(/Only 3 in stock/));
  await assert.rejects(CartState.addItem({ _id: "p8", name: "X", price: 1, stockQuantity: 0 }, 1), msg(/out of stock/));
  await assert.rejects(CartState.updateQuantity("p9", 4), msg(/Only 3 in stock/));
  await CartState.updateQuantity("p9", 2); // lowering is fine
});

test("server rejection (stock) surfaces as a message and leaves the button usable", async () => {
  const sf = await boot({ loggedIn: true, product: { stockQuantity: 5 } });
  sf.sandbox.CartService.addItem = async () => { throw { message: "Only 1 in stock" }; };
  await btn(sf).click();
  assert.deepEqual(sf.toasts.at(-1), "Only 1 in stock");
  assert.equal(btn(sf).textContent, "Add to Cart"); assert.equal(btn(sf).disabled, false);
});

test("cart unreadable: falls back to Add to Cart without crashing the page", async () => {
  const sf = await boot({ loggedIn: true, cartFailure: true });
  assert.equal(btn(sf).textContent, "Add to Cart");
});

test("describeProductAction is pure and reusable (listing pages can call it too)", () => {
  const sf = createStorefront({}); sf.load("state/cartState.js");
  const CartState = sf.run("CartState");
  assert.equal(CartState.describeProductAction({ _id: "a", status: "active", stockQuantity: 500 }, []).maxQuantity, 99);
  assert.equal(CartState.describeProductAction({ _id: "a", status: "active", stockQuantity: 5 }, [{ productId: "a", quantity: 1 }]).state, "in-cart");
  assert.equal(CartState.describeProductAction({ _id: "a", status: "active" }, []).state, "unavailable"); // unknown stock is not sellable
});
