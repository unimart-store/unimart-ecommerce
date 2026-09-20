const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { validateSettingsUpdate } = require("../backend/utils/settingsValidator");
const { buildDefaultSettings } = require("../backend/utils/settingsDefaults");

const ADMIN_JS = path.join(__dirname, "..", "admin", "js");
const src = (rel) => fs.readFileSync(path.join(ADMIN_JS, rel), "utf8").replace(/\r/g, "");
const clone = (o) => JSON.parse(JSON.stringify(o));

const loadPure = (rel, name, extra = {}) => {
  const sb = { console, Intl, Number, JSON, Object, Array, Set, String, Boolean, ...extra };
  sb.window = sb; vm.createContext(sb);
  vm.runInContext(src(rel), sb);
  return vm.runInContext(name, sb);
};
const Form = () => loadPure("utils/settingsForm.js", "AdminSettingsForm");

const fullSettings = () => ({ ...buildDefaultSettings(), revision: 4 });

// ---------------- pure form module ----------------

test("form renders every section and field the backend can persist (no fake fields)", () => {
  const html = Form().renderForm(fullSettings(), {});
  for (const title of ["Business Information", "Contact &amp; Social Links", "Business Hours", "Delivery", "Payment", "Courier Services"]) assert.ok(html.includes(title), title);
  const paths = [...html.matchAll(/data-path="([^"]+)"/g)].map((m) => m[1]);
  for (const p of ["business.name", "business.address", "business.locationText", "business.mapUrl", "business.phone", "business.whatsappNumber", "business.email",
    "social.facebook", "social.instagram", "social.tiktok", "hours.enabled", "hours.days.0.closed", "delivery.enabled", "delivery.localEnabled", "delivery.localFee",
    "delivery.freeDeliveryMinOrder", "delivery.deliveryHours", "delivery.notes", "payment.whatsappEnabled", "payment.codEnabled"]) assert.ok(paths.includes(p), p);
  // every rendered path must be a path the backend validator understands
  const known = new Set(Object.keys(buildDefaultSettings()));
  for (const p of paths) assert.ok(known.has(p.split(".")[0]), `${p} maps to a real settings section`);
  assert.doesNotMatch(html, /undefined|>null<|value="null"|NaN/);
});

test("form escapes stored values (no HTML/attribute injection from settings data)", () => {
  const s = fullSettings();
  s.business.name = '"><img src=x onerror=alert(1)>'; s.business.address = "<script>alert(1)</script>";
  s.delivery.areas = [{ id: "aaaaaaaa11", name: '</strong><b>x', type: "unsupported", enabled: true, fee: null, minOrder: null, courierId: null, message: "'\"><svg onload=1>" }];
  s.couriers = [{ id: "cccccccc11", name: "<i>NCM</i>", enabled: true, coverage: "<u>", fee: null, feeNotes: "", codSupported: false, notes: "" }];
  const html = Form().renderForm(s, { "business.name": "<b>bad</b>" });
  assert.doesNotMatch(html, /<img src=x|<script>alert|<svg onload|<b>x|<i>NCM<\/i>|<b>bad<\/b>/);
  assert.match(html, /&lt;script&gt;/);
});

test("area rows show only the fields that apply to their type", () => {
  const F = Form(); const s = fullSettings();
  s.couriers = [{ id: "cccccccc11", name: "NCM", enabled: true, coverage: "", fee: 180, feeNotes: "", codSupported: false, notes: "" }, { name: "Unsaved courier" }];
  s.delivery.areas = [{ name: "L", type: "local", enabled: true, fee: null, minOrder: 300, courierId: null, message: "" },
    { name: "P", type: "paid", enabled: true, fee: 250, minOrder: null, courierId: "cccccccc11", message: "" },
    { name: "U", type: "unsupported", enabled: true, fee: null, minOrder: null, courierId: null, message: "No" }];
  const html = F.renderForm(s, {});
  const has = (p) => html.includes(`data-path="${p}"`);
  assert.deepEqual([has("delivery.areas.0.fee"), has("delivery.areas.0.minOrder"), has("delivery.areas.0.message"), has("delivery.areas.0.courierId")], [false, true, false, false]);
  assert.deepEqual([has("delivery.areas.1.fee"), has("delivery.areas.1.courierId"), has("delivery.areas.1.minOrder")], [true, true, true]);
  assert.deepEqual([has("delivery.areas.2.message"), has("delivery.areas.2.fee"), has("delivery.areas.2.minOrder")], [true, false, false]);
  assert.ok(html.includes('value="cccccccc11"') && !html.includes("Unsaved courier</option>"), "only SAVED couriers can be linked to an area");
});

