const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const { createStorefront, makeEl, read } = require("./frontend-harness");

// ---------------- SiteInfo: public settings -> page ----------------

const loadSiteInfo = ({ whatsapp = "9779700013011" } = {}) => {
  const sf = createStorefront({});
  const cfg = { number: whatsapp, getWhatsAppUrl(t) { return this.number ? `https://wa.me/${this.number}${t ? "?text=" + encodeURIComponent(t) : ""}` : null; } };
  sf.sandbox.UniMartConfig = cfg; sf.sandbox.window.UniMartConfig = cfg;
  vm.runInContext(read("siteInfo.js"), sf.sandbox);
  return { sf, SiteInfo: vm.runInContext("SiteInfo", sf.sandbox), cfg };
};
const el = (site, extra = {}) => { const e = makeEl(site); e.dataset = { site, ...extra }; e.tagName = "A"; e.textContent = "BUILT-IN"; e.href = "https://builtin.example/"; return e; };
const row = () => ({ hidden: false, style: { display: "" } });
const baseSettings = () => ({
  business: { name: "UniMart", address: "New Address, Butwal", locationText: "Butwal", mapUrl: "https://maps.app.goo.gl/new1", phone: "+977 9800000001", whatsappNumber: "9779800000001", email: "shop@example.com" },
  social: { facebook: "https://www.facebook.com/x", instagram: "", tiktok: "https://www.tiktok.com/@u" },
  hours: { enabled: true, days: [{ day: "monday", closed: false, open: "09:00", close: "18:00" }, { day: "sunday", closed: true, open: "", close: "" }] },
});

test("SiteInfo: saved values replace the built-in content (text and links)", () => {
  const { SiteInfo } = loadSiteInfo();
  const phone = el("phone"), email = el("email"), address = el("address"), map = el("map"), fb = el("facebook"), hours = el("hours");
  SiteInfo.apply(baseSettings(), [phone, email, address, map, fb, hours]);
  assert.equal(phone.textContent, "+977 9800000001"); assert.equal(phone.href, "tel:+9779800000001");
  assert.equal(email.textContent, "shop@example.com"); assert.equal(email.href, "mailto:shop@example.com");
  assert.equal(address.textContent, "New Address, Butwal"); assert.equal(address.href, "https://maps.app.goo.gl/new1");
  assert.equal(map.href, "https://maps.app.goo.gl/new1"); assert.equal(map.textContent, "BUILT-IN", "link-only elements keep their label");
  assert.equal(fb.href, "https://www.facebook.com/x");
  assert.equal(hours.textContent, "Mon: 09:00 - 18:00\nSun: Closed");
});

test("SiteInfo: anything the owner cleared is HIDDEN - never blank, 'undefined' or a dead link", () => {
  const { SiteInfo } = loadSiteInfo();
  const s = baseSettings(); s.business.phone = ""; s.business.email = ""; s.business.mapUrl = ""; s.hours.enabled = false; s.social.tiktok = "";
  const rows = {}; const mk = (site) => { const e = el(site); const r = row(); e.closest = () => r; rows[site] = r; return e; };
  const els = ["phone", "email", "map", "hours", "instagram", "tiktok"].map(mk);
  SiteInfo.apply(s, els);
  for (const site of ["phone", "email", "map", "hours", "instagram", "tiktok"]) assert.equal(rows[site].hidden, true, site);
  const address = el("address"); SiteInfo.apply(s, [address]);
  assert.equal(address.textContent, "New Address, Butwal"); assert.equal(address.href, undefined, "no map link -> plain text, not a dead link");
});

test("SiteInfo: unsafe or malformed links are never applied", () => {
  const { SiteInfo } = loadSiteInfo();
  for (const bad of ["javascript:alert(1)", "http://insecure.example", "data:text/html,x", "not a url", "//evil.com", undefined, null, 5, {}]) {
    const s = baseSettings(); s.business.mapUrl = bad; s.social.facebook = bad;
    const map = el("map"), fb = el("facebook"); const r1 = row(), r2 = row(); map.closest = () => r1; fb.closest = () => r2;
    SiteInfo.apply(s, [map, fb]);
    assert.notEqual(map.href, bad, String(bad)); assert.equal(r1.hidden, true); assert.equal(r2.hidden, true);
  }
});

