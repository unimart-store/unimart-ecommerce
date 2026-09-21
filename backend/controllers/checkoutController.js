const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Cart = require("../models/Cart");
const business = require("../config/business");
const settingsService = require("../services/settingsService");
const notificationService = require("../services/notifications/notificationService");
const { buildQuote, round2 } = require("../utils/delivery");
const {
  validateCheckoutBody,
  buildRequestFingerprint,
  firstErrorMessage,
} = require("../utils/validators");

// Phase 1 ships with the key OPTIONAL so browsers still holding the previous
// storefront JavaScript keep working during the deploy window. Once the new
// storefront is live everywhere, set REQUIRE_IDEMPOTENCY_KEY=true on Render.
const REQUIRE_IDEMPOTENCY_KEY = process.env.REQUIRE_IDEMPOTENCY_KEY === "true";

const httpError = (status, message, extra) => Object.assign(new Error(message), { status }, extra);

const isIdempotencyDuplicate = (error) =>
  error &&
  error.code === 11000 &&
  ((error.keyPattern && error.keyPattern.idempotencyKey) ||
    (typeof error.message === "string" && error.message.includes("idempotencyKey")));

const findByIdempotencyKey = (scope, key, session) => {
  const query = Order.findOne({ idempotencyScope: scope, idempotencyKey: key }).select("+idempotencyFingerprint");
  return session ? query.session(session) : query;
};

// Same key + same intent  -> return the order that already exists (200).
// Same key + other intent -> refuse (409); never silently merge two different carts.
const respondWithExisting = (res, existing, fingerprint) => {
  if (existing.idempotencyFingerprint && existing.idempotencyFingerprint !== fingerprint) {
    return res.status(409).json({
      success: false,
      message: "This order request was already used with different details. Please refresh the page and try again.",
    });
  }
  return res.status(200).json({ success: true, replayed: true, data: existing });
};

