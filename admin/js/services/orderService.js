/**
 * UNiMART Admin — Order service. Wraps /api/orders exactly as implemented
 * in backend/controllers/orderController.js. Note the controller returns
 * the raw array/document (not wrapped in { success, data }) for these two
 * endpoints - that asymmetry is real, not a bug to "fix" client-side.
 */
const AdminOrderService = {
  // GET /api/orders -> Order[] directly (admin only)
  getAll: () => AdminApiClient.get(AdminConfig.getUrl("orders")),

  // PATCH /api/orders/:id { status } -> updated Order directly
  updateStatus: (id, status) => AdminApiClient.patch(AdminConfig.getUrl("orders", `/${id}`), { status }),
};

// Allowed status transitions, mirrored from orderController.js's
// `allowedStatuses` - kept here as UX guidance for the status dropdown, the
// backend independently re-validates and is the real source of truth.
const ADMIN_ORDER_STATUSES = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];

const ADMIN_ORDER_TRANSITIONS = {
  Pending: ["Processing", "Shipped", "Delivered", "Cancelled"],
  Processing: ["Shipped", "Delivered", "Cancelled"],
  Shipped: ["Delivered", "Cancelled"],
  Delivered: [],
  Cancelled: [],
};


window.AdminOrderService = AdminOrderService;
window.ADMIN_ORDER_STATUSES = ADMIN_ORDER_STATUSES;
window.ADMIN_ORDER_TRANSITIONS = ADMIN_ORDER_TRANSITIONS;