test("SiteInfo: text is written as plain text (no HTML injection) and 'undefined' never appears", () => {
  const { SiteInfo } = loadSiteInfo();
  const s = baseSettings(); s.business.address = '<img src=x onerror="alert(1)"> Butwal';
  const address = el("address"); SiteInfo.apply(s, [address]);
  assert.equal(address.innerHTML, "", "innerHTML is never used"); assert.match(address.textContent, /<img/);
  const partial = { business: {}, social: {}, hours: null };
  const els = ["phone", "email", "address", "map", "hours", "facebook"].map((k) => { const e = el(k); e.closest = () => row(); return e; });
  assert.doesNotThrow(() => SiteInfo.apply(partial, els));
  assert.doesNotThrow(() => SiteInfo.apply(null, els));
  for (const e of els) assert.doesNotMatch(String(e.textContent) + String(e.href), /undefined|null/);
});

test("SiteInfo: WhatsApp links follow the saved number; cleared number hides them", () => {
  let { SiteInfo, cfg } = loadSiteInfo();
  const wa = el("whatsapp", { waText: "Hello Unimart Team" });
  cfg.number = "9779800000001"; SiteInfo.apply(baseSettings(), [wa]);
  assert.equal(wa.href, "https://wa.me/9779800000001?text=Hello%20Unimart%20Team");
  ({ SiteInfo, cfg } = loadSiteInfo({ whatsapp: "" }));
  const gone = el("whatsapp"); const r = row(); gone.closest = () => r; SiteInfo.apply(baseSettings(), [gone]);
  assert.equal(r.hidden, true);
});

test("config: WhatsApp number is settable, validated, and empty means 'no link' (null), never a broken URL", () => {
  const sb = { console, URL, encodeURIComponent, Object, Number, String, Intl, RegExp, Math, Error, JSON, document: { currentScript: null, querySelector: () => null }, window: { location: { hostname: "example.com", href: "https://example.com/x/" } } };
  sb.window.window = sb.window; vm.createContext(sb);
  vm.runInContext(read("config.js"), sb);
  const c = vm.runInContext("UniMartConfig", sb);
  assert.match(c.getWhatsAppUrl("Hi there"), /^https:\/\/wa\.me\/9779700013011\?text=Hi%20there$/, "fallback until settings load");
  c.setWhatsAppNumber("9779800000001"); assert.equal(c.getWhatsAppUrl(), "https://wa.me/9779800000001");
  for (const bad of ["", "abc", "+977 98", null, undefined, "12345678901234567890"]) { c.setWhatsAppNumber(bad); assert.equal(c.getWhatsAppUrl("x"), null, String(bad)); }
  assert.equal(c.getUrl("settings", "/public"), "https://unimart-ecommerce.onrender.com/api/settings/public");
  assert.equal(c.getUrl("delivery", "/quote"), "https://unimart-ecommerce.onrender.com/api/delivery/quote");
  assert.equal(c.formatPrice(1250), "NPR 1,250");
});

// ---------------- Checkout with owner-managed delivery ----------------

const GOOD = { name: "Ram Bahadur Thapa", phone: "9812345678", address: "Aawaroad, opposite Lumbini Bikas Bank, Siddharthanagar" };
const AREAS = [
  { id: "aaaaaaaa11", name: "Siddharthanagar", type: "local", available: true, minOrder: null, message: "" },
  { id: "bbbbbbbb22", name: "Kathmandu", type: "paid", available: true, minOrder: null, message: "" },
  { id: "dddddddd44", name: "Remote Valley", type: "unsupported", available: false, minOrder: null, message: "We cannot deliver to Remote Valley yet." },
];
const settingsWith = (over = {}) => ({ delivery: { enabled: true, deliveryHours: "", notes: "", areas: AREAS }, payment: { methods: [{ code: "whatsapp", label: "WhatsApp" }] }, business: { whatsappNumber: "9779700013011" }, ...over });

// Server quote stub: mirrors what the real backend returns.
const serverQuote = ({ areaId }) => {
  const subtotal = 500;
  if (!areaId) return { deliverable: false, code: "AREA_REQUIRED", message: "Please select your delivery area.", subtotal };
  if (areaId === "dddddddd44") return { deliverable: false, code: "AREA_UNSUPPORTED", message: "We cannot deliver to Remote Valley yet.", subtotal };
  if (areaId === "aaaaaaaa11") return { deliverable: true, subtotal, delivery: { mode: "local", fee: 0, areaName: "Siddharthanagar", freeApplied: true }, total: 500 };
  return { deliverable: true, subtotal, delivery: { mode: "paid", fee: 250, areaName: "Kathmandu" }, total: 750 };
};

