const express = require("express");
const router = express.Router();

const { admin, customer } = require("../controllers/notificationController");
const { protect, authorize } = require("../middleware/auth");

// ADMIN - authenticated admins only (same protect + authorize pair as every
// other admin route). Fixed paths are declared before "/:id/read".
router.get("/admin", protect, authorize("admin"), admin.list);
router.get("/admin/unread-count", protect, authorize("admin"), admin.unreadCount);
router.patch("/admin/read-all", protect, authorize("admin"), admin.markAllRead);
router.patch("/admin/:id/read", protect, authorize("admin"), admin.markRead);

// CUSTOMER - any authenticated user, and only ever THEIR OWN notifications.
router.get("/", protect, customer.list);
router.get("/unread-count", protect, customer.unreadCount);
router.patch("/read-all", protect, customer.markAllRead);
router.patch("/:id/read", protect, customer.markRead);

module.exports = router;