test("hours: closed days hide time inputs; open days show them", () => {
  const s = fullSettings(); s.hours.days[0] = { day: "monday", closed: false, open: "09:00", close: "18:00" };
  const html = Form().renderForm(s, {});
  assert.ok(html.includes('data-path="hours.days.0.open"') && html.includes('value="09:00"'));
  assert.ok(!html.includes('data-path="hours.days.1.open"'));
});

test("errors are shown next to their field with aria-invalid and a summary count", () => {
  const html = Form().renderForm(fullSettings(), { "business.mapUrl": "Map link must start with https://", "payment.whatsappEnabled": "Enable at least one payment method" });
  assert.match(html, /data-error-for="business.mapUrl">Map link must start with https:\/\//);
  assert.match(html, /aria-invalid="true"/); assert.match(html, /\(2 problems\)/);
  assert.doesNotMatch(Form().renderForm(fullSettings(), {}), /settings-error-summary/);
});

test("setByPath edits nested state and refuses prototype pollution / missing parents", () => {
  const F = Form(); const s = { a: { b: { c: 1 } } };
  assert.equal(F.setByPath(s, "a.b.c", 2), true); assert.equal(s.a.b.c, 2);
  for (const p of ["__proto__.polluted", "a.__proto__.polluted", "constructor.prototype.x", "a.constructor.x", "x.y.z"]) assert.equal(F.setByPath(s, p, 1), false, p);
  assert.equal({}.polluted, undefined); assert.equal(Object.prototype.x, undefined);
});

test("readFieldValue: numbers become numbers/null, junk is passed through for the server to flag", () => {
  const F = Form();
  assert.equal(F.readFieldValue("number", "250"), 250); assert.equal(F.readFieldValue("number", " 12.5 "), 12.5);
  assert.equal(F.readFieldValue("number", ""), null); assert.equal(F.readFieldValue("number", "abc"), "abc");
  assert.equal(F.readFieldValue("bool", "on", true), true); assert.equal(F.readFieldValue("bool", "on", false), false);
  assert.equal(F.readFieldValue("text", "  x "), "  x ");
});

test("toPayload: keeps ids and revision, drops fields that do not apply, sends only known keys", () => {
  const F = Form(); const s = fullSettings();
  s.junk = "x"; s.business.role = "admin";
  s.delivery.areas = [{ id: "aaaaaaaa11", name: "L", type: "local", enabled: true, fee: 999, minOrder: 300, courierId: "z", message: "m", extra: 1 },
    { name: "New", type: "paid", enabled: true, fee: 100, minOrder: null, courierId: null, message: "m" },
    { id: "uuuuuuuu33", name: "U", type: "unsupported", enabled: true, fee: 5, minOrder: 9, courierId: "z", message: "No" }];
  const p = F.toPayload(s);
  assert.equal(p.revision, 4); assert.equal("junk" in p, false);
  assert.deepEqual(Object.keys(p).sort(), ["business", "couriers", "delivery", "hours", "payment", "revision", "social"]);
  const [local, fresh, unsupported] = p.delivery.areas;
  assert.deepEqual([local.id, local.fee, local.courierId, local.message, local.minOrder], ["aaaaaaaa11", null, null, "", 300]);
  assert.equal("id" in fresh, false, "new rows get their id from the server");
  assert.deepEqual([unsupported.fee, unsupported.minOrder, unsupported.courierId, unsupported.message], [null, null, null, "No"]);
  assert.equal("extra" in local, false);
});

test("ROUND TRIP: what the form produces is accepted by the real backend validator (defaults, and a fully configured shop)", () => {
  const F = Form();
  const defaults = validateSettingsUpdate(F.toPayload(fullSettings()));
  assert.ok(defaults.value, JSON.stringify(defaults.errors));
  assert.equal(defaults.value.revision, 4);

  const s = fullSettings();
  s.hours = { enabled: true, days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => ({ day, closed: day === "sunday", open: "09:00", close: "18:00" })) };
  s.couriers = [{ id: "cccccccc11", name: "NCM", enabled: true, coverage: "Nationwide", fee: 180, feeNotes: "weight bands", codSupported: true, notes: "" }];
  s.delivery = { ...s.delivery, localFee: 50, freeDeliveryMinOrder: 1000, deliveryHours: "10-6", notes: "n", areas: [
    { id: "aaaaaaaa11", name: "Siddharthanagar", type: "local", enabled: true, fee: null, minOrder: null, courierId: null, message: "" },
    { name: "Kathmandu", type: "paid", enabled: true, fee: null, minOrder: 500, courierId: "cccccccc11", message: "" },
    { name: "Remote", type: "unsupported", enabled: true, fee: null, minOrder: null, courierId: null, message: "Not yet" }] };
  s.payment = { whatsappEnabled: true, codEnabled: true };
  const full = validateSettingsUpdate(F.toPayload(s), s);
  assert.ok(full.value, JSON.stringify(full.errors));
  assert.equal(full.value.sections.delivery.areas.length, 3);
});

