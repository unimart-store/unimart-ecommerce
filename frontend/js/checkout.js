/**
 * UNiMART — Checkout page (pages/checkout.html).
 * Calls CheckoutService (POST /api/checkout) only. No price or total is
 * ever computed here for submission - they're shown for the customer's
 * benefit, but the server independently resolves the real values.
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
 */
const formatNPR = (amount) => UniMartConfig.formatPrice(amount);

let cartItemsCache = [];
let isSubmitting = false;

async function renderSummary() {
  const summaryBox = document.getElementById("priceSummary");
  const mobileTotal = document.getElementById("mobileTotalAmount");

  cartItemsCache = await CartState.getItems();

  if (cartItemsCache.length === 0) {
    window.location.href = "cart.html";
    return;
  }

  // Delivery is deliberately NOT calculated in the browser. The old placeholder
  // rule (free above 500, otherwise 40) was never applied by the server, so the
  // customer saw a total the order didn't use. Real delivery rules that the
  // business controls arrive with the Phase 2 settings system.
  const subtotal = cartItemsCache.reduce((sum, i) => sum + i.price * i.quantity, 0);

  if (summaryBox) {
    summaryBox.innerHTML = `
      <div class="summary-line"><span>Price (${cartItemsCache.length} items)</span><span>${formatNPR(subtotal)}</span></div>
      <div class="summary-line"><span>Delivery Charges</span><span class="delivery-note">To be confirmed</span></div>
      <hr>
      <div class="summary-line total"><span>Items Total</span><span>${formatNPR(subtotal)}</span></div>
    `;
  }
  if (mobileTotal) mobileTotal.textContent = formatNPR(subtotal);

  return subtotal;
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

// Returns {valid, values} - validates all three fields, applies inline
// errors, and focuses the first invalid field, per the required UX.
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

  if (firstInvalid) {
    firstInvalid.focus();
    return { valid: false };
  }

  return { valid: true, values: { name, phone, address } };
}

// The backend replies {errors: {customerName, customerPhone, customerAddress, ...}}
// when it rejects a field. Show those next to the right input.
function applyServerFieldErrors(errors) {
  if (!errors || typeof errors !== "object") return false;
  const map = {
    customerName: ["userName", "errorName"],
    customerPhone: ["userPhone", "errorPhone"],
    customerAddress: ["userAddress", "errorAddress"],
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

// What the customer is trying to buy: the exact contact details + cart lines.
// Change any of it and it is a different order, so it gets a new key.
function checkoutFingerprint(values, items) {
  const lines = items
    .map((i) => `${i.productId}:${i.quantity}`)
    .sort()
    .join(",");
  return JSON.stringify([values.name, values.phone, values.address, lines]);
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
function showOrderConfirmation(order) {
  const container = document.querySelector(".checkout-container");
  const mobileBar = document.querySelector(".mobile-bottom-bar");
  const mobileHeader = document.querySelector(".checkout-header-mobile");
  if (mobileBar) mobileBar.style.display = "none";
  if (mobileHeader) mobileHeader.style.display = "none";
  if (!container) return;

  container.innerHTML = `
    <div class="order-confirmation">
      <div class="confirm-icon">✅</div>
      <h2>Order Placed Successfully</h2>
      <p>Order ID: <strong>${order.orderId}</strong></p>
      <p>Items Total: <strong>${formatNPR(order.totalAmount)}</strong></p>
      <p>Your order has been placed with UniMart. We'll contact you shortly to confirm delivery and payment.</p>
      <p>Want a faster reply? You can also send your order details to us on WhatsApp.</p>
      <div class="confirmation-actions">
        ${AuthState.isLoggedIn() ? `<a href="${UniMartConfig.getPath(`pages/orders.html?id=${order._id}`)}" class="shop-now-btn">View Order</a>` : ""}
        <button id="sendWhatsappBtn" class="btn-continue">Message Us on WhatsApp</button>
        <a href="${UniMartConfig.getPath("index.html")}" class="shop-now-btn">Continue Shopping</a>
      </div>
    </div>
  `;

  document.getElementById("sendWhatsappBtn")?.addEventListener("click", () => {
    const message = `Hi, I just placed order ${order.orderId} on Unimart. Items total: ${formatNPR(order.totalAmount)}`;
    window.open(UniMartConfig.getWhatsAppUrl(message), "_blank");
    // Nothing about order status depends on what happens in this window -
    // the order was already confirmed by the backend before this button
    // even existed.
  });
}

async function submitOrder() {
  // Synchronous re-entry guard: a second tap in the same tick is ignored even
  // before the buttons visibly disable.
  if (isSubmitting) return;

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
    const contact = { customerName: name, customerPhone: phone, customerAddress: address, paymentMethod: "WhatsApp" };

    // Guest checkout must submit items directly - the server has no cart
    // record for a guest. Logged-in checkout omits items entirely; the
    // server reads the authenticated user's stored Cart instead.
    const items = AuthState.isLoggedIn()
      ? undefined
      : cartItemsCache.map((i) => ({ productId: i.productId, quantity: i.quantity }));

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

    // "Same key, different details": that attempt is finished; start fresh.
    if (error && error.status === 409 && /different details/i.test(error.message || "")) {
      clearCheckoutKey();
    }

    const shownInline = applyServerFieldErrors(error && error.body && error.body.errors);
    const outcomeUnknown = Boolean(error && (error.networkError || error.status >= 500));

    if (outcomeUnknown) {
      // We can't tell whether the server created the order. The same key is
      // kept, so pressing the button again is safe - it can't create a duplicate.
      window.showToast?.("We couldn't confirm your order. Please tap Place Order again - it won't create a duplicate.");
    } else if (!shownInline) {
      window.showToast?.((error && error.message) || "Could not place your order. Please try again.");
    }

    isSubmitting = false;
    [checkoutBtn, mobileBtn].forEach((btn) => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText;
      }
    });
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
    await renderSummary();
  } catch (error) {
    window.showToast?.(error.message || "Could not load your cart. Please refresh and try again.");
  }
});
