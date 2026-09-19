const Cart = require("../models/Cart");
const Product = require("../models/Product");
const mongoose = require("mongoose");

const MAX_QUANTITY_PER_ITEM = 99;

// Fetch the logged-in user's cart, creating an empty one on first use.
const getOrCreateCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }
  return cart;
};

// Builds the response shape for any cart-returning endpoint.
//
// Two things happen here, deliberately in this order:
// 1. Self-healing cleanup: any item referencing a product that was
//    permanently deleted gets dropped from the stored cart. This is checked
//    BEFORE populate() runs, not after - populate() replaces the stored
//    ObjectId with the full product document in memory, which is fragile to
//    save back cleanly. Checking existence first with raw ObjectIds avoids
//    that entirely.
// 2. Inactive-but-still-existing products stay in the cart (they might come
//    back in stock/active later) but are marked `available: false` so the
//    product is never presented as purchasable while inactive.
const buildCartResponse = async (cart) => {
  const productIds = cart.items.map((item) => item.product);
  const existingProducts = await Product.find({ _id: { $in: productIds } }).select("_id");
  const existingIds = new Set(existingProducts.map((p) => p._id.toString()));

  const hasStaleItems = cart.items.some((item) => !existingIds.has(item.product.toString()));
  if (hasStaleItems) {
    cart.items = cart.items.filter((item) => existingIds.has(item.product.toString()));
    await cart.save();
  }

  await cart.populate("items.product", "name price images status stockQuantity");

  return cart.items.map((item) => ({
    product: item.product,
    quantity: item.quantity,
    available: item.product.status === "active",
  }));
};

// @desc   Get the logged-in user's cart
// @route  GET /api/cart
exports.getCart = async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user._id);
    const items = await buildCartResponse(cart);
    res.status(200).json({ success: true, data: { items } });
  } catch (error) {
    next(error);
  }
};

// @desc   Add a product to the cart, or increase quantity if already present
// @route  POST /api/cart/item
exports.addItem = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;

    if (!productId) {
      return res.status(400).json({ success: false, message: "productId is required" });
    }

    //add extra
    if (!mongoose.Types.ObjectId.isValid(productId)) {
     return res.status(400).json({
       success: false,
       message: "Invalid product ID",
     });
    }

    const numericQuantity = Number(quantity) || 1;
    if (!Number.isInteger(numericQuantity) || numericQuantity < 1 || numericQuantity > MAX_QUANTITY_PER_ITEM) {
      return res.status(400).json({ success: false, message: `Quantity must be between 1 and ${MAX_QUANTITY_PER_ITEM}` });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(400).json({ success: false, message: "Invalid product" });
    }
    if (product.status !== "active") {
      return res.status(400).json({ success: false, message: "This product is not available" });
    }

    const cart = await getOrCreateCart(req.user._id);
    const existingItem = cart.items.find((item) => item.product.toString() === productId);

    // Stock limit: the cart can never be pushed past what is in stock right
    // now. (Checkout still re-verifies atomically - this is the early, friendly
    // check so the customer learns about it at "Add to Cart", not at payment.)
    const wantedInCart = (existingItem ? existingItem.quantity : 0) + numericQuantity;
    if (wantedInCart > product.stockQuantity) {
      return res.status(409).json({
        success: false,
        message: product.stockQuantity > 0
          ? `Only ${product.stockQuantity} in stock`
          : "This product is out of stock",
      });
    }

    if (existingItem) {
      existingItem.quantity = Math.min(existingItem.quantity + numericQuantity, MAX_QUANTITY_PER_ITEM);
    } else {
      cart.items.push({ product: productId, quantity: numericQuantity });
    }

    await cart.save();
    const items = await buildCartResponse(cart);
    res.status(200).json({ success: true, data: { items } });
  } catch (error) {
    next(error);
  }
};