const boot = async (opts = {}) => {
  const sf = createStorefront({ loggedIn: opts.loggedIn, sessionStorage: opts.sessionStorage });
  const container = makeEl("container");
  const paymentOptions = makeEl("paymentOptions");
  sf.sandbox.UniMartConfig = { getPath: (p) => "https://site/" + p, formatPrice: (n) => "NPR " + Number(n).toLocaleString("en-IN"),
    getWhatsAppUrl: (t) => (opts.noWhatsapp ? null : "https://wa.me/9779700013011" + (t ? "?text=" + encodeURIComponent(t) : "")) };
  sf.sandbox.CartState = { getItems: async () => [{ productId: "p1", name: "Toy", price: 250, quantity: 2 }], clearLocalCartAfterOrder() { sf.cleared = true; }, clearCart: async () => { throw new Error("no"); } };
  sf.sandbox.SiteSettings = { load: async () => (opts.settings === undefined ? settingsWith() : opts.settings) };
  sf.sandbox.window.SiteSettings = sf.sandbox.SiteSettings;
  sf.quotes = [];
  sf.sandbox.DeliveryService = { quote: async (req) => { sf.quotes.push(req); if (opts.quoteFails) throw { networkError: true, message: "offline" }; return opts.quote ? opts.quote(req) : serverQuote(req); } };
  sf.sandbox.window.DeliveryService = sf.sandbox.DeliveryService;
  sf.sandbox.document.createElement = (tag) => { const e = makeEl(tag); e.tagName = tag.toUpperCase(); return e; };
  sf.sandbox.document.querySelector = (sel) => {
    if (sel === ".checkout-container") return container;
    if (sel.includes(":checked")) return paymentOptions.children.map((l) => l.children[0]).find((i) => i && i.checked) || null;
    return null;
  };
  ["userName", "userPhone", "userAddress", "errorName", "errorPhone", "errorAddress", "checkoutBtn", "mobileCheckoutBtn", "orderOverlay", "priceSummary", "mobileTotalAmount", "deliveryAreaBox", "deliveryArea", "errorArea", "deliveryNotice"].forEach((id) => sf.getEl(id));
  sf.els.paymentOptions = paymentOptions; sf.container = container;
  sf.getEl("userName").value = GOOD.name; sf.getEl("userPhone").value = GOOD.phone; sf.getEl("userAddress").value = GOOD.address;
  vm.runInContext(read("checkout.js"), sf.sandbox, { filename: "checkout.js" });
  await sf.state.domReady();
  sf.chooseArea = async (id) => { sf.getEl("deliveryArea").value = id; await sf.getEl("deliveryArea").fire("change"); };
  sf.submit = () => sf.getEl("checkoutBtn").click();
  sf.summary = () => sf.getEl("priceSummary").innerHTML;
  sf.placed = [];
  sf.sandbox.CheckoutService.placeOrder = async (contact, items, key) => { sf.placed.push({ contact, items, key }); if (opts.placeOrder) return opts.placeOrder(contact, items, key, sf); return { _id: "o1", orderId: "ORD-9", subtotal: 500, deliveryFee: 250, deliveryType: "paid", deliveryArea: "Kathmandu", totalAmount: 750 }; };
  return sf;
};

test("area picker appears when the owner configured areas; unavailable areas are labelled", async () => {
  const sf = await boot();
  const box = sf.getEl("deliveryAreaBox"), select = sf.getEl("deliveryArea");
  assert.equal(box.hidden, false);
  assert.deepEqual(select.children.map((o) => o.textContent), ["Select your delivery area", "Siddharthanagar", "Kathmandu", "Remote Valley (unavailable)"]);
  assert.match(sf.summary(), /To be confirmed/); // no area chosen yet
});

