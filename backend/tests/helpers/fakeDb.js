/**
 * Minimal in-memory stand-in for Mongoose + the Order/Product/Cart models,
 * used ONLY by the controller tests (no MongoDB is available in CI-less dev).
 *
 * What it models:  transactions with rollback on throw, commits serialised one
 *                  at a time, the unique (scope,key) index, $set/$inc/$in/$gte,
 *                  toJSON stripping of internal fields.
 * What it does NOT model: real MongoDB snapshot isolation / WriteConflict
 *                  retries. Those paths need a real (replica-set) database -
 *                  see scripts/phase1-smoke.js.
 */
const Module = require("module");

const clone = (o) => JSON.parse(JSON.stringify(o));
let seq = 0;
const nextId = () => (++seq).toString(16).padStart(24, "0");

const db = { products: [], orders: [], carts: [], settings: [], users: [] };
const control = { hideKeyLookups: 0, failNextOrderSave: false };

const matches = (doc, filter) =>
  Object.entries(filter).every(([k, cond]) => {
    const val = doc[k];
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("$in" in cond) return cond.$in.map(String).includes(String(val));
      if ("$gte" in cond) return val >= cond.$gte;
      if ("$type" in cond) return typeof val === "string";
      return false;
    }
    return String(val) === String(cond);
  });

const applyUpdate = (doc, update) => {
  if (update.$set) Object.assign(doc, clone(update.$set));
  if (update.$inc) for (const [k, n] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + n;
};

const hydrate = (plain, kind) => {
  if (!plain) return null;
  const doc = clone(plain);
  if (kind === "order") {
    doc.toJSON = () => {
      const { toJSON, toObject, ...rest } = doc;
      delete rest.idempotencyScope;
      delete rest.idempotencyFingerprint;
      return rest;
    };
  }
  return doc;
};

class Query {
  constructor(exec) { this.exec = exec; }
  session() { return this; }
  select() { return this; }
  lean() { return this; }
  then(res, rej) { return Promise.resolve().then(this.exec).then(res, rej); }
}

const model = (collection, kind) => ({
  findOne: (filter) =>
    new Query(async () => {
      if (kind === "order" && "idempotencyKey" in filter && control.hideKeyLookups > 0) {
        control.hideKeyLookups -= 1;
        return null;
      }
      return hydrate(db[collection].find((d) => matches(d, filter)), kind);
    }),
  findById: (id) => new Query(async () => hydrate(db[collection].find((d) => String(d._id) === String(id)), kind)),
  findOneAndUpdate: async (filter, update) => {
    const found = db[collection].find((d) => matches(d, filter));
    if (!found) return null;
    applyUpdate(found, update);
    return hydrate(found, kind);
  },
  updateOne: async (filter, update) => {
    const found = db[collection].find((d) => matches(d, filter));
    if (found) applyUpdate(found, update);
  },
  bulkWrite: async (ops) => {
    for (const { updateOne } of ops) {
      const found = db[collection].find((d) => matches(d, updateOne.filter));
      if (found) applyUpdate(found, updateOne.update);
    }
  },
});

const Product = model("products", "product");
const Cart = model("carts", "cart");
const Order = model("orders", "order");
const User = model("users", "user");

// Settings singleton: findOne(...).lean() and upsert-capable findOneAndUpdate.
const Settings = {
  create: async (doc) => {
    if (db.settings.some((d) => d.key === doc.key)) throw Object.assign(new Error("E11000 duplicate key error ... key"), { code: 11000 });
    const stored = clone(doc);
    db.settings.push(stored);
    return { toObject: () => clone(stored) };
  },
  findOne: (filter) => new Query(async () => {
    const found = db.settings.find((d) => matches(d, filter));
    return found ? clone(found) : null;
  }),
  findOneAndUpdate: async (filter, update, opts = {}) => {
    let found = db.settings.find((d) => matches(d, filter));
    if (!found) {
      if (!opts.upsert) return null;
      found = clone({ ...(update.$setOnInsert || {}) });
      db.settings.push(found);
    }
    applyUpdate(found, update);
    return clone(found);
  },
};

// `new Order({...}).save({session})`
const OrderCtor = function (doc) {
  Object.assign(this, { _id: nextId(), status: "Pending", paymentStatus: "Unpaid", source: "website",
    orderId: "ORD-" + nextId().slice(-8), ...doc });
  this.save = async () => {
    if (control.failNextOrderSave) { control.failNextOrderSave = false; throw new Error("boom: unexpected DB failure"); }
    if (typeof this.idempotencyKey === "string") {
      const dup = db.orders.find((o) => o.idempotencyScope === this.idempotencyScope && o.idempotencyKey === this.idempotencyKey);
      if (dup) throw Object.assign(new Error("E11000 duplicate key error ... idempotencyKey"), { code: 11000, keyPattern: { idempotencyScope: 1, idempotencyKey: 1 } });
    }
    const plain = {};
    for (const [k, v] of Object.entries(this)) if (typeof v !== "function" && v !== undefined) plain[k] = v;
    db.orders.push(clone(plain));
  };
  this.toJSON = () => {
    const plain = {};
    for (const [k, v] of Object.entries(this)) if (typeof v !== "function" && v !== undefined) plain[k] = v;
    delete plain.idempotencyScope; delete plain.idempotencyFingerprint;
    return plain;
  };
};
Object.assign(OrderCtor, Order);

// Commits are serialised (stand-in for isolation); a throw rolls everything back.
let chain = Promise.resolve();
const mongoose = {
  Types: { ObjectId: { isValid: (id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id) } },
  startSession: async () => ({
    withTransaction(fn) {
      const run = chain.then(async () => {
        const snapshot = clone(db);
        try { await fn(); }
        catch (err) { db.products = snapshot.products; db.orders = snapshot.orders; db.carts = snapshot.carts; throw err; }
      });
      chain = run.catch(() => {});
      return run;
    },
    endSession() {},
  }),
};

const install = () => {
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "mongoose") return mongoose;
    if (/models\/Order$/.test(request)) return OrderCtor;
    if (/models\/Product$/.test(request)) return Product;
    if (/models\/Cart$/.test(request)) return Cart;
    if (/models\/Settings$/.test(request)) return Settings;
    if (/models\/User$/.test(request)) return User;
    if (request === "jsonwebtoken") return { verify: (token) => { if (!String(token).startsWith("valid:")) throw new Error("bad token"); return { id: String(token).slice(6) }; } };
    if (request === "express-rate-limit") return () => (req, res, next) => next && next();
    if (request === "express") return { Router: () => makeRouter() };
    return orig.call(this, request, ...rest);
  };
  return () => { Module._load = orig; };
};

