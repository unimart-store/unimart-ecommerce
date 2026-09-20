const test = require("node:test");
const assert = require("node:assert/strict");
const fake = require("./helpers/fakeDb");

const restore = fake.install();
test.after(() => restore());
// Real route files + real protect/authorize middleware, run through a fake Router.
const settingsRouter = require("../routes/settingsRoutes");

const setup = () => {
  fake.reset();
  const admin = fake.addUser({ role: "admin", name: "Uncle" });
  const customer = fake.addUser({ role: "customer", name: "Buyer" });
  return { admin, customer };
};
const call = (method, path, { user, body, headers } = {}) =>
  fake.runRoute(settingsRouter, method, path, { headers: { ...(user ? fake.bearer(user) : {}), ...(headers || {}) }, body });

const validBusiness = { name: "UniMart", address: "New shop address, Butwal", locationText: "Butwal", mapUrl: "https://maps.app.goo.gl/new123", phone: "+977 9800000001", whatsappNumber: "+977 9800000001", email: "shop@example.com" };

test("public settings: no login needed; first request creates the document with safe seed values", async () => {
  setup();
  const res = await call("get", "/public");
  assert.equal(res.statusCode, 200);
  const d = res.body.data;
  assert.equal(d.business.whatsappNumber, "9779700013011");
  assert.equal(d.business.email, "unimart.team@gmail.com");
  assert.match(d.business.address, /Aawaroad/);
  assert.equal(d.currency, "NPR");
  assert.equal(fake.db.settings.length, 1);
  assert.match(res.headers["Cache-Control"], /max-age/);
});

test("public settings: nothing unconfirmed is invented (hours off, no fees, no areas, no couriers, COD off)", async () => {
  setup();
  const d = (await call("get", "/public")).body.data;
  assert.deepEqual(d.hours, { enabled: false, days: [] });
  assert.deepEqual(d.delivery.areas, []);
  assert.equal(d.delivery.deliveryHours, "");
  assert.deepEqual(d.payment.methods.map((m) => m.label), ["WhatsApp"]);
  const stored = fake.db.settings[0];
  assert.equal(stored.delivery.localFee, null); assert.equal(stored.delivery.freeDeliveryMinOrder, null);
  assert.deepEqual(stored.couriers, []); assert.equal(stored.payment.codEnabled, false);
});

test("public settings expose ONLY safe fields: no couriers, fees, revision, audit or internal ids", async () => {
  const { admin } = setup();
  await call("put", "/", { user: admin, body: {
    couriers: [{ id: "cccccccc11", name: "Secret Courier", enabled: true, coverage: "internal coverage", fee: 321, feeNotes: "internal notes", codSupported: true, notes: "private" }],
    delivery: { enabled: true, localEnabled: true, localFee: 40, freeDeliveryMinOrder: 900, deliveryHours: "10-6", notes: "Public note", areas: [
      { name: "Local", type: "local" }, { name: "Far", type: "paid", courierId: "cccccccc11" }, { name: "Nope", type: "unsupported", message: "Not here" }, { name: "Hidden", type: "local", enabled: false }] },
  } });
  const res = await call("get", "/public");
  const json = JSON.stringify(res.body);
  for (const secret of ["Secret Courier", "internal coverage", "321", "internal notes", "private", "revision", "updatedBy", "cccccccc11", "courierId", "localFee", "Hidden"]) {
    assert.ok(!json.includes(secret), `public payload must not contain "${secret}"`);
  }
  const areas = res.body.data.delivery.areas;
  assert.deepEqual(areas.map((a) => a.name), ["Local", "Far", "Nope"]);
  assert.deepEqual(areas.map((a) => a.available), [true, true, false]);
  assert.equal(areas[2].message, "Not here");
  assert.deepEqual(Object.keys(areas[0]).sort(), ["available", "id", "message", "minOrder", "name", "type"]);
});

test("public settings: delivery switched off hides the areas and says so; hours only when enabled", async () => {
  const { admin } = setup();
  await call("put", "/", { user: admin, body: { delivery: { enabled: false, areas: [{ name: "Local", type: "local" }] } } });
  const d = (await call("get", "/public")).body.data;
  assert.equal(d.delivery.enabled, false); assert.deepEqual(d.delivery.areas, []);
});

test("admin GET: unauthenticated 401, customer 403, deactivated admin 401, admin 200 with full settings", async () => {
  const { admin, customer } = setup();
  assert.equal((await call("get", "/")).statusCode, 401);
  assert.equal((await call("get", "/", { headers: { authorization: "Bearer garbage" } })).statusCode, 401);
  assert.equal((await call("get", "/", { user: customer })).statusCode, 403);
  const off = fake.addUser({ role: "admin", isActive: false });
  assert.equal((await call("get", "/", { user: off })).statusCode, 401);
  const res = await call("get", "/", { user: admin });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.data.couriers)); assert.equal(res.body.data.revision, 0);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("PUT: unauthenticated and non-admin users can NEVER modify settings", async () => {
  const { customer } = setup();
  await call("get", "/public"); // create doc
  const before = JSON.stringify(fake.db.settings[0]);
  const attempt = { business: { ...validBusiness, name: "HACKED" } };
  assert.equal((await call("put", "/", { body: attempt })).statusCode, 401);
  assert.equal((await call("put", "/", { user: customer, body: attempt })).statusCode, 403);
  assert.equal(JSON.stringify(fake.db.settings[0]), before, "settings must be untouched");
  // the customer role cannot be escalated through the body either
  assert.equal((await call("put", "/", { user: customer, body: { ...attempt, role: "admin" } })).statusCode, 403);
});