test("form-produced mistakes come back as backend errors keyed by the SAME paths the form renders", () => {
  const F = Form(); const s = fullSettings();
  s.delivery.areas = [{ name: "P", type: "paid", enabled: true, fee: null, minOrder: null, courierId: null, message: "" }];
  s.business.mapUrl = "javascript:alert(1)";
  const r = validateSettingsUpdate(F.toPayload(s));
  assert.ok(r.errors["delivery.areas.0.fee"] && r.errors["business.mapUrl"]);
  const html = F.renderForm(s, r.errors);
  for (const p of Object.keys(r.errors)) assert.ok(html.includes(`data-error-for="${p}"`), `error for ${p} is displayed`);
});

// ---------------- page glue (stubbed DOM) ----------------

const bootPage = async ({ getResult, updateImpl } = {}) => {
  const calls = { get: 0, update: [], toasts: [] };
  const handlers = {};
  const host = { innerHTML: "", addEventListener: (t, fn) => (handlers[t] = fn), querySelector: () => ({ textContent: "", addEventListener() {}, remove() {}, scrollIntoView() {} }) };
  const status = { textContent: "" };
  let saveHandler;
  const saveBtn = { disabled: false, addEventListener: (t, fn) => (saveHandler = fn) };
  const els = { settingsFormHost: host, settingsSaveBtn: saveBtn, settingsStatus: status, adminContent: { appendChild() {} }, settingsTemplate: { content: { cloneNode: () => ({}) } }, settingsRetryBtn: { addEventListener: (t, fn) => (els._retry = fn) } };
  const sb = { console, JSON, Object, Array, Number, String, Boolean, Promise, setTimeout, CSS: { escape: (s) => s },
    document: { getElementById: (id) => els[id] || null }, window: { addEventListener() {} },
    AdminLayout: { guardAndRender: async () => ({ role: "admin" }) },
    AdminSettingsService: { get: async () => { calls.get++; return getResult ? getResult() : { ...fullSettings() }; }, update: async (p) => { calls.update.push(p); return updateImpl ? updateImpl(p) : { ...clone(p), revision: p.revision + 1 }; } },
    showAdminToast: (m, t) => calls.toasts.push([t, m]) };
  sb.window.window = sb.window; vm.createContext(sb);
  vm.runInContext(src("utils/settingsForm.js"), sb);
  sb.AdminSettingsForm = vm.runInContext("AdminSettingsForm", sb);
  vm.runInContext(src("pages/settings.js"), sb);
  await new Promise((r) => setTimeout(r, 5));
  const edit = (p, kind, value, checked, type = "input") => handlers[type === "input" ? "input" : "change"]({ type, target: { dataset: { path: p, kind }, value, checked, removeAttribute() {} } });
  return { calls, host, status, saveBtn, save: () => saveHandler(), edit, click: (action, index) => handlers.click({ target: { closest: () => ({ dataset: { action, index: String(index || 0) } }) } }), els };
};

test("page: loads settings from the API and renders the form; save button enabled", async () => {
  const pg = await bootPage();
  assert.equal(pg.calls.get, 1); assert.match(pg.host.innerHTML, /Business Information/); assert.equal(pg.saveBtn.disabled, false);
});

test("page: editing then saving sends the edited values with the revision; success feedback shown", async () => {
  const pg = await bootPage();
  pg.edit("business.name", "text", "New Shop Name"); pg.edit("delivery.localFee", "number", "40"); pg.edit("payment.codEnabled", "bool", "on", true, "change");
  assert.match(pg.status.textContent, /unsaved/i);
  await pg.save();
  const sent = pg.calls.update[0];
  assert.equal(sent.business.name, "New Shop Name"); assert.equal(sent.delivery.localFee, 40); assert.equal(sent.payment.codEnabled, true); assert.equal(sent.revision, 4);
  assert.equal(pg.calls.toasts.at(-1)[0], "success"); assert.match(pg.status.textContent, /saved/i);
});

