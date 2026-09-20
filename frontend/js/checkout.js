/**
 * UNiMART — Checkout page (pages/checkout.html).
 * Calls CheckoutService (POST /api/checkout) only. No price, delivery fee or
 * total is ever computed here for submission - what the customer sees comes
 * from the SERVER's quote (POST /api/delivery/quote), and the server
 * recalculates everything again when the order is placed.
 *
 * Order success is determined ENTIRELY by the backend response. WhatsApp is
 * an optional follow-up action offered after success, never a precondition
 * for the order being considered placed.
 *
 * Validation here is a convenience for the customer (instant feedback). The
 * BACKEND validates everything again and is the only thing that counts - a
 * request that skips this page gets exactly the same checks.
 *
 * Duplicate protection: each intentional checkout attempt gets one random
 * idempotency key. Retrying the SAME attempt (double-tap, refresh, timeout,
 * flaky network) re-sends the SAME key, and the server returns the order it
 * already created instead of making a second one.
 *
 * Owner-managed settings (delivery areas, payment options) come from
 * SiteSettings. If they can't be loaded, the page behaves exactly as before:
 * one payment option, no area picker, delivery "To be confirmed".
 */
const formatNPR = (amount) => UniMartConfig.formatPrice(amount);

const escapeText = (value) =>
  String(value === undefined || value === null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let cartItemsCache = [];
let isSubmitting = false;

// ---- Delivery / pricing state (all display-only; the server decides) ----
let publicSettings = null; // owner-managed public settings, or null if unavailable
let selectedAreaId = "";
let currentQuote = null; // last SERVER quote, or null (no quote / request failed)
let quoteLoading = false;
let quoteSeq = 0; // ignores out-of-order quote responses
let deliveryBlocked = false; // delivery off, or the chosen area can't be delivered to

const areaSelectVisible = () => Boolean(publicSettings && publicSettings.delivery && publicSettings.delivery.enabled !== false && (publicSettings.delivery.areas || []).length > 0);

// ---- Price summary ----
function renderSummary() {
  const summaryBox = document.getElementById("priceSummary");
  const mobileTotal = document.getElementById("mobileTotalAmount");

  const localSubtotal = cartItemsCache.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const quote = currentQuote && currentQuote.deliverable ? currentQuote : null;

  // With a server quote the numbers are the server's. Without one (no rules
  // configured yet, quote unavailable, area not chosen) we show the cart's
  // items total and say delivery is still to be confirmed.
  const subtotal = quote ? quote.subtotal : localSubtotal;
  let deliveryHtml = '<span class="delivery-note">To be confirmed</span>';
  let total = subtotal;
  let totalLabel = "Items Total";
  let deliveryLabel = "Delivery Charges";

  if (quote && quote.delivery.mode !== "manual") {
    deliveryHtml = quote.delivery.fee === 0 ? '<span class="free">FREE</span>' : formatNPR(quote.delivery.fee);
    if (quote.delivery.areaName) deliveryLabel = `Delivery (${escapeText(quote.delivery.areaName)})`;
    total = quote.total;
    totalLabel = "Total Amount";
  } else if (currentQuote && currentQuote.deliverable === false && currentQuote.code !== "AREA_REQUIRED") {
    deliveryHtml = '<span class="delivery-note">Not available</span>';
  }

  if (summaryBox) {
    summaryBox.innerHTML = `
      <div class="summary-line"><span>Price (${cartItemsCache.length} items)</span><span>${formatNPR(subtotal)}</span></div>
      <div class="summary-line"><span>${deliveryLabel}</span><span>${deliveryHtml}</span></div>
      <hr>
      <div class="summary-line total"><span>${totalLabel}</span><span>${formatNPR(total)}</span></div>
    `;
  }
  if (mobileTotal) mobileTotal.textContent = formatNPR(total);
}

async function loadCart() {
  cartItemsCache = await CartState.getItems();
  if (cartItemsCache.length === 0) {
    window.location.href = "cart.html";
    return false;
  }
  return true;
}

// Guests price from the items they submit; logged-in users from their stored cart.
const itemsForServer = () =>
  AuthState.isLoggedIn() ? undefined : cartItemsCache.map((i) => ({ productId: i.productId, quantity: i.quantity }));

function setDeliveryMessage(message) {
  const notice = document.getElementById("deliveryNotice");
  const areaError = document.getElementById("errorArea");
  const areaSelect = document.getElementById("deliveryArea");
  if (areaSelectVisible() && areaError) {
    if (notice) notice.hidden = true;
    if (message) {
      areaSelect && areaSelect.classList.add("invalid");
      areaError.textContent = message;
      areaError.classList.add("show");
    } else {
      areaSelect && areaSelect.classList.remove("invalid");
      areaError.classList.remove("show");
    }
  } else if (notice) {
    notice.textContent = message || "";
    notice.hidden = !message;
  }
}

function updateActionState() {
  const disabled = isSubmitting || quoteLoading || deliveryBlocked;
  ["checkoutBtn", "mobileCheckoutBtn"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  });
}

