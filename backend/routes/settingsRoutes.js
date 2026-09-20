const express = require("express");
const router = express.Router();

const { getPublicSettings, getAdminSettings, updateSettings } = require("../controllers/settingsController");
const { protect, authorize } = require("../middleware/auth");

// PUBLIC - safe storefront fields only (see settingsService.toPublicSettings)
router.get("/public", getPublicSettings);

// ADMIN ONLY - full settings + edits. Authorization is enforced here by the
// same protect + authorize("admin") pair every other admin route uses.
router.get("/", protect, authorize("admin"), getAdminSettings);
router.put("/", protect, authorize("admin"), updateSettings);

module.exports = router;