// @desc   Set the exact quantity for a product already in the cart
// @route  PUT /api/cart/item/:productId
exports.updateItemQuantity = async (req, res, next) => {

  try {


         if (!mongoose.Types.ObjectId.isValid(req.params.productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }


    const numericQuantity = Number(req.body.quantity);

    if (!Number.isInteger(numericQuantity) || numericQuantity < 1 || numericQuantity > MAX_QUANTITY_PER_ITEM) {
      return res.status(400).json({ success: false, message: `Quantity must be between 1 and ${MAX_QUANTITY_PER_ITEM}` });
    }

    const cart = await getOrCreateCart(req.user._id);
    const existingItem = cart.items.find((item) => item.product.toString() === req.params.productId);

    if (!existingItem) {
      return res.status(404).json({ success: false, message: "Item not found in cart" });
    }

    // Increasing past current stock is refused. Lowering is always allowed,
    // even if stock has since dropped below what is already in the cart.
    if (numericQuantity > existingItem.quantity) {
      const product = await Product.findById(req.params.productId).select("stockQuantity");
      if (product && numericQuantity > product.stockQuantity) {
        return res.status(409).json({
          success: false,
          message: product.stockQuantity > 0
            ? `Only ${product.stockQuantity} in stock`
            : "This product is out of stock",
        });
      }
    }

    existingItem.quantity = numericQuantity;
    await cart.save();

    const items = await buildCartResponse(cart);
    res.status(200).json({ success: true, data: { items } });
  } catch (error) {
    next(error);
  }
};

// @desc   Remove a single product from the cart
// @route  DELETE /api/cart/item/:productId
exports.removeItem = async (req, res, next) => {



  try {

           if (!mongoose.Types.ObjectId.isValid(req.params.productId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product ID",
        });
      }
    const cart = await getOrCreateCart(req.user._id);
    const originalLength = cart.items.length;
    cart.items = cart.items.filter((item) => item.product.toString() !== req.params.productId);

    if (cart.items.length === originalLength) {
      return res.status(404).json({ success: false, message: "Item not found in cart" });
    }

    await cart.save();
    const items = await buildCartResponse(cart);
    res.status(200).json({ success: true, data: { items } });
  } catch (error) {
    next(error);
  }
};

// @desc   Clear the entire cart
// @route  DELETE /api/cart
exports.clearCart = async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user._id);
    cart.items = [];
    await cart.save();
    res.status(200).json({ success: true, data: { items: [] } });
  } catch (error) {
    next(error);
  }
};

// @desc   Merge a guest (localStorage) cart into the DB cart, called right after login
// @route  POST /api/cart/sync
exports.syncCart = async (req, res, next) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: "items must be an array" });
    }

    // Validate all product IDs in one query, then silently skip anything
    // invalid/deleted rather than failing the whole sync over one bad entry.
     const productIds = items
       .map((i) => i.productId)
       .filter(
         (id) =>
           id &&
           mongoose.Types.ObjectId.isValid(id)
       );

     const existingProducts = await Product.find({
       _id: { $in: productIds },
     }).select("_id");
    const existingIds = new Set(existingProducts.map((p) => p._id.toString()));

    const cart = await getOrCreateCart(req.user._id);

    for (const guestItem of items) {
      if (!guestItem.productId || !existingIds.has(guestItem.productId.toString())) {
        continue;
      }

      const numericQuantity = Number(guestItem.quantity);
      if (!Number.isInteger(numericQuantity) || numericQuantity < 1) {
        continue;
      }

      const existingItem = cart.items.find(
        (item) => item.product.toString() === guestItem.productId.toString()
      );

      if (existingItem) {
        existingItem.quantity = Math.min(existingItem.quantity + numericQuantity, MAX_QUANTITY_PER_ITEM);
      } else {
        cart.items.push({
          product: guestItem.productId,
          quantity: Math.min(numericQuantity, MAX_QUANTITY_PER_ITEM),
        });
      }
    }

    await cart.save();
    const responseItems = await buildCartResponse(cart);
    res.status(200).json({ success: true, data: { items: responseItems } });
  } catch (error) {
    next(error);
  }
};
