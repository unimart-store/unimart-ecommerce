/**
 * Order status rules - pure functions shared by the customer-cancel and
 * admin-status endpoints.
 *
 * Deliberately small (not a workflow engine):
 *  - Orders only move FORWARD: Pending -> Processing -> Shipped -> Delivered.
 *    Admin may skip steps (e.g. local bike delivery: Pending -> Delivered).
 *  - Cancelled and Delivered are final. In particular Cancelled -> Pending is
 *    impossible: it would need to re-reserve stock, which is not implemented.
 *  - Cancelling (from Pending/Processing/Shipped) returns the items to stock,
 *    exactly once. Cancelling a Shipped order assumes the goods are coming
 *    back; a dedicated "Returned" flow is a later-phase decision.
 *  - Customers may cancel only their own Pending orders (unchanged rule).
 */
const ORDER_STATUSES = Object.freeze(["Pending", "Processing", "Shipped", "Delivered", "Cancelled"]);

const TRANSITIONS = Object.freeze({
  Pending: Object.freeze(["Processing", "Shipped", "Delivered", "Cancelled"]),
  Processing: Object.freeze(["Shipped", "Delivered", "Cancelled"]),
  Shipped: Object.freeze(["Delivered", "Cancelled"]),
  Delivered: Object.freeze([]),
  Cancelled: Object.freeze([]),
});

const CUSTOMER_CANCELLABLE_FROM = Object.freeze(["Pending"]);
const ADMIN_CANCELLABLE_FROM = Object.freeze(
  ORDER_STATUSES.filter((s) => TRANSITIONS[s].includes("Cancelled"))
);

const isLegalTransition = (from, to) => Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);

// One bulkWrite op per order line: give the quantity back to the product.
// Lines without a productId (should not happen) are skipped.
const buildRestockOps = (items = []) =>
  items
    .filter((item) => item && item.productId && Number.isInteger(item.quantity) && item.quantity > 0)
    .map((item) => ({
      updateOne: {
        filter: { _id: item.productId },
        update: { $inc: { stockQuantity: item.quantity } },
      },
    }));

module.exports = {
  ORDER_STATUSES,
  TRANSITIONS,
  CUSTOMER_CANCELLABLE_FROM,
  ADMIN_CANCELLABLE_FROM,
  isLegalTransition,
  buildRestockOps,
};