// Turns the latest server quote (and the delivery on/off switch) into UI state.
function applyQuoteToUi() {
  deliveryBlocked = false;
  let message = "";

  if (publicSettings && publicSettings.delivery && publicSettings.delivery.enabled === false) {
    deliveryBlocked = true;
    message = "Delivery is currently unavailable. Please contact us to arrange your order.";
  } else if (currentQuote && currentQuote.deliverable === false && currentQuote.code !== "AREA_REQUIRED") {
    deliveryBlocked = true;
    message = currentQuote.message || "Delivery is not available for this area.";
  }

  setDeliveryMessage(message);
  renderSummary();
  updateActionState();
}

// Asks the server for the price + delivery for the chosen area. Display only:
// if it fails, checkout still works and the server prices the order itself.
async function refreshQuote() {
  if (!window.DeliveryService) {
    currentQuote = null;
    applyQuoteToUi();
    return;
  }
  const seq = ++quoteSeq;
  quoteLoading = true;
  updateActionState();
  try {
    const data = await DeliveryService.quote({ areaId: selectedAreaId || undefined, items: itemsForServer() });
    if (seq !== quoteSeq) return;
    currentQuote = data;
  } catch (error) {
    if (seq !== quoteSeq) return;
    currentQuote = null;
  }
  quoteLoading = false;
  applyQuoteToUi();
}

