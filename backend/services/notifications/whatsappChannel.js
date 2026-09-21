/**
 * WhatsApp channel ADAPTER for notifications.
 *
 * The notification system has no WhatsApp client of its own. It talks to the
 * project's EXISTING WhatsApp service (official Meta Cloud API) through this
 * one file, so if that service's function names differ, THIS is the only file
 * to adjust.
 *
 * Contract expected from the existing service (first matching module/function wins):
 *   sendText(to, body)                          -> resolves on success, throws on failure
 *   sendTemplate(to, name, language, [params])  -> same (business-initiated messages)
 *   isWithinServiceWindow(to)                   -> boolean: is the customer-service (24h) window open?
 *   isConfigured()                              -> boolean: credentials present
 * `to` is digits with country code (no "+").
 *
 * Meta rules are respected, never bypassed: free-form text is sent ONLY if the
 * service confirms the 24h window is open; otherwise an approved template
 * (name configured by the owner in Admin -> Settings) is used; with neither,
 * the message is skipped rather than sent unlawfully.
 */
const MODULE_CANDIDATES = ["../whatsapp/whatsappMessageService", "../whatsapp/whatsappApi", "../whatsappService"];
const FN_NAMES = {
  text: ["sendTextMessage", "sendText", "sendMessage"],
  template: ["sendTemplateMessage", "sendTemplate"],
  window: ["isWithinServiceWindow", "isWithinCustomerServiceWindow", "isServiceWindowOpen"],
  configured: ["isConfigured", "isWhatsAppConfigured", "isEnabled"],
};

const SEND_TIMEOUT_MS = 10000;
const RETRYABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "ENOTFOUND", "EAI_AGAIN", "EPIPE"]);

let cached; // resolved once per process

const pick = (mod, names) => {
  for (const name of names) if (mod && typeof mod[name] === "function") return mod[name].bind(mod);
  return null;
};

const resolveTransport = () => {
  if (cached !== undefined) return cached;
  cached = null;
  for (const path of MODULE_CANDIDATES) {
    let mod;
    try {
      mod = require(path);
    } catch (error) {
      // The candidate simply isn't there: try the next one. Anything else (a
      // syntax error or missing dependency INSIDE an existing service) is logged.
      if (error && error.code === "MODULE_NOT_FOUND" && String(error.message).includes(path)) continue;
      console.error(`[notifications] WhatsApp service "${path}" failed to load: ${String(error && error.message).slice(0, 120)}`);
      continue;
    }
    const sendText = pick(mod, FN_NAMES.text);
    const sendTemplate = pick(mod, FN_NAMES.template);
    if (sendText || sendTemplate) {
      cached = { sendText, sendTemplate, inWindow: pick(mod, FN_NAMES.window), isConfigured: pick(mod, FN_NAMES.configured) };
      break;
    }
  }
  return cached;
};

const withTimeout = (promise) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("WhatsApp request timed out"), { code: "ETIMEDOUT" })), SEND_TIMEOUT_MS).unref())]);

const classify = (error) => {
  const status = error && (error.status || error.statusCode || (error.response && error.response.status));
  const retryable = status === 429 || status >= 500 || RETRYABLE_CODES.has(error && error.code) || (error && error.retryable === true);
  // Short, token-free reason: status/code + a trimmed message.
  const raw = `${status || (error && error.code) || "error"}: ${String((error && error.message) || "failed").slice(0, 120)}`;
  return { retryable: Boolean(retryable), reason: raw.replace(/Bearer\s+\S+/gi, "[redacted]").replace(/[A-Za-z0-9_-]{30,}/g, "[redacted]") };
};

/** Is there a usable WhatsApp service at all? */
const isAvailable = () => {
  const t = resolveTransport();
  if (!t) return false;
  if (t.isConfigured) {
    try { return Boolean(t.isConfigured()); } catch (e) { return false; }
  }
  return true;
};

/**
 * @param {{to:string, text:string, template?:{name:string, language:string}, templateParams?:string[]}} m
 * @returns {Promise<{status:'sent'|'skipped'|'failed'|'disabled', reason?:string, retryable?:boolean}>}
 */
const send = async ({ to, text, template, templateParams = [] }) => {
  const t = resolveTransport();
  if (!t || !isAvailable()) return { status: "disabled", reason: "whatsapp service not available or not configured" };

  try {
    // 1) Free-form only inside the customer-service window (confirmed by the service itself).
    let windowOpen = false;
    if (t.sendText && t.inWindow) windowOpen = Boolean(await withTimeout(Promise.resolve(t.inWindow(to))));
    if (windowOpen) {
      await withTimeout(Promise.resolve(t.sendText(to, text)));
      return { status: "sent" };
    }
    // 2) Otherwise an owner-approved template.
    if (t.sendTemplate && template && template.name) {
      await withTimeout(Promise.resolve(t.sendTemplate(to, template.name, template.language || "en", templateParams)));
      return { status: "sent" };
    }
    // 3) Neither is permitted: do not send.
    return { status: "skipped", reason: "outside the 24h window and no approved template configured" };
  } catch (error) {
    const { retryable, reason } = classify(error);
    return { status: "failed", reason, retryable };
  }
};

module.exports = { send, isAvailable, classify, _resetForTests: () => { cached = undefined; } };