// Records route registrations so tests can run the REAL middleware chain.
const makeRouter = () => {
  const routes = [];
  const add = (method) => (path, ...handlers) => routes.push({ method, path, handlers });
  return { routes, get: add("get"), post: add("post"), put: add("put"), patch: add("patch"), delete: add("delete"), use() {} };
};

// Runs a registered route's handler chain (middleware + controller) like Express would.
const runRoute = async (router, method, path, req) => {
  const route = router.routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  const res = makeRes();
  req.cookies = req.cookies || {}; req.headers = req.headers || {};
  res.set = function (k, v) { (this.headers ||= {})[k] = v; return this; };
  let err;
  for (const handler of route.handlers) {
    let advanced = false;
    await handler(req, res, (e) => { advanced = true; if (e) err = e; });
    if (err) throw err;
    if (!advanced) break; // handler ended the response
  }
  return res;
};

const addUser = (u) => { const doc = { _id: nextId(), isActive: true, role: "customer", ...u }; db.users.push(doc); return doc; };
const bearer = (user) => ({ authorization: "Bearer valid:" + user._id });

const reset = () => { db.products.length = 0; db.orders.length = 0; db.carts.length = 0; db.settings.length = 0; db.users.length = 0; control.hideKeyLookups = 0; control.failNextOrderSave = false; };
const addProduct = (p) => { const doc = { _id: nextId(), name: "Item", price: 100, stockQuantity: 10, status: "active", ...p }; db.products.push(doc); return doc._id; };
const stockOf = (id) => db.products.find((p) => p._id === id).stockQuantity;

const makeRes = () => ({ statusCode: 200, body: undefined, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = JSON.parse(JSON.stringify(b)); return this; } });

// Seeds a settings document (deep-merged over nothing: pass full sections you care about).
const setSettings = (doc) => { db.settings.length = 0; db.settings.push({ key: "business", revision: 0, ...clone(doc) }); };

module.exports = { db, control, install, reset, addProduct, stockOf, makeRes, nextId, runRoute, addUser, bearer, setSettings };
