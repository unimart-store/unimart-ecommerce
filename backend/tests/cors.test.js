const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAllowedOrigins, isAllowedOrigin } = require("../utils/cors");

const allowedOrigins = parseAllowedOrigins("https://unimartstore.vercel.app/, https://unimart-admin-panel.vercel.app");

test("parseAllowedOrigins trims and strips trailing slashes", () => {
  assert.deepEqual(allowedOrigins, ["https://unimartstore.vercel.app", "https://unimart-admin-panel.vercel.app"]);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(parseAllowedOrigins(" , ,"), []);
});

test("production: exact configured origins allowed", () => {
  for (const o of allowedOrigins) assert.equal(isAllowedOrigin(o, { allowedOrigins, isProduction: true }), true);
});

test("production: localhost is NOT allowed", () => {
  for (const o of ["http://localhost:5500", "http://127.0.0.1:5501", "http://localhost"]) {
    assert.equal(isAllowedOrigin(o, { allowedOrigins, isProduction: true }), false, o);
  }
});

test("development: exact localhost origins allowed", () => {
  for (const o of ["http://localhost:5500", "http://127.0.0.1:5501", "http://localhost", "https://localhost:3000"]) {
    assert.equal(isAllowedOrigin(o, { allowedOrigins, isProduction: false }), true, o);
  }
});

test("malicious origins containing 'localhost' or lookalikes are rejected in BOTH modes", () => {
  const evil = ["https://localhost.evil.com", "http://evil-localhost.com", "https://evil.com/localhost",
    "http://localhost.evil.com:5500", "http://127.0.0.1.evil.com", "http://localhost@evil.com",
    "https://unimartstore.vercel.app.evil.com", "https://evil.com?x=localhost", "http://localhost:5500.evil.com",
    "https://unimartstore.vercel.app/", "HTTPS://UNIMARTSTORE.VERCEL.APP", "null"];
  for (const isProduction of [true, false]) {
    for (const o of evil) assert.equal(isAllowedOrigin(o, { allowedOrigins, isProduction }), false, `${o} (prod=${isProduction})`);
  }
});

test("no Origin header (non-CORS request) passes; empty allowlist fails closed for browsers", () => {
  assert.equal(isAllowedOrigin(undefined, { allowedOrigins, isProduction: true }), true);
  assert.equal(isAllowedOrigin("https://unimartstore.vercel.app", { allowedOrigins: [], isProduction: true }), false);
});
