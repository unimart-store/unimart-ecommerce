const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createStorefront, makeEl, read } = require("./frontend-harness");

const FRONT = path.join(__dirname, "..", "frontend");
const html = fs.readFileSync(path.join(FRONT, "pages", "checkout.html"), "utf8");
const css = fs.readFileSync(path.join(FRONT, "css", "checkout.css"), "utf8").replace(/\r/g, "");
const js = read("checkout.js");

// ---------------- static guards: markup <-> script contract ----------------

test("every element id checkout.js looks up exists in checkout.html (except the ones it creates itself)", () => {
  const ids = new Set([...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]));
  ["checkoutBtn", "mobileCheckoutBtn"].forEach((i) => ids.add(i)); // looked up via an id list
  const createdByScript = new Set(["sendWhatsappBtn", "confirmTitle"]);
  const missing = [...ids].filter((id) => !createdByScript.has(id) && !new RegExp(`id="${id}"`).test(html));
  assert.deepEqual(missing, []);
  for (const sel of [".checkout-container", ".mobile-bottom-bar", ".checkout-header"]) {
    assert.ok(js.includes(`"${sel}"`), `${sel} is referenced`);
    assert.ok(new RegExp(`class="[^"]*${sel.slice(1)}[ "]`).test(html) || sel === ".checkout-container" && /<main class="checkout-container"/.test(html), `${sel} exists in the page`);
  }
});

test("every form control has a real <label for>, a usable autocomplete/type, and an error region linked by aria-describedby", () => {
  const controls = [...html.matchAll(/<(input|textarea|select)\b[^>]*\bid="([^"]+)"[^>]*>/g)].filter((m) => !/type="radio"/.test(m[0]));
  assert.ok(controls.length >= 4);
  for (const [tag, , id] of controls) {
    assert.ok(new RegExp(`<label[^>]*for="${id}"`).test(html), `label for ${id}`);
    assert.match(tag, /aria-describedby="/, `${id} has aria-describedby`);
  }
  assert.match(html, /id="userName"[^>]*autocomplete="name"/); assert.match(html, /id="userPhone"[^>]*type="tel"|type="tel"[^>]*id="userPhone"/);
  assert.match(html, /id="userPhone"[^>]*autocomplete="tel"/); assert.match(html, /id="userAddress"[^>]*autocomplete="street-address"/);
  assert.match(html, /<select id="deliveryArea" required/);
  for (const id of ["errorName", "errorPhone", "errorAddress", "errorArea"]) assert.match(html, new RegExp(`id="${id}" role="alert"`));
});

test("no fake / unavailable payment options anywhere (markup or script)", () => {
  for (const source of [html, js]) assert.doesNotMatch(source, /esewa|coming soon|service unavailable|khalti|disabled\s*\/?>\s*<span class="pay/i);
  assert.equal((html.match(/name="payment"/g) || []).length, 1, "only the built-in WhatsApp fallback exists in the markup");
  assert.doesNotMatch(html, /name="payment"[^>]*disabled/);
});

test("exactly one place-order button per surface; page structure is semantic", () => {
  assert.equal((html.match(/id="checkoutBtn"/g) || []).length, 1); assert.equal((html.match(/id="mobileCheckoutBtn"/g) || []).length, 1);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /<header class="checkout-header"/); assert.match(html, /<main class="checkout-container"/); assert.match(html, /<aside class="checkout-right" aria-label="Order summary"/);
  assert.match(html, /role="radiogroup"/); assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /₹|INR|Rs\./);
});

test("checkout.css: mobile-first breakpoints, safe-area, focus, reduced-motion, no overflow traps", () => {
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, "balanced braces");
  assert.match(css, /@media \(min-width: 640px\)/); assert.match(css, /@media \(min-width: 900px\)/);
  assert.doesNotMatch(css, /max-width:\s*(?:36\d|39\d|41\d)px/, "no device-specific hacks");
  assert.match(css, /env\(safe-area-inset-bottom\)/); assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/); assert.match(css, /\.mobile-bottom-bar\s*{[^}]*position:\s*fixed/);
  assert.match(css, /\.co-input,\s*\n\.co-select select\s*{[^}]*font-size:\s*16px/, "16px inputs (no iOS zoom)");
  assert.match(css, /\.checkout-container \.order-confirmation\s*{[^}]*grid-column:\s*1 \/ -1/);
  assert.match(css, /minmax\(0,\s*1fr\)/, "grid tracks can shrink (no horizontal overflow at 360px)");
  assert.equal((css.match(/!important/g) || []).length, 1, "the only !important is the [hidden] rule");
  assert.match(css, /\[hidden\]\s*{\s*display:\s*none !important/);
  assert.doesNotMatch(css, /₹|INR/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|animation:[ \t]+(?!co-spin)/, "no decorative gradients/animations");
  const desktop = css.slice(css.indexOf("@media (min-width: 900px)"));
  assert.match(desktop, /\.mobile-bottom-bar\s*{\s*display:\s*none/); assert.match(desktop, /\.co-summary-card \.co-btn\s*{[^}]*display:\s*inline-flex/);
});

