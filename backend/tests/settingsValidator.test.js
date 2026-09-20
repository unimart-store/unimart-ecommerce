const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSettingsUpdate, normalizeWhatsAppNumber } = require("../utils/settingsValidator");

const ok = (body, existing) => { const r = validateSettingsUpdate(body, existing); assert.ok(r.value, JSON.stringify(r.errors)); return r.value; };
const bad = (body, path, existing) => { const r = validateSettingsUpdate(body, existing); assert.ok(r.errors, "expected errors"); if (path) assert.ok(r.errors[path], `expected error at ${path}, got ${JSON.stringify(r.errors)}`); return r.errors; };

const goodBusiness = { name: "UniMart", address: "Aawaroad, Siddharthanagar", locationText: "Bhairahawa", mapUrl: "https://maps.app.goo.gl/abc123", phone: "+977 9700013011", whatsappNumber: "+977 9700013011", email: "unimart.team@gmail.com" };

test("valid business section: normalized and complete", () => {
  const v = ok({ business: goodBusiness }).sections.business;
  assert.equal(v.whatsappNumber, "9779700013011"); assert.equal(v.name, "UniMart"); assert.equal(v.email, "unimart.team@gmail.com");
});

test("WhatsApp number normalization", () => {
  for (const [input, out] of [["+977 9700013011", "9779700013011"], ["9700013011", "9779700013011"], ["009779700013011", "9779700013011"], ["+1 415 555 2671", "14155552671"]]) {
    assert.equal(normalizeWhatsAppNumber(input), out, input);
  }
  for (const input of ["", "abc", "123", "+0123456789", "97797000130111111111", null, 9700013011]) assert.equal(normalizeWhatsAppNumber(input), null, String(input));
});

test("clearing optional business fields is allowed (owner may hide them); name is required", () => {
  const v = ok({ business: { name: "UniMart", mapUrl: "", phone: "", whatsappNumber: "", email: "" } }).sections.business;
  assert.equal(v.mapUrl, ""); assert.equal(v.whatsappNumber, "");
  bad({ business: { name: "" } }, "business.name");
});

test("URLs must be https, complete, without credentials or script schemes", () => {
  for (const url of ["javascript:alert(1)", "http://maps.google.com/x", "ftp://x.com", "maps.google.com", "https://user:pw@evil.com", "https://localhost", "data:text/html,<script>", "https://"]) {
    bad({ business: { name: "X", mapUrl: url } }, "business.mapUrl");
    bad({ social: { instagram: url } }, "social.instagram");
  }
  ok({ social: { facebook: "https://www.facebook.com/x", instagram: "", tiktok: "https://www.tiktok.com/@u" } });
});

test("free text cannot carry HTML or control characters; type and length enforced", () => {
  bad({ business: { name: "<script>alert(1)</script>" } }, "business.name");
  bad({ business: { name: "Uni\u0000Mart" } }, "business.name");
  bad({ business: { name: "x".repeat(101) } }, "business.name");
  bad({ business: { name: 5 } }, "business.name");
  bad({ business: { name: { $ne: 1 } } }, "business.name");
  bad({ business: { name: "X", email: "not-an-email" } }, "business.email");
  bad({ business: { name: "X", phone: "call me maybe" } }, "business.phone");
  bad({ business: { name: "X", whatsappNumber: "abc" } }, "business.whatsappNumber");
});

test("unknown/extra fields never reach the output (no mass assignment)", () => {
  const v = ok({ business: { ...goodBusiness, role: "admin", __proto__: { polluted: 1 }, key: "hacked" }, key: "hacked", revision: 3, updatedBy: "x", role: "admin", secret: "s", JWT_SECRET: "leak" });
  assert.deepEqual(Object.keys(v.sections), ["business"]);
  assert.deepEqual(Object.keys(v.sections.business).sort(), ["address", "email", "locationText", "mapUrl", "name", "phone", "whatsappNumber"]);
  assert.equal(v.revision, 3); // revision is only ever used as the optimistic-lock expectation
  assert.equal({}.polluted, undefined);
});

