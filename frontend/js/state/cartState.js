/**
 * UNiMART — Cart state. Guest cart lives in localStorage (fast, no login
 * required); logged-in cart lives on the server. Every page calls the same
 * functions here regardless of which mode is active - the branching happens
 * once, in this file, not scattered across cart.js/product.js/checkout.js.
 */
const CartState = (() => {
  const STORAGE_KEY = "unimart_guest_cart";

  const readGuestCart = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  };

  const writeGuestCart = (items) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  };

  // Normalizes both cart shapes (guest's flat snapshot vs server's
  // populated {product, quantity, available}) into one common shape pages
  // can render without caring which mode produced it.
  const normalizeServerItems = (serverItems) =>
    serverItems.map((item) => ({
      productId: item.product?._id,
      name: item.product?.name,
      price: item.product?.price,
      // oldPrice/discount/ratings are NOT included here - the server cart's
      // populate() doesn't select them yet. See integration notes: this is
      // a known, reported gap, not an oversight.
      image: Normalize.getImageUrl(item.product),
      quantity: item.quantity,
      available: item.available,
      stockQuantity: item.product?.stockQuantity,
    }));

  const getItems = async () => {
    if (AuthState.isLoggedIn()) {
      const serverItems = await CartService.getCart();
      return normalizeServerItems(serverItems);
    }
    return readGuestCart();
  };

  const getCount = async () => {
    const items = await getItems();
    return items.reduce((sum, item) => sum + item.quantity, 0);
  };

  // ---- Single source of truth for "is this product in the cart?" ----
  // Every page (product detail today, listing cards later) must ask CartState
  // instead of keeping its own idea of cart state.
  const MAX_QUANTITY_PER_ITEM = 99; // same cap the server-side cart enforces

  const findItem = (items, productId) => items.find((i) => i.productId === productId);

  const getItemQuantity = async (productId) => {
    const item = findItem(await getItems(), productId);
    return item ? item.quantity : 0;
  };

  const hasItem = async (productId) => (await getItemQuantity(productId)) > 0;

  // Pure: decides what the product's cart button must show and do, from the
  // product and the cart items the caller already loaded. Precedence:
  //   1. already in cart   -> "Go to Cart" (never adds again; the cart page
  //                            owns quantity changes)
  //   2. inactive          -> unavailable
  //   3. no stock          -> unavailable ("Out of Stock")
  //   4. otherwise         -> "Add to Cart", max = what stock/cap allows
  const describeProductAction = (product, items) => {
    const inCart = findItem(items || [], product._id);
    if (inCart) {
      return { state: "in-cart", label: "Go to Cart", disabled: false, maxQuantity: 0, inCartQuantity: inCart.quantity };
    }
    if (product.status !== "active") {
      return { state: "unavailable", label: "Unavailable", disabled: true, maxQuantity: 0, inCartQuantity: 0 };
    }
    const stock = Number.isFinite(product.stockQuantity) ? product.stockQuantity : 0;
    if (stock < 1) {
      return { state: "unavailable", label: "Out of Stock", disabled: true, maxQuantity: 0, inCartQuantity: 0 };
    }
    return {
      state: "add",
      label: "Add to Cart",
      disabled: false,
      maxQuantity: Math.min(stock, MAX_QUANTITY_PER_ITEM),
      inCartQuantity: 0,
    };
  };

  // `product` here is a normalized product (has _id, name, price, imageUrl)
  // Always returns the full, normalized cart AFTER the change, so callers can
  // re-render from the result instead of guessing.
  const addItem = async (product, quantity = 1) => {
    if (AuthState.isLoggedIn()) {
      const serverItems = await CartService.addItem(product._id, quantity);
      return normalizeServerItems(serverItems);
    }

    const items = readGuestCart();
    const existing = items.find((i) => i.productId === product._id);
    const wanted = (existing ? existing.quantity : 0) + quantity;
    // Stock guard for guests (logged-in users get the same rule from the
    // server). Checkout re-verifies stock atomically either way.
    if (Number.isFinite(product.stockQuantity) && wanted > product.stockQuantity) {
      throw { success: false, message: product.stockQuantity > 0 ? `Only ${product.stockQuantity} in stock` : "This product is out of stock" };
    }
    if (wanted > MAX_QUANTITY_PER_ITEM) {
      throw { success: false, message: `You can add at most ${MAX_QUANTITY_PER_ITEM} of one product` };
    }
    if (existing) {
      existing.quantity = wanted;
      if (Number.isFinite(product.stockQuantity)) existing.stockQuantity = product.stockQuantity;
    } else {
      items.push({
        productId: product._id,
        name: product.name,
        price: product.price,
        oldPrice: product.oldPrice,
        discount: product.discount,
        ratings: product.ratings,
        image: product.imageUrl || Normalize.getImageUrl(product),
        stockQuantity: product.stockQuantity,
        quantity,
      });
    }
    writeGuestCart(items);
    return items;
  };

  const updateQuantity = async (productId, quantity) => {
    if (AuthState.isLoggedIn()) {
      const serverItems = await CartService.updateItemQuantity(productId, quantity);
      return normalizeServerItems(serverItems);
    }
    const items = readGuestCart();
    const item = items.find((i) => i.productId === productId);
    if (item) {
      // Stock snapshot (saved when the item was added) caps increases; older
      // guest carts without a snapshot fall back to the checkout-time check.
      if (quantity > item.quantity && Number.isFinite(item.stockQuantity) && quantity > item.stockQuantity) {
        throw { success: false, message: item.stockQuantity > 0 ? `Only ${item.stockQuantity} in stock` : "This product is out of stock" };
      }
      item.quantity = Math.min(quantity, MAX_QUANTITY_PER_ITEM);
    }
    writeGuestCart(items);
    return items;
  };

  const removeItem = async (productId) => {
    if (AuthState.isLoggedIn()) {
      const serverItems = await CartService.removeItem(productId);
      return normalizeServerItems(serverItems);
    }
    const items = readGuestCart().filter((i) => i.productId !== productId);
    writeGuestCart(items);
    return items;
  };

  const clearCart = async () => {
    if (AuthState.isLoggedIn()) {
      await CartService.clearCart();
    }
    writeGuestCart([]);
  };

  // After a SUCCESSFUL order: the backend already emptied a logged-in user's
  // server cart inside the order transaction, so only local state is cleaned
  // up here - no network call that could fail and make a placed order look
  // like a failed one.
  const clearLocalCartAfterOrder = () => writeGuestCart([]);

  // Called right after a successful login. Merges the guest cart into the
  // server cart, then empties localStorage - the server cart becomes the
  // single source of truth from this point on.
  const syncGuestCartToServer = async () => {
    const guestItems = readGuestCart();
    if (guestItems.length === 0) return;

    const payload = guestItems.map((i) => ({ productId: i.productId, quantity: i.quantity }));
    await CartService.syncCart(payload);
    writeGuestCart([]);
  };

  return {
    getItems,
    getCount,
    getItemQuantity,
    hasItem,
    describeProductAction,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    clearLocalCartAfterOrder,
    syncGuestCartToServer,
  };
})();

window.CartState = CartState;