// @desc   Create an order - the only order-creation endpoint. Works for both
//         guest and logged-in customers via optionalAuth.
// @route  POST /api/checkout
//
// Trust model: the browser may only tell us WHO is ordering (validated
// contact fields) and, for guests, WHICH products/quantities. Everything
// that has monetary or inventory meaning - price, name, stock, subtotal,
// total - is read from MongoDB inside the transaction. Any price / total /
// stock / delivery-fee fields in the request body are never read.
exports.checkout = async (req, res, next) => {
  // Business settings are read once per request: the payment methods the
  // owner currently accepts, and the delivery rules used below.
  let settings;
  try {
    settings = await settingsService.getSettings();
  } catch (error) {
    return next(error);
  }
  const paymentMethods = settingsService.getEnabledPaymentMethods(settings).map((m) => m.label);
  const config = {
    ...business,
    paymentMethods: paymentMethods.length ? paymentMethods : business.paymentMethods,
    defaultPaymentMethod: paymentMethods.length ? paymentMethods[0] : business.defaultPaymentMethod,
  };

  const parsed = validateCheckoutBody(req.body, {
    isGuest: !req.user,
    config,
    requireIdempotencyKey: REQUIRE_IDEMPOTENCY_KEY,
  });
  if (parsed.errors) {
    return res.status(400).json({
      success: false,
      message: firstErrorMessage(parsed.errors),
      errors: parsed.errors,
    });
  }

  const input = parsed.value;
  const scope = req.user ? `user:${req.user._id}` : "guest";
  const idempotencyKey = input.idempotencyKey;
  const fingerprint = buildRequestFingerprint(input);

  let session;
  try {
    // Fast path: this exact attempt was already completed (double-click that
    // slipped through, refresh, network retry) - answer without touching stock.
    if (idempotencyKey) {
      const already = await findByIdempotencyKey(scope, idempotencyKey);
      if (already) return respondWithExisting(res, already, fingerprint);
    }

    session = await mongoose.startSession();
    let createdOrder = null;
    let replayedOrder = null;
    let stockAfter = []; // stock levels after this order, for low-stock alerts

    // withTransaction may re-run this callback (transient errors / write
    // conflicts), so it must start from a clean slate every time and must
    // decide EVERYTHING from data read inside the transaction.
    await session.withTransaction(async () => {
      createdOrder = null;
      replayedOrder = null;
      stockAfter = [];

      // A concurrent request with the same key may have committed while we
      // waited; re-check inside the transaction before reserving any stock.
      if (idempotencyKey) {
        const existing = await findByIdempotencyKey(scope, idempotencyKey, session);
        if (existing) {
          replayedOrder = existing;
          return;
        }
      }

      // Logged-in: the stored cart is the source of truth and is read INSIDE
      // the transaction. Two concurrent checkouts both try to write this same
      // cart document below, so MongoDB serialises them - the loser retries,
      // finds an empty cart, and gets "Your cart is empty" instead of a
      // second order. Guests submit (shape-validated) items directly.
      let lines;
      if (req.user) {
        const cart = await Cart.findOne({ user: req.user._id }).session(session);
        if (!cart || cart.items.length === 0) throw httpError(400, "Your cart is empty");
        lines = cart.items.map((item) => ({ productId: item.product.toString(), quantity: item.quantity }));
      } else {
        lines = input.items;
      }

      const orderItems = [];
      let subtotal = 0;

      for (const { productId, quantity } of lines) {
        const product = await Product.findById(productId).session(session);

        if (!product) throw httpError(400, "One of the items in your order is no longer available");
        if (product.status !== "active") throw httpError(400, `"${product.name}" is no longer available`);
        if (!Number.isFinite(product.price) || product.price < 0) {
          throw httpError(400, `"${product.name}" cannot be ordered right now`);
        }

        // Atomic check-and-decrement (unchanged guarantee): the stock
        // condition and the $inc are one operation, so two simultaneous
        // checkouts for the last unit cannot both succeed.
        const updated = await Product.findOneAndUpdate(
          { _id: productId, stockQuantity: { $gte: quantity } },
          { $inc: { stockQuantity: -quantity } },
          { new: true, session }
        );
        if (!updated) throw httpError(409, `Insufficient stock for "${product.name}"`);
        stockAfter.push({ productId: String(product._id), name: product.name, stock: updated.stockQuantity });

        // Historical snapshot: name and unit price at the moment of purchase.
        // Later price/name edits never change an existing order.
        orderItems.push({ productId: product._id, name: product.name, quantity, price: product.price });
        subtotal += product.price * quantity;
      }
      subtotal = round2(subtotal);

      // Delivery is decided HERE, from the settings and the server-computed
      // subtotal. Nothing the browser sent about fees/totals is read. An
      // undeliverable area throws, which rolls back the stock reserved above.
      const quote = buildQuote(settings, { subtotal, areaId: input.deliveryAreaId });
      if (!quote.ok) throw httpError(400, quote.message, { code: quote.code });

      // Consistency guard (not a price source): if the customer agreed to a
      // different total than the server now calculates, stop and let them
      // review it instead of charging something they did not see.
      if (input.quotedTotal !== undefined && Math.abs(quote.total - input.quotedTotal) > 0.005) {
        throw httpError(409, "The price or delivery charge has changed. Please review your order total and try again.", {
          code: "QUOTE_CHANGED",
          quote: { subtotal, delivery: quote.delivery, total: quote.total },
        });
      }

      const order = new Order({
        user: req.user ? req.user._id : undefined,
        customerName: input.customerName,
        customerPhone: input.customerPhone, // normalized +977XXXXXXXXXX
        customerAddress: input.customerAddress,
        customerCountry: input.country,
        items: orderItems,
        subtotal,
        deliveryFee: quote.delivery.fee,
        deliveryType: quote.delivery.mode,
        deliveryArea: quote.delivery.areaName,
        deliveryAreaId: quote.delivery.areaId,
        deliveryCourier: quote.delivery.courier,
        totalAmount: quote.total, // subtotal + server-calculated delivery fee
        paymentMethod: input.paymentMethod,
        status: "Pending",
        paymentStatus: "Unpaid",
        source: "website",
        idempotencyScope: idempotencyKey ? scope : undefined,
        idempotencyKey,
        idempotencyFingerprint: idempotencyKey ? fingerprint : undefined,
      });
      await order.save({ session });
      createdOrder = order;

      // Cart cleanup is part of the SAME transaction: an order can never exist
      // while the stored cart still holds the items it consumed, and the
      // browser has nothing left to clean up on the server side.
      if (req.user) {
        await Cart.updateOne({ user: req.user._id }, { $set: { items: [] } }, { session });
      }
    });

    if (replayedOrder) return respondWithExisting(res, replayedOrder, fingerprint);

    // The order is committed. Notifications are scheduled on a later tick and
    // can never fail, delay or roll back what just succeeded.
    notificationService.emitOrderCreated(createdOrder);
    stockAfter.forEach((s) => notificationService.emitLowStock({ ...s, orderId: createdOrder._id }));

    return res.status(201).json({ success: true, data: createdOrder });
  } catch (error) {
    // Lost a race on the unique (scope, key) index: another request for the
    // SAME attempt committed first. Our transaction (and its stock changes)
    // rolled back; hand back the winner's order.
    if (isIdempotencyDuplicate(error) && idempotencyKey) {
      try {
        const winner = await findByIdempotencyKey(scope, idempotencyKey);
        if (winner) return respondWithExisting(res, winner, fingerprint);
      } catch (lookupError) {
        return next(lookupError);
      }
    }
    // Errors thrown inside the transaction carry a `status` - anything else
    // is a genuine unexpected failure for the global error handler.
    if (error && error.status) {
      const payload = { success: false, message: error.message };
      if (error.code) payload.code = error.code;
      if (error.quote) payload.quote = error.quote;
      return res.status(error.status).json(payload);
    }
    return next(error);
  } finally {
    if (session) session.endSession();
  }
};
