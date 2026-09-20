const Product = require("../models/Product");
const Cart = require("../models/Cart");
const settingsService = require("../services/settingsService");
const { buildQuote, round2 } = require("../utils/delivery");
const { validateGuestItems } = require("../utils/validators");

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const AREA_ID_PATTERN = /^[a-z0-9]{8,32}$/;

// @desc   Server-calculated price preview: items subtotal (from CURRENT
//         database prices) + delivery fee (from CURRENT settings) = total.
//         It is only a preview for the checkout screen - POST /api/checkout
//         recalculates everything again and rejects the order if it differs
//         from what the customer was shown (quotedTotal).
//         The client sends NO price, fee or total; only which items/area.
// @route  POST /api/delivery/quote   (public; logged-in users use their stored cart)
exports.quote = async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

    let areaId;
    if (body.areaId !== undefined && body.areaId !== null && body.areaId !== "") {
      if (typeof body.areaId !== "string" || !AREA_ID_PATTERN.test(body.areaId)) {
        return res.status(400).json({ success: false, message: "Invalid delivery area" });
      }
      areaId = body.areaId;
    }

    let lines;
    if (req.user) {
      const cart = await Cart.findOne({ user: req.user._id });
      if (!cart || cart.items.length === 0) {
        return res.status(400).json({ success: false, message: "Your cart is empty" });
      }
      lines = cart.items.map((item) => ({ productId: item.product.toString(), quantity: item.quantity }));
    } else {
      const parsed = validateGuestItems(body.items);
      if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
      lines = parsed.items;
    }

    let subtotal = 0;
    for (const { productId, quantity } of lines) {
      if (!OBJECT_ID_PATTERN.test(productId)) {
        return res.status(400).json({ success: false, message: "One of the items in your order is no longer available" });
      }
      const product = await Product.findById(productId);
      if (!product || product.status !== "active" || !Number.isFinite(product.price) || product.price < 0) {
        return res.status(400).json({ success: false, message: "One of the items in your order is no longer available" });
      }
      subtotal += product.price * quantity;
    }
    subtotal = round2(subtotal);

    const settings = await settingsService.getSettings();
    const result = buildQuote(settings, { subtotal, areaId });

    res.set("Cache-Control", "no-store");
    if (!result.ok) {
      // A business outcome, not a server error: the UI shows `message`.
      return res.status(200).json({
        success: true,
        data: { deliverable: false, code: result.code, message: result.message, subtotal, currency: "NPR" },
      });
    }

    res.status(200).json({
      success: true,
      data: { deliverable: true, subtotal, delivery: result.delivery, total: result.total, currency: "NPR" },
    });
  } catch (error) {
    next(error);
  }
};