test("PUT: admin saves valid settings - persisted, revision bumped, audit user recorded, visible publicly", async () => {
  const { admin } = setup();
  const res = await call("put", "/", { user: admin, body: { business: validBusiness, social: { facebook: "", instagram: "https://www.instagram.com/newshop", tiktok: "" },
    hours: { enabled: true, days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => ({ day, closed: day === "sunday", open: "09:00", close: "18:00" })) },
    payment: { whatsappEnabled: true, codEnabled: true } } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.revision, 1); assert.equal(res.body.data.business.whatsappNumber, "9779800000001");
  const stored = fake.db.settings[0];
  assert.equal(stored.business.name, "UniMart"); assert.equal(stored.updatedBy, admin._id); assert.equal(stored.revision, 1);
  const pub = (await call("get", "/public")).body.data;
  assert.equal(pub.business.address, "New shop address, Butwal");
  assert.equal(pub.social.facebook, ""); assert.equal(pub.social.instagram, "https://www.instagram.com/newshop");
  assert.equal(pub.hours.enabled, true); assert.equal(pub.hours.days.length, 7);
  assert.deepEqual(pub.payment.methods.map((m) => m.code), ["whatsapp", "cod"]);
});

test("PUT: omitted sections are left exactly as they were", async () => {
  const { admin } = setup();
  await call("put", "/", { user: admin, body: { delivery: { enabled: true, areas: [{ name: "Local", type: "local" }] } } });
  const before = JSON.stringify(fake.db.settings[0].delivery);
  await call("put", "/", { user: admin, body: { business: validBusiness } });
  assert.equal(JSON.stringify(fake.db.settings[0].delivery), before);
});

test("PUT: invalid settings are rejected with per-field errors and NOTHING is saved", async () => {
  const { admin } = setup();
  await call("get", "/public");
  const before = JSON.stringify(fake.db.settings[0]);
  const res = await call("put", "/", { user: admin, body: {
    business: { ...validBusiness, mapUrl: "javascript:alert(1)", email: "nope" },
    delivery: { enabled: true, areas: [{ name: "A", type: "paid" }, { name: "B", type: "paid", fee: -3 }] },
    payment: { whatsappEnabled: false, codEnabled: false },
  } });
  assert.equal(res.statusCode, 400);
  for (const path of ["business.mapUrl", "business.email", "delivery.areas.0.fee", "delivery.areas.1.fee", "payment.whatsappEnabled"]) assert.ok(res.body.errors[path], path);
  assert.equal(JSON.stringify(fake.db.settings[0]), before);
  assert.equal((await call("put", "/", { user: admin, body: {} })).statusCode, 400);
  assert.equal((await call("put", "/", { user: admin, body: "text" })).statusCode, 400);
});

test("PUT: stale form (old revision) gets 409 and cannot overwrite newer changes", async () => {
  const { admin } = setup();
  const first = await call("put", "/", { user: admin, body: { business: { ...validBusiness, name: "Version A" }, revision: 0 } });
  assert.equal(first.statusCode, 200);
  const stale = await call("put", "/", { user: admin, body: { business: { ...validBusiness, name: "Stale overwrite" }, revision: 0 } });
  assert.equal(stale.statusCode, 409); assert.match(stale.body.message, /changed by someone else/);
  assert.equal(fake.db.settings[0].business.name, "Version A");
  assert.equal((await call("put", "/", { user: admin, body: { business: { ...validBusiness, name: "Version B" }, revision: 1 } })).statusCode, 200);
});

test("PUT: mass-assignment attempts (key, revision, updatedBy, secrets, unknown sections) are ignored", async () => {
  const { admin } = setup();
  await call("put", "/", { user: admin, body: { business: { ...validBusiness, key: "x", updatedBy: "someone" }, key: "hijack", updatedBy: "someone", JWT_SECRET: "leak", MONGO_URI: "leak", whatsappAccessToken: "leak" } });
  const stored = fake.db.settings[0];
  assert.equal(stored.key, "business"); assert.equal(stored.updatedBy, admin._id);
  assert.ok(!JSON.stringify(stored).includes("leak"));
  assert.deepEqual(Object.keys(stored).sort(), ["business", "couriers", "delivery", "hours", "key", "payment", "revision", "social", "updatedBy"].filter((k) => k in stored).sort());
});

test("legacy/partial settings documents are completed with defaults (nothing undefined)", async () => {
  const { admin } = setup();
  fake.setSettings({ business: { name: "Old Name" } }); // saved before newer sections existed
  const pub = (await call("get", "/public")).body.data;
  assert.equal(pub.business.name, "Old Name"); assert.equal(pub.business.whatsappNumber, "9779700013011");
  assert.deepEqual(pub.delivery.areas, []); assert.deepEqual(pub.payment.methods.map((m) => m.label), ["WhatsApp"]);
  const adminView = (await call("get", "/", { user: admin })).body.data;
  assert.equal(adminView.hours.days.length, 7); assert.deepEqual(adminView.couriers, []);
  assert.doesNotMatch(JSON.stringify(pub), /undefined|null,"null"/);
});

test("settings never store or expose environment secrets", async () => {
  const { admin } = setup();
  const json = JSON.stringify((await call("get", "/", { user: admin })).body) + JSON.stringify(fake.db.settings);
  for (const word of ["JWT_SECRET", "MONGO_URI", "CLOUDINARY", "ACCESS_TOKEN", "password"]) assert.ok(!json.includes(word), word);
});

test("first-ever requests arriving together create ONE settings document (race-safe)", async () => {
  setup();
  const results = await Promise.all([call("get", "/public"), call("get", "/public"), call("get", "/public")]);
  assert.ok(results.every((r) => r.statusCode === 200));
  assert.equal(fake.db.settings.length, 1);
});