test("page: double-clicking Save sends ONE request; the button is disabled while saving", async () => {
  let release; const pg = await bootPage({ updateImpl: (p) => new Promise((r) => { release = () => r({ ...clone(p), revision: 5 }); }) });
  const first = pg.save(); const second = pg.save(); const third = pg.save();
  assert.equal(pg.saveBtn.disabled, true); assert.equal(pg.calls.update.length, 1);
  release(); await Promise.all([first, second, third]);
  assert.equal(pg.saveBtn.disabled, false);
});

test("page: server validation errors are displayed per field and nothing is lost from the form", async () => {
  const pg = await bootPage({ updateImpl: () => { throw { status: 400, message: "Please fix the highlighted fields", body: { errors: { "business.mapUrl": "Map link must start with https://" } } }; } });
  pg.edit("business.mapUrl", "text", "javascript:alert(1)");
  await pg.save();
  assert.match(pg.host.innerHTML, /Map link must start with https:\/\//); assert.match(pg.host.innerHTML, /value="javascript:alert\(1\)"/);
  assert.equal(pg.calls.toasts.at(-1)[0], "error"); assert.equal(pg.saveBtn.disabled, false);
});

test("page: 409 (changed elsewhere) and network errors give a clear message and leave the form intact", async () => {
  let pg = await bootPage({ updateImpl: () => { throw { status: 409, message: "These settings were changed by someone else" }; } });
  await pg.save(); assert.match(pg.calls.toasts.at(-1)[1], /changed by someone else/); assert.match(pg.status.textContent, /reload/i);
  pg = await bootPage({ updateImpl: () => { throw { networkError: true, message: "Could not reach the server." }; } });
  await pg.save(); assert.equal(pg.calls.toasts.at(-1)[0], "error"); assert.equal(pg.saveBtn.disabled, false);
});

test("page: add / remove area and courier rows", async () => {
  const pg = await bootPage();
  pg.click("add-area"); pg.click("add-courier");
  assert.match(pg.host.innerHTML, /data-path="delivery.areas.0.name"/); assert.match(pg.host.innerHTML, /data-path="couriers.0.name"/);
  pg.edit("delivery.areas.0.name", "text", "Butwal"); pg.edit("couriers.0.name", "text", "NCM");
  await pg.save();
  assert.equal(pg.calls.update[0].delivery.areas[0].name, "Butwal"); assert.equal(pg.calls.update[0].couriers[0].name, "NCM");
  pg.click("remove-area", 0);
  assert.doesNotMatch(pg.host.innerHTML, /data-path="delivery.areas.0.name"/);
});

test("page: load failure shows an error state with retry; retry loads the form", async () => {
  let fail = true;
  const pg = await bootPage({ getResult: () => { if (fail) throw { message: "Could not reach the server." }; return fullSettings(); } });
  assert.match(pg.host.innerHTML, /Couldn't load settings/); assert.equal(pg.saveBtn.disabled, true);
  fail = false; await pg.els._retry();
  assert.match(pg.host.innerHTML, /Business Information/);
});

// ---------------- admin order view: legacy-safe ----------------

test("admin order totals: legacy orders keep their original total; new orders show the breakdown", () => {
  const V = loadPure("utils/orderView.js", "AdminOrderView", { AdminFormat: { currency: (n) => `NPR ${n}`, escapeHtml: (s) => String(s).replace(/</g, "&lt;") } });
  const legacy = { totalAmount: 1000, items: [] };
  assert.match(V.renderTotalsRows(legacy, 999), /NPR 1000/); assert.doesNotMatch(V.renderTotalsRows(legacy, 999), /Delivery|subtotal/i);
  assert.equal(V.renderDeliverySection(legacy), "");
  const paid = { subtotal: 1000, deliveryFee: 250, deliveryType: "paid", deliveryArea: "Kathmandu", deliveryCourier: "NCM", totalAmount: 1250 };
  const rows = V.renderTotalsRows(paid, 1000);
  assert.match(rows, /Items subtotal.*NPR 1000/s); assert.match(rows, /Delivery \(Kathmandu\).*NPR 250/s); assert.match(rows, /NPR 1250/);
  const section = V.renderDeliverySection(paid); assert.match(section, /Paid delivery/); assert.match(section, /NCM/);
  const free = { subtotal: 500, deliveryFee: 0, deliveryType: "local", deliveryArea: "Local", totalAmount: 500 };
  assert.match(V.renderTotalsRows(free, 500), /FREE/);
  const manual = { subtotal: 500, deliveryFee: 0, deliveryType: "manual", totalAmount: 500 };
  assert.match(V.renderTotalsRows(manual, 500), /To be confirmed/); assert.match(V.renderTotalsRows(manual, 500), /excl\. delivery/);
  assert.match(V.renderDeliverySection({ ...paid, deliveryArea: "<script>" }), /&lt;script>/);
});
