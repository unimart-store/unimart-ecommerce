const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { TRANSITIONS, ORDER_STATUSES } = require("../backend/utils/orderStatus");

const load = (rel, extra = {}) => {
  const sandbox = { console, Intl, Number, JSON, Object, Array, Set, String, ...extra };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "admin", "js", rel), "utf8").replace(/\r/g, ""), sandbox);
  return sandbox;
};

test("admin dropdown transitions are identical to the backend rules (guards the mirrored copy against drift)", () => {
  const sb = load("services/orderService.js", { AdminApiClient: {}, AdminConfig: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(sb.ADMIN_ORDER_STATUSES)), ORDER_STATUSES);
  assert.deepEqual(JSON.parse(JSON.stringify(sb.ADMIN_ORDER_TRANSITIONS)), JSON.parse(JSON.stringify(TRANSITIONS)));
});

test("admin currency is NPR everywhere (no INR / rupee sign)", () => {
  const sb = load("utils/format.js");
  const money = vm.runInContext("AdminFormat", sb).currency;
  assert.equal(money(1500), "NPR 1,500");
  assert.equal(money(125000), "NPR 1,25,000");
  assert.equal(money(99.5), "NPR 99.5");
  assert.equal(money("abc"), "—");
  assert.doesNotMatch(money(1500), /₹|INR/);
});

test("no INR / rupee-sign / 'Rs.' / support@unimart.com left anywhere in shipped storefront or admin code", () => {
  const roots = ["frontend", "admin"].map((r) => path.join(__dirname, "..", r));
  const offenders = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== "node_modules" && f.name !== "assets") walk(full); continue; }
      if (!/\.(js|html)$/.test(f.name) || /backup/i.test(f.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      text.split("\n").forEach((line, i) => {
        if (/₹|\bINR\b|\bRs\.|formatINR|en-NP|support@unimart\.com/.test(line) && !/CURRENCY\.label|e\.g\. "Rs\."/.test(line)) offenders.push(`${path.relative(path.join(__dirname, ".."), full)}:${i + 1}`);
      });
    }
  };
  roots.forEach(walk);
  assert.deepEqual(offenders, []);
});

test("WhatsApp number is defined once in the frontend JS (config.js), not hard-coded in page scripts", () => {
  const dir = path.join(__dirname, "..", "frontend", "js");
  const hits = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((f) => {
    const full = path.join(d, f.name);
    if (f.isDirectory()) return walk(full);
    if (/backup/i.test(f.name) || !f.name.endsWith(".js")) return;
    if (/9779700013011|9700013011/.test(fs.readFileSync(full, "utf8"))) hits.push(f.name);
  });
  walk(dir);
  assert.deepEqual(hits, ["config.js"]);
});