// ---- Delivery area picker (only when the owner has configured areas) ----
function renderAreaSelect() {
  const box = document.getElementById("deliveryAreaBox");
  const select = document.getElementById("deliveryArea");
  if (!box || !select) return;

  if (!areaSelectVisible()) {
    box.hidden = true;
    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select your delivery area";
  select.appendChild(placeholder);

  publicSettings.delivery.areas.forEach((area) => {
    const option = document.createElement("option");
    option.value = area.id;
    option.textContent = area.available ? area.name : `${area.name} (unavailable)`;
    select.appendChild(option);
  });

  select.addEventListener("change", () => {
    selectedAreaId = select.value;
    select.classList.remove("invalid");
    document.getElementById("errorArea")?.classList.remove("show");
    refreshQuote();
  });
  box.hidden = false;
}

// ---- Payment options (only methods the owner currently accepts) ----
const PAYMENT_UI = {
  whatsapp: { title: "WhatsApp Order", note: "Confirm & Pay manually on WhatsApp", icon: "fa-brands fa-whatsapp whatsapp-icon" },
  cod: { title: "Cash on Delivery", note: "Pay when your order arrives", icon: "fa-solid fa-money-bill-wave whatsapp-icon" },
};

function renderPaymentOptions() {
  const container = document.getElementById("paymentOptions");
  const methods = publicSettings && publicSettings.payment && publicSettings.payment.methods;
  if (!container || !Array.isArray(methods) || methods.length === 0) return; // keep the built-in markup

  const keepDisabled = container.querySelector && container.querySelector(".payment-card-option.disabled");
  container.innerHTML = "";

  methods.forEach((method, index) => {
    const ui = PAYMENT_UI[method.code];
    if (!ui) return;
    const label = document.createElement("label");
    label.className = "payment-card-option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "payment";
    input.value = method.code;
    input.dataset.method = method.label;
    if (index === 0) input.checked = true;

    const info = document.createElement("div");
    info.className = "pay-info";
    const strong = document.createElement("strong");
    strong.textContent = ui.title;
    const note = document.createElement("p");
    note.textContent = ui.note;
    info.appendChild(strong);
    info.appendChild(note);

    const icon = document.createElement("i");
    icon.className = ui.icon;

    label.appendChild(input);
    label.appendChild(info);
    label.appendChild(icon);
    container.appendChild(label);
  });

  if (keepDisabled) container.appendChild(keepDisabled);
}

// What the customer picked. The built-in fallback markup has one option: WhatsApp.
function getSelectedPaymentMethod() {
  const checked = document.querySelector('input[name="payment"]:checked');
  return (checked && checked.dataset && checked.dataset.method) || "WhatsApp";
}

// Pre-fills what the account already reliably has (name, phone) for a
// logged-in customer - address is never pre-filled, since it isn't part of
// the current User model. The customer can still edit any field.
function prefillFromAccount() {
  if (!AuthState.isLoggedIn()) return;
  const user = AuthState.getUser();
  const nameEl = document.getElementById("userName");
  const phoneEl = document.getElementById("userPhone");
  if (nameEl && user.name && !nameEl.value) nameEl.value = user.name;
  if (phoneEl && user.phone && !phoneEl.value) phoneEl.value = user.phone;
}

// ---- Client-side format checks (mirror of the backend rules, NOT a substitute) ----

// Nepal mobile: 10 digits, starting 9 + (6|7|8). Accepts 98XXXXXXXX,
// +977 98XXXXXXXX, 977 98XXXXXXXX and 00977 98XXXXXXXX (spaces/dashes ok).
// This checks FORMAT only - it cannot prove the customer owns the number.
function normalizeNepalMobile(raw) {
  let digits = String(raw || "").trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;
  if (digits.startsWith("+977")) digits = digits.slice(4);
  else if (digits.startsWith("00977")) digits = digits.slice(5);
  else if (digits.startsWith("977") && digits.length === 13) digits = digits.slice(3);
  if (!/^9[6-8]\d{8}$/.test(digits)) return null;
  if (/^(\d)\1{6}$/.test(digits.slice(3))) return null;
  return "+977" + digits;
}

function looksLikeName(name) {
  const letters = (name.match(/\p{L}/gu) || []).length;
  return letters >= 2 && /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(name);
}

function looksLikeAddress(address) {
  const words = address.split(/[\s,;/-]+/).filter(Boolean);
  return address.length >= 10 && words.length >= 2 && (address.match(/\p{L}/gu) || []).length >= 5;
}

// ---- Inline field validation ----
function setFieldError(inputEl, errorEl, message) {
  inputEl.classList.add("invalid");
  errorEl.textContent = message;
  errorEl.classList.add("show");
}

function clearFieldError(inputEl, errorEl) {
  inputEl.classList.remove("invalid");
  errorEl.classList.remove("show");
}

// Clears a field's invalid state as soon as the customer starts fixing it.
function wireLiveValidationClear(inputEl, errorEl) {
  inputEl.addEventListener("input", () => clearFieldError(inputEl, errorEl));
}

// Returns {valid, values} - validates all fields, applies inline errors, and
// focuses the first invalid field, per the required UX.
function validateForm() {
  const nameEl = document.getElementById("userName");
  const phoneEl = document.getElementById("userPhone");
  const addressEl = document.getElementById("userAddress");
  const nameError = document.getElementById("errorName");
  const phoneError = document.getElementById("errorPhone");
  const addressError = document.getElementById("errorAddress");

  [[nameEl, nameError], [phoneEl, phoneError], [addressEl, addressError]].forEach(
    ([el, errEl]) => clearFieldError(el, errEl)
  );

  const name = nameEl.value.replace(/\s+/g, " ").trim();
  const phone = phoneEl.value.trim();
  const address = addressEl.value.replace(/\s+/g, " ").trim();

  let firstInvalid = null;

  if (!name) {
    setFieldError(nameEl, nameError, "Please enter your full name");
    firstInvalid = firstInvalid || nameEl;
  } else if (!looksLikeName(name)) {
    setFieldError(nameEl, nameError, "Please enter your real name (letters only)");
    firstInvalid = firstInvalid || nameEl;
  }
  if (!normalizeNepalMobile(phone)) {
    setFieldError(phoneEl, phoneError, "Enter a valid Nepal mobile number (e.g. 98XXXXXXXX)");
    firstInvalid = firstInvalid || phoneEl;
  }
  if (!address) {
    setFieldError(addressEl, addressError, "Please enter your delivery address");
    firstInvalid = firstInvalid || addressEl;
  } else if (!looksLikeAddress(address)) {
    setFieldError(addressEl, addressError, "Please enter a more complete address (area, ward, landmark)");
    firstInvalid = firstInvalid || addressEl;
  }

  if (areaSelectVisible() && !selectedAreaId) {
    const areaEl = document.getElementById("deliveryArea");
    const areaError = document.getElementById("errorArea");
    if (areaEl && areaError) {
      setFieldError(areaEl, areaError, "Please select your delivery area");
      firstInvalid = firstInvalid || areaEl;
    }
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return { valid: false };
  }

  return { valid: true, values: { name, phone, address, areaId: selectedAreaId, payment: getSelectedPaymentMethod() } };
}

// The backend replies {errors: {customerName, customerPhone, customerAddress, ...}}
// when it rejects a field. Show those next to the right input.
function applyServerFieldErrors(errors) {
  if (!errors || typeof errors !== "object") return false;
  const map = {
    customerName: ["userName", "errorName"],
    customerPhone: ["userPhone", "errorPhone"],
    customerAddress: ["userAddress", "errorAddress"],
    deliveryAreaId: ["deliveryArea", "errorArea"],
  };
  let first = null;
  Object.entries(map).forEach(([field, [inputId, errorId]]) => {
    if (!errors[field]) return;
    const inputEl = document.getElementById(inputId);
    const errorEl = document.getElementById(errorId);
    if (!inputEl || !errorEl) return;
    setFieldError(inputEl, errorEl, errors[field]);
    first = first || inputEl;
  });
  if (first) first.focus();
  return Boolean(first);
}

// ---- Idempotency key: one per intentional checkout attempt ----
const CHECKOUT_ATTEMPT_STORAGE = "unimart_checkout_attempt";

function generateCheckoutKey() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// What the customer is trying to buy: the exact contact details, delivery area,
// payment method and cart lines. Change any of it and it is a different order,
// so it gets a new key.
function checkoutFingerprint(values, items) {
  const lines = items
    .map((i) => `${i.productId}:${i.quantity}`)
    .sort()
    .join(",");
  return JSON.stringify([values.name, values.phone, values.address, lines, values.areaId || "", values.payment || ""]);
}

// Reuses the stored key while the attempt is unchanged (this is what makes a
// refresh/retry after an unknown outcome safe), otherwise makes a fresh one.
function getOrCreateCheckoutKey(fingerprint) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(CHECKOUT_ATTEMPT_STORAGE) || "null");
    if (stored && stored.fingerprint === fingerprint && typeof stored.key === "string") return stored.key;
  } catch (error) {
    // unreadable storage - fall through and make a new key
  }
  const key = generateCheckoutKey();
  try {
    sessionStorage.setItem(CHECKOUT_ATTEMPT_STORAGE, JSON.stringify({ key, fingerprint }));
  } catch (error) {
    // storage blocked: the key still protects against double-taps in this page load
  }
  return key;
}

