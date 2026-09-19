const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const {
  ORDER_STATUSES,
  CUSTOMER_CANCELLABLE_FROM,
  ADMIN_CANCELLABLE_FROM,
  isLegalTransition,
  buildRestockOps,
} = require("../utils/orderStatus");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Cancels an order AND returns its items to stock, atomically.
//
// Why this cannot double-restock:
//  - The status flip is a single guarded update whose filter only matches
//    orders still in `allowedFrom` (never "Cancelled"). Only ONE caller can
//    ever match it; a repeated or concurrent cancel matches nothing.
//  - The stock $inc runs in the same transaction, so either both the status
//    change and the restock happen, or neither does.
//  - stockRestoredAt is written in that same update as an audit trail.
//
// Returns { order } on success or { status, message } describing why not.
const cancelOrderAndRestock = async ({ filter, allowedFrom }) => {
  const session = await mongoose.startSession();
  try {
    let cancelled = null;

    await session.withTransaction(async () => {
      cancelled = null; // callback can be retried - always start clean
      const now = new Date();

      const order = await Order.findOneAndUpdate(
        { ...filter, status: { $in: allowedFrom } },
        { $set: { status: "Cancelled", cancelledAt: now, stockRestoredAt: now } },
        { new: true, session }
      );
      if (!order) return;

      const restockOps = buildRestockOps(order.items);
      if (restockOps.length > 0) {
        await Product.bulkWrite(restockOps, { session });
      }
      cancelled = order;
    });

    if (cancelled) return { order: cancelled };

    // Nothing matched: work out why so the caller gets an accurate answer.
    const current = await Order.findOne(filter).select("status");
    if (!current) return { status: 404, message: "Order not found" };
    if (current.status === "Cancelled") return { status: 400, message: "Order is already cancelled" };
    return { status: 400, message: `Order cannot be cancelled once it is ${current.status}` };
  } finally {
    session.endSession();
  }
};

// @desc   Get the logged-in customer's own orders, newest first
// @route  GET /api/orders/mine
exports.getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (error) {
    next(error);
  }
};

// @desc   Get a single order - ONLY if it belongs to the logged-in customer
// @route  GET /api/orders/mine/:id
// Ownership is enforced directly in the query filter (user: req.user._id),
// not checked after fetching - a malformed or someone-else's id both result
// in the same 404, never leaking whether the order exists for another user.
exports.getMyOrderById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

// @desc   Cancel the logged-in customer's own order, only while still Pending
// @route  PATCH /api/orders/mine/:id/cancel
exports.cancelMyOrder = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    // Ownership is part of the filter, exactly as in getMyOrderById.
    const result = await cancelOrderAndRestock({
      filter: { _id: req.params.id, user: req.user._id },
      allowedFrom: CUSTOMER_CANCELLABLE_FROM,
    });
    if (!result.order) {
      return res.status(result.status).json({ success: false, message: result.message });
    }
    res.status(200).json(result.order);
  } catch (error) {
    next(error);
  }
};

// @desc   Get all orders
// @route  GET /api/orders
// Admin only - exposes customer name/phone/address for every order.
exports.getAllOrders = async (req, res, next) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (error) {
    next(error);
  }
};

// @desc   Update an order's status
// @route  PATCH /api/orders/:id
// Admin only.
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: "Status is required" });
    }
    if (typeof status !== "string" || !ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // Cancelling always goes through the restock path.
    if (status === "Cancelled") {
      const result = await cancelOrderAndRestock({
        filter: { _id: req.params.id },
        allowedFrom: ADMIN_CANCELLABLE_FROM,
      });
      if (!result.order) {
        return res.status(result.status).json({ success: false, message: result.message });
      }
      return res.status(200).json(result.order);
    }

    const current = await Order.findById(req.params.id).select("status");
    if (!current) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (!isLegalTransition(current.status, status)) {
      return res.status(400).json({
        success: false,
        message: `An order cannot be changed from ${current.status} to ${status}`,
      });
    }

    // Guarded on the status we just validated against, so two admins (or two
    // tabs) cannot both apply conflicting transitions to the same order.
    const updated = await Order.findOneAndUpdate(
      { _id: req.params.id, status: current.status },
      { $set: { status } },
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res.status(409).json({
        success: false,
        message: "This order was just updated by someone else. Please refresh and try again.",
      });
    }

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};
