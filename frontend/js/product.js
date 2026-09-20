/**
 * UNiMART — Product detail page (product.html).
 * Related products now request the backend's own category filter
 * (?category=slug&limit=6) instead of fetching the entire catalog and
 * filtering client-side.
 */
(() => {
  const params = new URLSearchParams(window.location.search);
  const productId = params.get("id");

  const btnCart = document.getElementById("btnCart");
  const whatsappBtn = document.getElementById("whatsappBtn");

  const loadRelated = async (product) => {
    const slug = Normalize.getCategorySlug(product);
    if (!slug) {
      window.renderRelatedProducts?.([]);
      return;
    }
    try {
      const res = await ProductService.getProducts({ category: slug, limit: 7, onlyActive: true });
      const related = (res?.data || []).filter((p) => p._id !== product._id).slice(0, 6);
      window.renderRelatedProducts?.(related);
    } catch (error) {
      window.renderRelatedProducts?.([]);
    }
  };

  const init = async () => {
    if (!productId) {
      window.location.href = UniMartConfig.getPath("index.html");
      return;
    }

    // Don't offer an action until the real cart state is known.
    if (btnCart) {
      btnCart.disabled = true;
      btnCart.textContent = "Loading...";
    }

    let product;
    try {
      product = await ProductService.getProductById(productId);
    } catch (error) {
      product = null;
    }

    if (!product) {
      window.showToast?.("Product not found");
      setTimeout(() => (window.location.href = UniMartConfig.getPath("index.html")), 1200);
      return;
    }

    document.title = `${product.name} - Unimart`;

    window.renderGallery?.(product);
    window.renderProductInfo?.(product);
    window.renderStockInfo?.(product);
    window.renderTags?.(product);
    window.renderRibbons?.(product);
    window.renderRating?.(product);
    loadRelated(product);

    // ---- Cart action: ONE state function, ONE click handler ----
    // What the button shows and does is always derived from
    // CartState.describeProductAction(product, cartItems), where cartItems is
    // the real cart (guest localStorage or the server cart, decided inside
    // CartState). Nothing on this page keeps its own copy of cart state.
    const qtyValueEl = document.getElementById("qtyValue");
    const qtyMinusBtn = document.getElementById("qtyMinus");
    const qtyPlusBtn = document.getElementById("qtyPlus");
    const qtySelector = document.getElementById("qtySelector");

    let cartItems = [];
    let quantity = 1;
    let busy = false;

    const renderAction = () => {
      const action = CartState.describeProductAction(product, cartItems);

      // Quantity picker only makes sense while adding a NEW line.
      qtySelector?.classList.toggle("hidden", action.state !== "add");
      quantity = Math.min(Math.max(1, quantity), Math.max(1, action.maxQuantity));
      if (qtyValueEl) qtyValueEl.textContent = quantity;
      if (qtyMinusBtn) qtyMinusBtn.disabled = quantity <= 1;
      if (qtyPlusBtn) qtyPlusBtn.disabled = quantity >= action.maxQuantity;

      if (btnCart) {
        btnCart.textContent = busy ? "Adding..." : action.label;
        btnCart.disabled = busy || action.disabled;
        btnCart.dataset.state = action.state;
      }
      return action;
    };

    qtyMinusBtn?.addEventListener("click", () => {
      if (quantity > 1) { quantity--; renderAction(); }
    });
    qtyPlusBtn?.addEventListener("click", () => {
      const { maxQuantity } = CartState.describeProductAction(product, cartItems);
      if (quantity < maxQuantity) { quantity++; renderAction(); }
    });

    // The single click handler. If the product is already in the cart it only
    // navigates - it can never add another unit.
    btnCart?.addEventListener("click", async () => {
      if (busy) return;
      const action = CartState.describeProductAction(product, cartItems);

      if (action.state === "in-cart") {
        window.location.href = UniMartConfig.getPath("pages/cart.html");
        return;
      }
      if (action.state !== "add") return;

      busy = true;
      renderAction();
      try {
        // addItem returns the full cart after the change, so the button is
        // re-derived from real state (-> "Go to Cart"), not from an assumption.
        cartItems = await CartState.addItem(Normalize.product(product), quantity);
        window.showToast?.("Added to cart");
        window.updateCartBadge?.();
      } catch (error) {
        window.showToast?.(error.message || "Could not add to cart");
      } finally {
        busy = false;
        renderAction();
      }
    });

    // Auth must be settled BEFORE reading the cart: CartState reads the server
    // cart for a logged-in user and localStorage for a guest, and picking the
    // wrong one is exactly what made a carted product look "not in cart".
    // AuthState.init() is idempotent - every caller shares one request.
    try {
      await AuthState.init();
    } catch (error) {
      // Not logged in / auth check failed: continue as guest.
    }
    try {
      cartItems = await CartState.getItems();
    } catch (error) {
      // Cart could not be read; the button falls back to "Add to Cart" and
      // the server/guest cart still enforce their own rules on add.
      cartItems = [];
    }
    renderAction();

    // The WhatsApp number is owner-managed (Admin -> Settings). SiteSettings
    // never rejects: if it can't load, the built-in fallback number is used.
    if (window.SiteSettings) await SiteSettings.load();
    if (whatsappBtn) {
      const message = `Hi, I'm interested in "${product.name}" (${UniMartConfig.formatPrice(product.price)})`;
      const url = UniMartConfig.getWhatsAppUrl(message);
      if (url) whatsappBtn.href = url;
      else whatsappBtn.style.display = "none"; // owner cleared the number: no dead link
    }
  };

  document.addEventListener("DOMContentLoaded", init);
})();