function clearCheckoutKey() {
  try {
    sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE);
  } catch (error) {
    // nothing to clear
  }
}

// ---- Success state - WhatsApp is optional, shown only after real backend success ----
function orderBreakdownHtml(order) {
  // Orders always carry the server's numbers. Without a subtotal (very old
  // orders) only the total is shown - nothing is invented.
  if (order.subtotal === undefined || order.subtotal === null) {
    return `<p>Total: <strong>${formatNPR(order.totalAmount)}</strong></p>`;
  }
  let delivery = "To be confirmed";
  if (order.deliveryType !== "manual" && order.deliveryFee !== undefined && order.deliveryFee !== null) {
    delivery = order.deliveryFee === 0 ? "FREE" : formatNPR(order.deliveryFee);
  }
  const area = order.deliveryArea ? ` (${escapeText(order.deliveryArea)})` : "";
  const totalLabel = order.deliveryType === "manual" ? "Items Total" : "Total";
  return `
    <p>Items: <strong>${formatNPR(order.subtotal)}</strong></p>
    <p>Delivery${area}: <strong>${delivery}</strong></p>
    <p>${totalLabel}: <strong>${formatNPR(order.totalAmount)}</strong></p>
  `;
}

function showOrderConfirmation(order) {
  const container = document.querySelector(".checkout-container");
  const mobileBar = document.querySelector(".mobile-bottom-bar");
  const mobileHeader = document.querySelector(".checkout-header-mobile");
  if (mobileBar) mobileBar.style.display = "none";
  if (mobileHeader) mobileHeader.style.display = "none";
  if (!container) return;

  const canChat = Boolean(UniMartConfig.getWhatsAppUrl(""));
  const followUp = order.deliveryType === "manual"
    ? "We'll contact you shortly to confirm delivery and payment."
    : "We'll contact you shortly to confirm your order and payment.";

  container.innerHTML = `
    <div class="order-confirmation">
      <div class="confirm-icon">✅</div>
      <h2>Order Placed Successfully</h2>
      <p>Order ID: <strong>${escapeText(order.orderId)}</strong></p>
      ${orderBreakdownHtml(order)}
      <p>Your order has been placed with UniMart. ${followUp}</p>
      ${canChat ? "<p>Want a faster reply? You can also send your order details to us on WhatsApp.</p>" : ""}
      <div class="confirmation-actions">
        ${AuthState.isLoggedIn() ? `<a href="${UniMartConfig.getPath(`pages/orders.html?id=${order._id}`)}" class="shop-now-btn">View Order</a>` : ""}
        ${canChat ? '<button id="sendWhatsappBtn" class="btn-continue">Message Us on WhatsApp</button>' : ""}
        <a href="${UniMartConfig.getPath("index.html")}" class="shop-now-btn">Continue Shopping</a>
      </div>
    </div>
  `;

  document.getElementById("sendWhatsappBtn")?.addEventListener("click", () => {
    const message = `Hi, I just placed order ${order.orderId} on Unimart. Total: ${formatNPR(order.totalAmount)}`;
    const url = UniMartConfig.getWhatsAppUrl(message);
    if (url) window.open(url, "_blank");
    // Nothing about order status depends on what happens in this window -
    // the order was already confirmed by the backend before this button
    // even existed.
  });
}