// ---- WCAG contrast computed from the REAL values in the stylesheet ----
const lum = (hex) => { const [r, g, b] = hex.replace("#", "").match(/../g).map((v) => { const c = parseInt(v, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const token = (name) => (css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];
const buttonText = (css.match(/\.co-btn--primary\s*{[^}]*?\bcolor:\s*(#[0-9a-fA-F]{6})/) || [])[1]; // read from the real rule

test("colour contrast meets WCAG AA for every text/control pair used", () => {
  const WHITE = "#ffffff", BG = token("co-bg"), MUTED = token("co-muted"), ACCENT = "#f59e0b", ACCENT_HOVER = "#d97706";
  const pairs = [
    ["body text on white", "#212121", WHITE, 4.5], ["muted text on white", MUTED, WHITE, 4.5], ["muted text on page background", MUTED, BG, 4.5],
    ["placeholder on white", "#6b7078", WHITE, 4.5], ["primary button text on amber", buttonText, ACCENT, 4.5], ["primary button text on amber (hover)", buttonText, ACCENT_HOVER, 4.5],
    ["accent link/focus on white", token("co-accent-strong"), WHITE, 4.5], ["accent text on soft accent", token("co-accent-strong"), token("co-accent-soft"), 4.5],
    ["error text on white", token("co-error"), WHITE, 4.5], ["error text on error background", token("co-error"), token("co-error-soft"), 4.5],
    ["notice text on notice background", "#7a4a00", token("co-accent-soft"), 4.5], ["success text on white", "#1a7f37", WHITE, 4.5],
    ["input border vs white (non-text 3:1)", token("co-control"), WHITE, 3], ["selected option border vs its background (3:1)", token("co-accent-strong"), token("co-accent-soft"), 3],
  ];
  for (const [name, fg, bg, min] of pairs) {
    assert.ok(fg && bg, `${name}: colour value found in the stylesheet`);
    assert.ok(ratio(fg, bg) >= min, `${name}: ${ratio(fg, bg).toFixed(2)} < ${min}`);
  }
  assert.ok(ratio("#ffffff", ACCENT) < 4.5, "documents WHY buttons use dark text: white on amber fails AA");
});

// ---------------- behaviour ----------------

const AREAS = [
  { id: "aaaaaaaa11", name: "Siddharthanagar", type: "local", available: true, minOrder: null, message: "" },
  { id: "bbbbbbbb22", name: "Kathmandu", type: "paid", available: true, minOrder: null, message: "" },
  { id: "dddddddd44", name: "Remote Valley", type: "unsupported", available: false, minOrder: null, message: "We cannot deliver to Remote Valley yet." },
];
const serverQuote = ({ areaId }) => {
  if (!areaId) return { deliverable: false, code: "AREA_REQUIRED", message: "Please select your delivery area.", subtotal: 450 };
  if (areaId === "dddddddd44") return { deliverable: false, code: "AREA_UNSUPPORTED", message: "We cannot deliver to Remote Valley yet.", subtotal: 450 };
  if (areaId === "aaaaaaaa11") return { deliverable: true, subtotal: 450, delivery: { mode: "local", fee: 0, areaName: "Siddharthanagar" }, total: 450 };
  return { deliverable: true, subtotal: 450, delivery: { mode: "paid", fee: 80, areaName: "Kathmandu" }, total: 530 };
};

const boot = async ({ settings, items, quote = serverQuote } = {}) => {
  const sf = createStorefront({});
  const container = makeEl("container"), paymentOptions = makeEl("paymentOptions"), header = makeEl("header"), bar = makeEl("bar");
  sf.sandbox.UniMartConfig = { getPath: (p) => "https://site/" + p, formatPrice: (n) => "NPR " + Number(n).toLocaleString("en-IN"), getWhatsAppUrl: () => "https://wa.me/1" };
  sf.sandbox.CartState = { getItems: async () => items || [{ productId: "p1", name: "Toy", price: 450, quantity: 1 }], clearLocalCartAfterOrder() {} };
  const base = { delivery: { enabled: true, areas: AREAS }, payment: { methods: [{ code: "whatsapp", label: "WhatsApp" }] } };
  sf.sandbox.SiteSettings = { load: async () => (settings === undefined ? base : settings) };
  sf.sandbox.window.SiteSettings = sf.sandbox.SiteSettings;
  sf.sandbox.DeliveryService = { quote: async (r) => quote(r) }; sf.sandbox.window.DeliveryService = sf.sandbox.DeliveryService;
  sf.sandbox.document.createElement = (tag) => { const e = makeEl(tag); e.tagName = tag.toUpperCase(); return e; };
  sf.sandbox.document.querySelector = (sel) => (sel === ".checkout-container" ? container : sel === ".checkout-header" ? header : sel === ".mobile-bottom-bar" ? bar : sel.includes(":checked") ? paymentOptions.children.map((l) => l.children[0]).find((i) => i && i.checked) || null : null);
  ["userName", "userPhone", "userAddress", "errorName", "errorPhone", "errorAddress", "checkoutBtn", "mobileCheckoutBtn", "orderOverlay", "priceSummary", "mobileTotalAmount", "deliveryAreaBox", "deliveryArea", "errorArea", "areaHint", "deliveryNotice"].forEach((id) => sf.getEl(id));
  sf.els.paymentOptions = paymentOptions; sf.container = container; sf.header = header; sf.bar = bar;
  sf.getEl("userName").value = "Ram Bahadur Thapa"; sf.getEl("userPhone").value = "9812345678"; sf.getEl("userAddress").value = "Aawaroad, opposite Lumbini Bikas Bank, Siddharthanagar";
  vm.runInContext(read("checkout.js"), sf.sandbox, { filename: "checkout.js" });
  sf.placed = []; sf.sandbox.CheckoutService.placeOrder = async (c, i, k) => { sf.placed.push(c); return sf.orderResult || { _id: "o", orderId: "ORD-5", subtotal: 450, deliveryFee: 80, deliveryType: "paid", deliveryArea: "Kathmandu", totalAmount: 530 }; };
  await sf.state.domReady();
  sf.chooseArea = async (id) => { sf.getEl("deliveryArea").value = id; await sf.getEl("deliveryArea").fire("change"); };
  sf.summary = () => sf.getEl("priceSummary").innerHTML;
  return sf;
};

test("summary: label and value are separate cells; 'Subtotal / Delivery / Total' like the spec; item count pluralised", async () => {
  let sf = await boot({ settings: { delivery: { enabled: true, areas: [] }, payment: { methods: [{ code: "whatsapp", label: "WhatsApp" }] } } });
  assert.match(sf.summary(), /<dt>Subtotal<span class="co-sub">1 item<\/span><\/dt><dd>NPR 450<\/dd>/);
  assert.match(sf.summary(), /<dt>Delivery<\/dt><dd><span class="co-value--tbc">To be confirmed<\/span><\/dd>/);
  assert.match(sf.summary(), /<dt>Total<span class="co-sub">excl\. delivery<\/span><\/dt><dd>NPR 450<\/dd>/);
  assert.doesNotMatch(sf.summary(), /Price \(|Items Total|Delivery Charges|summary-line/);
  sf = await boot({ items: [{ productId: "a", price: 100, quantity: 1 }, { productId: "b", price: 350, quantity: 1 }] });
  assert.match(sf.summary(), /2 items/);
  await sf.chooseArea("bbbbbbbb22");
  assert.match(sf.summary(), /<dt>Subtotal<span class="co-sub">2 items<\/span><\/dt><dd>NPR 450<\/dd>/);
  assert.match(sf.summary(), /<dt>Delivery<span class="co-sub">Kathmandu<\/span><\/dt><dd>NPR 80<\/dd>/);
  assert.match(sf.summary(), /<dt>Total<\/dt><dd>NPR 530<\/dd>/); assert.doesNotMatch(sf.summary(), /excl\. delivery/);
  assert.equal(sf.getEl("mobileTotalAmount").textContent, "NPR 530");
});

test("payment: only what the backend enables is shown - a WhatsApp-only backend renders exactly one option, nothing else", async () => {
  const sf = await boot();
  const options = sf.els.paymentOptions.children;
  assert.equal(options.length, 1);
  const [input, card] = options[0].children;
  assert.deepEqual([input.dataset.method, input.checked, input.type, options[0].className], ["WhatsApp", true, "radio", "pay-option"]);
  assert.equal(card.className, "pay-card"); assert.doesNotMatch(JSON.stringify(sf.els.paymentOptions.children.map((c) => c.textContent)), /esewa|coming soon/i);
  assert.equal(sf.getEl("checkoutBtn").disabled, false);
});

test("payment: no method enabled -> clear message, no invented option, ordering blocked", async () => {
  for (const methods of [[], [{ code: "someFutureMethod", label: "Future" }]]) {
    const sf = await boot({ settings: { delivery: { enabled: true, areas: [] }, payment: { methods } } });
    const kids = sf.els.paymentOptions.children;
    assert.equal(kids.length, 1); assert.match(kids[0].textContent, /No payment method is available/); assert.match(kids[0].className, /co-notice/);
    assert.equal(sf.getEl("checkoutBtn").disabled, true); assert.equal(sf.getEl("mobileCheckoutBtn").disabled, true);
    await sf.getEl("checkoutBtn").click(); assert.equal(sf.placed.length, 0);
  }
});

test("payment: settings unavailable -> the built-in WhatsApp markup is left untouched and ordering still works", async () => {
  const sf = await boot({ settings: null });
  assert.equal(sf.els.paymentOptions.children.length, 0, "script did not touch the container");
  assert.equal(sf.getEl("checkoutBtn").disabled, false);
});

test("area picker: server-calculated fee shown next to the select; unsupported shows the message, not a fee", async () => {
  const sf = await boot();
  await sf.chooseArea("aaaaaaaa11"); assert.equal(sf.getEl("areaHint").textContent, "Free delivery to Siddharthanagar");
  await sf.chooseArea("bbbbbbbb22"); assert.equal(sf.getEl("areaHint").textContent, "Delivery to Kathmandu: NPR 80");
  await sf.chooseArea("dddddddd44");
  assert.equal(sf.getEl("areaHint").textContent, ""); assert.equal(sf.getEl("errorArea").textContent, "We cannot deliver to Remote Valley yet.");
  assert.equal(sf.getEl("deliveryArea").getAttribute("aria-invalid"), "true");
  await sf.chooseArea("bbbbbbbb22"); assert.equal(sf.getEl("deliveryArea").getAttribute("aria-invalid"), null);
  const noAreas = await boot({ settings: { delivery: { enabled: true, areas: [] }, payment: { methods: [{ code: "whatsapp", label: "WhatsApp" }] } } });
  assert.equal(noAreas.getEl("deliveryAreaBox").hidden, true); assert.equal(noAreas.getEl("areaHint").textContent, "");
});

test("validation errors set aria-invalid (not colour alone) and clear when the customer edits", async () => {
  const sf = await boot();
  sf.getEl("userName").value = ""; sf.getEl("userPhone").value = "123"; sf.getEl("userAddress").value = "x";
  await sf.getEl("checkoutBtn").click();
  for (const id of ["userName", "userPhone", "userAddress"]) assert.equal(sf.getEl(id).getAttribute("aria-invalid"), "true", id);
  assert.match(sf.getEl("errorPhone").textContent, /valid Nepal mobile/);
  await sf.getEl("userName").fire("input");
  assert.equal(sf.getEl("userName").getAttribute("aria-invalid"), null); assert.equal(sf.getEl("userPhone").getAttribute("aria-invalid"), "true");
  assert.equal(sf.placed.length, 0);
});

test("success: header and sticky bar hidden, title focused for screen readers, breakdown uses the summary component, actions styled", async () => {
  const sf = await boot(); let focused = false; sf.getEl("confirmTitle").focus = () => { focused = true; };
  await sf.chooseArea("bbbbbbbb22"); await sf.getEl("checkoutBtn").click();
  assert.equal(sf.header.style.display, "none"); assert.equal(sf.bar.style.display, "none"); assert.equal(focused, true);
  const out = sf.container.innerHTML;
  assert.match(out, /class="confirm-icon" aria-hidden="true"[\s\S]*<svg/); assert.doesNotMatch(out, /✅/);
  assert.match(out, /confirm-id">Order ID <strong>ORD-5<\/strong>/); assert.match(out, /<dt>Total<\/dt><dd>NPR 530<\/dd>/);
  assert.match(out, /id="sendWhatsappBtn" class="co-btn co-btn--primary"/); assert.match(out, /co-btn co-btn--secondary">Continue Shopping/);
  assert.doesNotMatch(out, /btn-continue|shop-now-btn|undefined|₹|INR/);
});

test("success (delivery to be confirmed): says so and marks the total as excluding delivery", async () => {
  const sf = await boot({ settings: { delivery: { enabled: true, areas: [] }, payment: { methods: [{ code: "whatsapp", label: "WhatsApp" }] } } });
  sf.orderResult = { _id: "o", orderId: "ORD-6", subtotal: 450, deliveryFee: 0, deliveryType: "manual", totalAmount: 450 };
  await sf.getEl("checkoutBtn").click();
  assert.match(sf.container.innerHTML, /co-value--tbc">To be confirmed/); assert.match(sf.container.innerHTML, /<dt>Total<span class="co-sub">excl\. delivery<\/span><\/dt>/);
});

test("checkout.css: every custom property it uses is defined (locally or in the shared tokens)", () => {
  const tokens = fs.readFileSync(path.join(FRONT, "css", "tokens.css"), "utf8");
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g), ...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(used.filter((n) => !defined.has(n)))], []);
  assert.match(html, /css\/tokens\.css/, "shared tokens are loaded before checkout.css");
  assert.ok(html.indexOf("tokens.css") < html.indexOf("checkout.css"));
});
