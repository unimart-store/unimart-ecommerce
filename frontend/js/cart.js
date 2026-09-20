/**
 * UNiMART — Cart page (pages/cart.html).
 * Same visual markup/classes as before - only the data layer changed, from
 * raw localStorage to CartState (which itself branches guest vs server).
 */
const formatNPR = (amount) => UniMartConfig.formatPrice(amount);

async function loadCart() {
  const cartContainer = document.getElementById("cartItems");
  const totalPriceEl = document.getElementById("totalPrice");
  const totalOldPriceEl = document.getElementById("totalOldPrice");
  const totalFinalPriceEl = document.getElementById("totalFinalPrice");
  const actionBar = document.querySelector(".cart-action-bar");
  if (!cartContainer) return;

  cartContainer.innerHTML = `<div class="main-loading"><div class="spinner"></div><span>Loading your cart...</span></div>`;
  if (actionBar) actionBar.style.display = "none";

  let items;
  try {
    items = await CartState.getItems();
  } catch (error) {
    cartContainer.innerHTML = `<p class="orders-error">Couldn't load your cart. <button id="retryCartBtn" class="link-btn">Try Again</button></p>`;
    document.getElementById("retryCartBtn")?.addEventListener("click", loadCart);
    return;
  }
  cartContainer.innerHTML = "";

  if (items.length === 0) {
    cartContainer.innerHTML = `
      <div class="empty-cart-msg">
        <span class="icon">🛒</span>
        <h3>Your cart is empty!</h3>
        <p>Looks like you haven't added anything yet.</p>
        <a href="${UniMartConfig.getPath("index.html")}" class="shop-now-btn">Start Shopping</a>
      </div>
    `;
    if (actionBar) actionBar.style.display = "none";
    return;
  }

  if (actionBar) actionBar.style.display = "flex";

  let subtotal = 0;
  let originalTotal = 0;

  items.forEach((item) => {
    subtotal += item.price * item.quantity;
    originalTotal += (item.oldPrice || item.price) * item.quantity;
    const productUrl = UniMartConfig.getPath(`product.html?id=${item.productId}`);

    let stars = "";
    if (item.ratings) {
      const fullStars = Math.floor(item.ratings);
      const halfStar = item.ratings % 1 >= 0.5 ? 1 : 0;
      const emptyStars = 5 - fullStars - halfStar;
      stars = `
        <div class="rating">
          ${"★".repeat(fullStars)}${halfStar ? "½" : ""}${"☆".repeat(emptyStars)}
          <span style="color: #878787; font-size: 0.8rem;">(${item.ratings})</span>
        </div>`;
    }

    const div = document.createElement("div");
    div.className = "cart-item";
    if (item.available === false) div.classList.add("cart-item-unavailable");

    div.innerHTML = `
      <div class="cart-item-main" onclick="window.location.href='${productUrl}'">
        <img src="${item.image || "/assets/images/no-image.png"}" class="cart-img" onerror="this.src='/assets/images/no-image.png'">
        <div class="cart-info">
          <h3 class="product-title">${item.name}</h3>
          ${item.available === false ? '<p class="unavailable-msg">No longer available</p>' : ""}
          ${stars}
          <div class="price-row">
            <span class="price">${formatNPR(item.price)}</span>
            ${item.oldPrice ? `<span class="old-price">${formatNPR(item.oldPrice)}</span>` : ""}
            ${item.discount ? `<span class="discount-tag">${item.discount}% OFF</span>` : ""}
          </div>
        </div>
      </div>
      <div class="cart-item-actions">
        <div class="qty-control">
          <button class="decrease">−</button>
          <input type="number" class="qty-input" value="${item.quantity}" readonly>
          <button class="increase">+</button>
        </div>
        <button class="remove-btn">REMOVE</button>
      </div>
    `;

    div.querySelector(".increase").addEventListener("click", () => changeQty(item.productId, item.quantity + 1));
    div.querySelector(".decrease").addEventListener("click", () => changeQty(item.productId, Math.max(1, item.quantity - 1)));
    div.querySelector(".remove-btn").addEventListener("click", () => removeItem(item.productId));

    cartContainer.appendChild(div);
  });

  // Delivery is NOT calculated in the browser. The customer picks their area at
  // checkout and the SERVER prices delivery from the owner's settings.
  const grandTotal = subtotal;
  const savings = originalTotal - subtotal;

  if (totalPriceEl) {
    totalPriceEl.innerHTML = `
      <div class="summary-line"><span>Price (${items.length} items)</span><span>${formatNPR(subtotal)}</span></div>
      <div class="summary-line"><span>Delivery Charges</span><span class="delivery-note">Calculated at checkout</span></div>
      <hr>
      <div class="summary-line total"><span>Items Total</span><span>${formatNPR(grandTotal)}</span></div>
      ${savings > 0 ? `<div class="savings-msg">You will save ${formatNPR(savings)} on this order</div>` : ""}
    `;
  }

  if (totalOldPriceEl && totalFinalPriceEl) {
    totalOldPriceEl.innerHTML = savings > 0 ? `<del>${formatNPR(originalTotal)}</del>` : "";
    totalFinalPriceEl.textContent = formatNPR(grandTotal);
  }

  const placeOrderBtn = document.querySelector(".btn-checkout");
  if (placeOrderBtn) {
    placeOrderBtn.onclick = () => { window.location.href = "checkout.html"; };
  }
}

async function changeQty(productId, newQuantity) {
  try {
    await CartState.updateQuantity(productId, newQuantity);
    window.updateCartBadge?.();
  } catch (error) {
    // e.g. "Only 3 in stock" - tell the customer instead of failing silently
    window.showToast?.(error.message || "Could not update quantity");
  }
  loadCart();
}

async function removeItem(productId) {
  if (!confirm("Are you sure you want to remove this item?")) return;
  await CartState.removeItem(productId);
  window.updateCartBadge?.();
  loadCart();
}

document.addEventListener("DOMContentLoaded", async () => {
  if (window.AuthState && !AuthState.initialized) {
    await AuthState.init();
  }
  loadCart();
});
