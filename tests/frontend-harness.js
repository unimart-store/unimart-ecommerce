/**
 * Tiny browser stand-in for testing the REAL storefront scripts with node:test
 * (no jsdom / no npm install needed). Loads the actual files from frontend/js
 * into a vm sandbox with stubbed DOM/window/localStorage/AuthState/CartService.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FRONTEND = path.join(__dirname, "..", "frontend", "js");
const read = (rel) => fs.readFileSync(path.join(FRONTEND, rel), "utf8").replace(/\r/g, "");

const makeEl = (id) => {
  const listeners = {};
  const el = {
    id, textContent: "", value: "", disabled: false, dataset: {}, href: "", style: {}, innerHTML: "",
    _classes: new Set(),
    classList: {
      add: (c) => el._classes.add(c), remove: (c) => el._classes.delete(c),
      toggle: (c, force) => { const on = force === undefined ? !el._classes.has(c) : force; on ? el._classes.add(c) : el._classes.delete(c); },
      contains: (c) => el._classes.has(c),
    },
    addEventListener: (t, fn) => (listeners[t] ||= []).push(fn),
    focus() {},
    async click() { for (const fn of listeners.click || []) await fn(); },
  };
  return el;
};

// opts: { search, loggedIn, serverCart: [{product:{...}, quantity}], authDelayMs, guestCart, products, cartFailure }
const createStorefront = (opts = {}) => {
  const els = {};
  const getEl = (id) => (els[id] ||= makeEl(id));
  const storage = new Map(Object.entries(opts.guestCart ? { unimart_guest_cart: JSON.stringify(opts.guestCart) } : {}));
  const nav = [];
  const toasts = [];
  const calls = { addItem: [], getCart: 0, order: [] };
  const state = { loggedIn: false, authReady: !opts.authDelayMs, domReady: null };
  const server = { cart: (opts.serverCart || []).map((i) => ({ ...i })) };
  const products = opts.products || {};

  const AuthState = {
    initialized: false,
    isLoggedIn: () => state.loggedIn,
    getUser: () => (state.loggedIn ? { name: "Ram", phone: "9812345678" } : null),
    init() {
      return (this._p ||= new Promise((resolve) => setTimeout(() => {
        state.loggedIn = Boolean(opts.loggedIn); state.authReady = true; this.initialized = true; resolve();
      }, opts.authDelayMs || 0)));
    },
  };

  const CartService = {
    getCart: async () => {
      calls.getCart++;
      if (opts.cartFailure) throw { message: "network" };
      return server.cart.map((i) => ({ ...i, available: true }));
    },
    addItem: async (productId, quantity) => {
      calls.addItem.push([productId, quantity]);
      const p = products[productId];
      const existing = server.cart.find((i) => i.product._id === productId);
      const wanted = (existing ? existing.quantity : 0) + quantity;
      if (p && wanted > p.stockQuantity) throw { message: p.stockQuantity > 0 ? `Only ${p.stockQuantity} in stock` : "This product is out of stock" };
      if (existing) existing.quantity = wanted; else server.cart.push({ product: p || { _id: productId }, quantity });
      return server.cart.map((i) => ({ ...i, available: true }));
    },
    updateItemQuantity: async () => server.cart, removeItem: async () => server.cart, clearCart: async () => { server.cart = []; return []; },
    syncCart: async () => {},
  };

  const sandbox = {
    console, URLSearchParams, setTimeout, clearTimeout, Promise, JSON, Math, Number, Date, Object, Array, Set, Map, Intl,
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    sessionStorage: opts.sessionStorage || (() => { const s = new Map(); return { getItem: (k) => (s.has(k) ? s.get(k) : null), setItem: (k, v) => s.set(k, String(v)), removeItem: (k) => s.delete(k) }; })(),
    document: {
      getElementById: getEl, querySelector: () => null, title: "",
      addEventListener: (t, fn) => { if (t === "DOMContentLoaded") state.domReady = fn; },
    },
    Normalize: { getImageUrl: () => "img", getCategorySlug: () => null, product: (p) => ({ ...p, imageUrl: "img" }) },
    AuthState, CartService,
    ProductService: { getProductById: async (id) => products[id] || null, getProducts: async () => ({ data: [] }) },
    CheckoutService: { placeOrder: async (contact, items, key) => { calls.order.push({ contact, items, key }); return opts.orderResult ? opts.orderResult(contact, items, key) : { _id: "o1", orderId: "ORD-1", totalAmount: 100 }; } },
  };
  sandbox.window = {
    location: { search: opts.search || "", get href() { return ""; }, set href(v) { nav.push(v); }, hostname: "example.com", pathname: "/" },
    showToast: (m) => toasts.push(m), updateCartBadge() {}, AuthState, CartService, Normalize: sandbox.Normalize,
    crypto: { randomUUID: (() => { let n = 0; return () => `11111111-2222-4333-8444-${String(++n).padStart(12, "0")}`; })() },
  };
  sandbox.crypto = sandbox.window.crypto;
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);

  const load = (rel) => vm.runInContext(read(rel) + `\n;this.__last = typeof CartState !== "undefined" ? 1 : 0;`, sandbox, { filename: rel });
  return { sandbox, els, getEl, nav, toasts, calls, state, server, storage, load, run: (code) => vm.runInContext(code, sandbox) };
};

module.exports = { createStorefront, read, FRONTEND };