test("choosing an area shows the SERVER's fee and total (paid, and free)", async () => {
  const sf = await boot();
  await sf.chooseArea("bbbbbbbb22");
  assert.match(sf.summary(), /<dt>Delivery<span class="co-sub">Kathmandu<\/span><\/dt><dd>NPR 250<\/dd>/); assert.match(sf.summary(), /<dt>Total<\/dt><dd>NPR 750<\/dd>/);
  assert.equal(sf.getEl("mobileTotalAmount").textContent, "NPR 750");
  await sf.chooseArea("aaaaaaaa11");
  assert.match(sf.summary(), /co-value--free">Free</); assert.match(sf.summary(), /<dt>Total<\/dt><dd>NPR 500<\/dd>/);
  assert.doesNotMatch(sf.summary(), /undefined|₹|INR/);
  assert.deepEqual(JSON.parse(JSON.stringify(sf.quotes.at(-1))), { areaId: "aaaaaaaa11", items: [{ productId: "p1", quantity: 2 }] }, "quote request carries only area + items, never a price");
});

test("unsupported area: clear message, order button disabled, nothing sent", async () => {
  const sf = await boot();
  await sf.chooseArea("dddddddd44");
  assert.equal(sf.getEl("errorArea").textContent, "We cannot deliver to Remote Valley yet.");
  assert.ok(sf.getEl("errorArea").classList.contains("show"));
  assert.equal(sf.getEl("checkoutBtn").disabled, true); assert.equal(sf.getEl("mobileCheckoutBtn").disabled, true);
  await sf.submit(); assert.equal(sf.placed.length, 0);
  await sf.chooseArea("bbbbbbbb22"); // switching to a deliverable area unblocks
  assert.equal(sf.getEl("checkoutBtn").disabled, false); assert.equal(sf.getEl("errorArea").classList.contains("show"), false);
});

test("placing an order without choosing an area is stopped with a message", async () => {
  const sf = await boot();
  await sf.submit();
  assert.equal(sf.placed.length, 0); assert.equal(sf.getEl("errorArea").textContent, "Please select your delivery area");
});

test("order request: area id + the total the customer saw (only as a consistency check) - never a fee or subtotal", async () => {
  const sf = await boot();
  await sf.chooseArea("bbbbbbbb22"); await sf.submit();
  assert.equal(sf.placed.length, 1);
  const { contact, items } = sf.placed[0];
  assert.deepEqual(Object.keys(contact).sort(), ["customerAddress", "customerName", "customerPhone", "deliveryAreaId", "paymentMethod", "quotedTotal"]);
  assert.equal(contact.deliveryAreaId, "bbbbbbbb22"); assert.equal(contact.quotedTotal, 750); assert.equal(contact.paymentMethod, "WhatsApp");
  assert.deepEqual(JSON.parse(JSON.stringify(items)), [{ productId: "p1", quantity: 2 }]);
  for (const forbidden of ["deliveryFee", "fee", "subtotal", "total", "totalAmount", "price"]) assert.ok(!(forbidden in contact), forbidden);
});

test("server says the total changed (409 QUOTE_CHANGED): new numbers shown, nothing ordered, can confirm again", async () => {
  const sf = await boot({ placeOrder: async () => { throw { status: 409, message: "The price or delivery charge has changed. Please review your order total and try again.",
    body: { code: "QUOTE_CHANGED", quote: { subtotal: 500, delivery: { mode: "paid", fee: 300, areaName: "Kathmandu" }, total: 800 } } }; } });
  await sf.chooseArea("bbbbbbbb22"); await sf.submit();
  assert.match(sf.summary(), /NPR 300/); assert.match(sf.summary(), /NPR 800/);
  assert.match(sf.toasts.at(-1), /has changed/);
  assert.equal(sf.getEl("checkoutBtn").disabled, false);
});

test("server-side delivery refusal at order time (area became unsupported) is shown next to the area and re-quoted", async () => {
  const sf = await boot({ placeOrder: async () => { throw { status: 400, message: "Sorry, we don't deliver to Kathmandu yet.", body: { code: "AREA_UNSUPPORTED" } }; } });
  await sf.chooseArea("bbbbbbbb22"); const before = sf.quotes.length; await sf.submit();
  assert.equal(sf.getEl("errorArea").textContent, "Sorry, we don't deliver to Kathmandu yet.");
  assert.ok(sf.quotes.length > before, "quote refreshed");
});

test("delivery switched off by the owner: clear notice, checkout blocked", async () => {
  const sf = await boot({ settings: settingsWith({ delivery: { enabled: false, areas: [] } }) });
  assert.equal(sf.getEl("deliveryAreaBox").hidden, true);
  assert.match(sf.getEl("deliveryNotice").textContent, /currently unavailable/); assert.equal(sf.getEl("deliveryNotice").hidden, false);
  assert.equal(sf.getEl("checkoutBtn").disabled, true);
});

test("no areas configured / settings unavailable = Phase 1 behaviour (no picker, 'To be confirmed', order goes through)", async () => {
  for (const settings of [settingsWith({ delivery: { enabled: true, areas: [] } }), null]) {
    const sf = await boot({ settings, quote: () => ({ deliverable: true, subtotal: 500, delivery: { mode: "manual", fee: 0 }, total: 500 }) });
    assert.equal(sf.getEl("deliveryAreaBox").hidden === false && settings !== null && settings.delivery.areas.length > 0, false);
    assert.match(sf.summary(), /To be confirmed/); assert.match(sf.summary(), /excl\. delivery/);
    await sf.submit();
    assert.equal(sf.placed.length, 1); assert.equal("deliveryAreaId" in sf.placed[0].contact, false);
  }
});

test("quote service unreachable: checkout still works (server prices the order), no quotedTotal sent", async () => {
  const sf = await boot({ quoteFails: true, settings: settingsWith({ delivery: { enabled: true, areas: [] } }) });
  assert.match(sf.summary(), /To be confirmed/);
  await sf.submit();
  assert.equal(sf.placed.length, 1); assert.equal("quotedTotal" in sf.placed[0].contact, false);
});

test("out-of-order quote responses cannot overwrite a newer choice", async () => {
  let release;
  const sf = await boot({ quote: (req) => (req.areaId === "bbbbbbbb22" ? new Promise((r) => { release = () => r(serverQuote(req)); }) : serverQuote(req)) });
  const slow = sf.chooseArea("bbbbbbbb22");             // slow response for Kathmandu
  await sf.chooseArea("aaaaaaaa11");                    // customer changes their mind: local
  release(); await slow;
  assert.match(sf.summary(), /co-value--free">Free</); assert.doesNotMatch(sf.summary(), /NPR 250/);
});

test("payment options follow the owner's settings; COD is sent as 'Cash on Delivery'", async () => {
  const sf = await boot({ settings: settingsWith({ payment: { methods: [{ code: "whatsapp", label: "WhatsApp" }, { code: "cod", label: "Cash on Delivery" }] } }) });
  const radios = sf.els.paymentOptions.children.map((l) => l.children[0]);
  assert.deepEqual(radios.map((r) => r.dataset.method), ["WhatsApp", "Cash on Delivery"]);
  assert.equal(radios[0].checked, true);
  await sf.chooseArea("bbbbbbbb22"); radios[0].checked = false; radios[1].checked = true;
  await sf.submit();
  assert.equal(sf.placed[0].contact.paymentMethod, "Cash on Delivery");
});

test("only COD enabled: WhatsApp payment is not offered", async () => {
  const sf = await boot({ settings: settingsWith({ payment: { methods: [{ code: "cod", label: "Cash on Delivery" }] } }) });
  assert.deepEqual(sf.els.paymentOptions.children.map((l) => l.children[0].dataset.method), ["Cash on Delivery"]);
});

test("confirmation shows the server's breakdown; WhatsApp button only when a number is configured", async () => {
  const sf = await boot();
  await sf.chooseArea("bbbbbbbb22"); await sf.submit();
  const html = sf.container.innerHTML;
  assert.match(html, /ORD-9/); assert.match(html, /<dt>Subtotal<\/dt><dd>NPR 500<\/dd>/); assert.match(html, /<dt>Delivery<span class="co-sub">Kathmandu<\/span><\/dt><dd>NPR 250<\/dd>/); assert.match(html, /<dt>Total<\/dt><dd>NPR 750<\/dd>/);
  assert.match(html, /sendWhatsappBtn/); assert.doesNotMatch(html, /undefined|₹|INR/);
  const none = await boot({ noWhatsapp: true }); await none.chooseArea("bbbbbbbb22"); await none.submit();
  assert.doesNotMatch(none.container.innerHTML, /sendWhatsappBtn/);
});

test("confirmation for an order without a subtotal (legacy shape) shows only its total", async () => {
  const sf = await boot({ placeOrder: async () => ({ _id: "o", orderId: "ORD-OLD", totalAmount: 1000 }) });
  await sf.chooseArea("bbbbbbbb22"); await sf.submit();
  assert.match(sf.container.innerHTML, /<dt>Total<\/dt><dd>NPR 1,000<\/dd>/); assert.doesNotMatch(sf.container.innerHTML, /Delivery/);
});

test("idempotency key changes when the delivery area or payment method changes", async () => {
  const sf = await boot({ placeOrder: async () => { throw { networkError: true, message: "x" }; } });
  await sf.chooseArea("bbbbbbbb22"); await sf.submit(); await sf.submit();
  await sf.chooseArea("aaaaaaaa11"); await sf.submit();
  const keys = sf.placed.map((p) => p.key);
  assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2]);
});