const DELIVERY_ERROR_CODES = ["DELIVERY_DISABLED", "AREA_REQUIRED", "AREA_NOT_FOUND", "AREA_UNSUPPORTED", "LOCAL_DISABLED", "BELOW_MINIMUM", "FEE_UNAVAILABLE"];

async function submitOrder() {
  // Synchronous re-entry guard: a second tap in the same tick is ignored even
  // before the buttons visibly disable.
  if (isSubmitting || quoteLoading || deliveryBlocked) return;

  const checkoutBtn = document.getElementById("checkoutBtn");
  const mobileBtn = document.getElementById("mobileCheckoutBtn");
  const overlay = document.getElementById("orderOverlay");

  const { valid, values } = validateForm();
  if (!valid) return;
  const { name, phone, address } = values;

  if (!AuthState.isLoggedIn() && cartItemsCache.length === 0) {
    window.showToast?.("Your cart couldn't be loaded. Please refresh the page and try again.");
    return;
  }

  isSubmitting = true;
  [checkoutBtn, mobileBtn].forEach((btn) => {
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = "Placing order...";
    }
  });
  if (overlay) overlay.style.display = "flex";

  try {
    const contact = { customerName: name, customerPhone: phone, customerAddress: address, paymentMethod: values.payment };
    // Optional extras are only sent when they exist. The quoted total is what
    // the customer SAW; the server never uses it as a price - it only refuses
    // the order if the real total no longer matches.
    if (values.areaId && areaSelectVisible()) contact.deliveryAreaId = values.areaId;
    if (currentQuote && currentQuote.deliverable) contact.quotedTotal = currentQuote.total;

    // Guest checkout must submit items directly - the server has no cart
    // record for a guest. Logged-in checkout omits items entirely; the
    // server reads the authenticated user's stored Cart instead.
    const items = itemsForServer();

    const checkoutKey = getOrCreateCheckoutKey(checkoutFingerprint(values, cartItemsCache));
    const order = await CheckoutService.placeOrder(contact, items, checkoutKey);

    // The order exists the moment this line is reached. Everything after is
    // cleanup and UI, wrapped so that NOTHING here can turn a placed order
    // into an error message. (A logged-in user's server cart was already
    // emptied by the backend inside the order transaction.)
    clearCheckoutKey();
    try {
      CartState.clearLocalCartAfterOrder();
      window.updateCartBadge?.();
    } catch (cleanupError) {
      // harmless: the cart page will reconcile itself
    }

    if (overlay) overlay.style.display = "none";
    showOrderConfirmation(order);
    // Buttons stay disabled: the page has been replaced by the confirmation.
  } catch (error) {
    if (overlay) overlay.style.display = "none";

    const code = error && error.body && error.body.code;

    // "Same key, different details": that attempt is finished; start fresh.
    if (error && error.status === 409 && /different details/i.test(error.message || "")) {
      clearCheckoutKey();
    }

    const shownInline = applyServerFieldErrors(error && error.body && error.body.errors);
    const outcomeUnknown = Boolean(error && (error.networkError || error.status >= 500));

    if (code === "QUOTE_CHANGED") {
      // Price or delivery changed since the customer last saw the total: show
      // the new numbers and let them confirm again. Nothing was ordered.
      if (error.body.quote) currentQuote = { deliverable: true, currency: "NPR", ...error.body.quote };
      renderSummary();
      window.showToast?.(error.message);
    } else if (DELIVERY_ERROR_CODES.includes(code)) {
      setDeliveryMessage(error.message);
      refreshQuote();
    } else if (outcomeUnknown) {
      // We can't tell whether the server created the order. The same key is
      // kept, so pressing the button again is safe - it can't create a duplicate.
      window.showToast?.("We couldn't confirm your order. Please tap Place Order again - it won't create a duplicate.");
    } else if (!shownInline) {
      window.showToast?.((error && error.message) || "Could not place your order. Please try again.");
    }

    isSubmitting = false;
    [checkoutBtn, mobileBtn].forEach((btn) => {
      if (btn) btn.textContent = btn.dataset.originalText;
    });
    updateActionState();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Button listeners attach unconditionally, before anything that could
  // fail - a failure loading the cart summary must never leave the button
  // dead with no explanation.
  document.getElementById("checkoutBtn")?.addEventListener("click", submitOrder);
  document.getElementById("mobileCheckoutBtn")?.addEventListener("click", submitOrder);

  const nameEl = document.getElementById("userName");
  const phoneEl = document.getElementById("userPhone");
  const addressEl = document.getElementById("userAddress");
  wireLiveValidationClear(nameEl, document.getElementById("errorName"));
  wireLiveValidationClear(phoneEl, document.getElementById("errorPhone"));
  wireLiveValidationClear(addressEl, document.getElementById("errorAddress"));

  try {
    if (window.AuthState && !AuthState.initialized) {
      await AuthState.init();
    }
    prefillFromAccount();
    if (!(await loadCart())) return;
    renderSummary();

    // Owner-managed settings: payment options, delivery areas. Never rejects;
    // null means "use the built-in behaviour".
    if (window.SiteSettings) publicSettings = await SiteSettings.load();
    renderPaymentOptions();
    renderAreaSelect();
    await refreshQuote();
  } catch (error) {
    window.showToast?.(error.message || "Could not load your cart. Please refresh and try again.");
  }
});