test("body must be a non-empty object; only known sections count", () => {
  for (const b of [null, undefined, "x", 5, [], []]) assert.ok(validateSettingsUpdate(b).errors._);
  assert.equal(validateSettingsUpdate({ role: "admin" }).errors._, "Nothing to update");
  bad({ business: goodBusiness, revision: -1 }, "revision"); bad({ business: goodBusiness, revision: "2" }, "revision"); bad({ business: goodBusiness, revision: 1.5 }, "revision");
});

test("hours: canonical order, closed days blanked, times validated", () => {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => ({ day, closed: day === "sunday", open: "10:00", close: "19:30" }));
  const v = ok({ hours: { enabled: true, days: [...days].reverse() } }).sections.hours;
  assert.deepEqual(v.days.map((d) => d.day), ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
  assert.deepEqual(v.days[6], { day: "sunday", closed: true, open: "", close: "" });
  assert.equal(v.days[0].open, "10:00");
  const withDay = (i, patch) => days.map((d, idx) => (idx === i ? { ...d, ...patch } : d));
  bad({ hours: { enabled: true, days: withDay(0, { open: "25:00" }) } }, "hours.days.0.open");
  bad({ hours: { enabled: true, days: withDay(1, { close: "9am" }) } }, "hours.days.1.close");
  bad({ hours: { enabled: true, days: withDay(2, { open: "18:00", close: "09:00" }) } }, "hours.days.2.close");
  bad({ hours: { enabled: true, days: days.slice(0, 6) } }, "hours.days");
  bad({ hours: { enabled: true, days: withDay(3, { day: "monday" }) } }, "hours.days.3.day");
  bad({ hours: { enabled: true, days: withDay(0, { day: "funday" }) } }, "hours.days.0.day");
});

const delivery = (areas, extra = {}) => ({ delivery: { enabled: true, localEnabled: true, localFee: null, freeDeliveryMinOrder: null, deliveryHours: "", notes: "", areas, ...extra } });

test("delivery areas: ids assigned, types/fees normalized, irrelevant fields cleared", () => {
  const v = ok(delivery([
    { name: "Siddharthanagar", type: "local", fee: 999, minOrder: "300", courierId: "x", message: "ignored" },
    { name: "Kathmandu", type: "paid", fee: "250.567" },
    { name: "Remote", type: "unsupported", fee: 5, minOrder: 5, message: "Not yet" },
  ])).sections.delivery.areas;
  assert.ok(v.every((a) => /^[a-z0-9]{8,32}$/.test(a.id)));
  assert.equal(new Set(v.map((a) => a.id)).size, 3);
  assert.deepEqual([v[0].fee, v[0].minOrder, v[0].courierId, v[0].message], [null, 300, null, ""]);
  assert.equal(v[1].fee, 250.57);
  assert.deepEqual([v[2].fee, v[2].minOrder, v[2].message], [null, null, "Not yet"]);
});

test("existing area ids are preserved across saves", () => {
  const v = ok(delivery([{ id: "abcd1234ef", name: "Butwal", type: "local" }])).sections.delivery.areas;
  assert.equal(v[0].id, "abcd1234ef");
});

test("invalid areas are rejected with the path of the bad field", () => {
  bad(delivery([{ name: "", type: "local" }]), "delivery.areas.0.name");
  bad(delivery([{ name: "A", type: "teleport" }]), "delivery.areas.0.type");
  bad(delivery([{ name: "A", type: "local" }, { name: "a", type: "local" }]), "delivery.areas.1.name");
  bad(delivery([{ name: "A", type: "paid", fee: -5 }]), "delivery.areas.0.fee");
  bad(delivery([{ name: "A", type: "paid", fee: "free" }]), "delivery.areas.0.fee");
  bad(delivery([{ name: "A", type: "paid", fee: 1e9 }]), "delivery.areas.0.fee");
  bad(delivery([{ name: "A", type: "local", minOrder: -1 }]), "delivery.areas.0.minOrder");
  bad(delivery([{ name: "<b>A</b>", type: "local" }]), "delivery.areas.0.name");
  bad(delivery(Array.from({ length: 51 }, (_, i) => ({ name: "A" + i, type: "local" }))), "delivery.areas");
  bad(delivery("not a list"), "delivery.areas");
});

test("an ENABLED paid area must resolve to a fee; a disabled or courier-priced one may not need its own", () => {
  bad(delivery([{ name: "A", type: "paid" }]), "delivery.areas.0.fee");
  ok(delivery([{ name: "A", type: "paid", enabled: false }]));
  ok(delivery([{ name: "A", type: "paid", fee: 0 }]));
  const couriers = [{ id: "cccccccc11", name: "NCM", fee: 180 }];
  ok({ couriers, ...delivery([{ name: "A", type: "paid", courierId: "cccccccc11" }]) });
  bad({ couriers: [{ id: "cccccccc11", name: "NCM" }], ...delivery([{ name: "A", type: "paid", courierId: "cccccccc11" }]) }, "delivery.areas.0.fee");
  bad(delivery([{ name: "A", type: "paid", fee: 5, courierId: "doesnotexist" }]), "delivery.areas.0.courierId");
});

test("area courier references resolve against EXISTING couriers when only delivery is saved", () => {
  const existing = { couriers: [{ id: "cccccccc11", name: "NCM", enabled: true, fee: 180 }] };
  ok(delivery([{ name: "A", type: "paid", courierId: "cccccccc11" }]), existing);
  bad(delivery([{ name: "A", type: "paid", courierId: "cccccccc22" }]), "delivery.areas.0.courierId", existing);
});

test("free-delivery minimum only makes sense with a local fee", () => {
  bad(delivery([], { freeDeliveryMinOrder: 1000 }), "delivery.freeDeliveryMinOrder");
  bad(delivery([], { localFee: 0, freeDeliveryMinOrder: 1000 }), "delivery.freeDeliveryMinOrder");
  ok(delivery([], { localFee: 50, freeDeliveryMinOrder: 1000 }));
  bad(delivery([], { localFee: -1 }), "delivery.localFee");
});

test("couriers: validated, unique names, ids assigned, cannot be removed while an area depends on them", () => {
  const v = ok({ couriers: [{ name: "NCM", enabled: true, coverage: "Nationwide", fee: null, feeNotes: "Depends on weight", codSupported: true, notes: "" }] }).sections.couriers;
  assert.equal(v.length, 1); assert.ok(/^[a-z0-9]{8,32}$/.test(v[0].id)); assert.equal(v[0].fee, null); assert.equal(v[0].codSupported, true);
  bad({ couriers: [{ name: "NCM" }, { name: "ncm" }] }, "couriers.1.name");
  bad({ couriers: [{ name: "" }] }, "couriers.0.name");
  bad({ couriers: [{ name: "NCM", fee: -1 }] }, "couriers.0.fee");
  bad({ couriers: "x" }, "couriers");
  bad({ couriers: Array.from({ length: 21 }, (_, i) => ({ name: "C" + i })) }, "couriers");
  const existing = { couriers: [{ id: "cccccccc11", name: "NCM", fee: 180 }], delivery: { areas: [{ name: "KTM", type: "paid", enabled: true, fee: null, courierId: "cccccccc11" }] } };
  bad({ couriers: [] }, "couriers", existing);
  bad({ couriers: [{ id: "cccccccc11", name: "NCM", fee: null }] }, "couriers", existing);
  ok({ couriers: [{ id: "cccccccc11", name: "NCM", fee: 200 }] }, existing);
});

test("payment: at least one method must stay enabled; booleans only", () => {
  ok({ payment: { whatsappEnabled: true, codEnabled: true } });
  ok({ payment: { whatsappEnabled: false, codEnabled: true } });
  bad({ payment: { whatsappEnabled: false, codEnabled: false } }, "payment.whatsappEnabled");
  bad({ payment: { whatsappEnabled: "yes", codEnabled: false } }, "payment.whatsappEnabled");
});

test("NPR only: no currency field is accepted or stored in settings", () => {
  const v = ok({ business: goodBusiness, currency: "INR" });
  assert.equal("currency" in v.sections, false);
});
