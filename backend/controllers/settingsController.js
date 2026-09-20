const settingsService = require("../services/settingsService");
const { validateSettingsUpdate } = require("../utils/settingsValidator");

// @desc   Public business information for the storefront (footer, contact,
//         hours, delivery areas, payment options). Safe fields only.
// @route  GET /api/settings/public
exports.getPublicSettings = async (req, res, next) => {
  try {
    const settings = await settingsService.getSettings();
    // Short cache: cheap for the footer on every page, and a change made in
    // Admin shows up within seconds. Checkout never relies on this copy -
    // the server re-reads settings when it calculates delivery.
    res.set("Cache-Control", "public, max-age=30");
    res.status(200).json({ success: true, data: settingsService.toPublicSettings(settings) });
  } catch (error) {
    next(error);
  }
};

// @desc   Full settings for the admin form
// @route  GET /api/settings        (admin only - enforced in routes)
exports.getAdminSettings = async (req, res, next) => {
  try {
    const settings = await settingsService.getSettings();
    res.set("Cache-Control", "no-store");
    res.status(200).json({ success: true, data: settingsService.toAdminSettings(settings) });
  } catch (error) {
    next(error);
  }
};

// @desc   Update one or more settings sections
// @route  PUT /api/settings        (admin only - enforced in routes)
exports.updateSettings = async (req, res, next) => {
  try {
    const existing = await settingsService.getSettings();
    const parsed = validateSettingsUpdate(req.body, existing);

    if (parsed.errors) {
      return res.status(400).json({
        success: false,
        message: parsed.errors._ || "Please fix the highlighted fields",
        errors: parsed.errors,
      });
    }

    const result = await settingsService.saveSettings(parsed.value.sections, {
      expectedRevision: parsed.value.revision,
      userId: req.user._id,
    });

    if (result.conflict) {
      return res.status(409).json({
        success: false,
        message: "These settings were changed by someone else since you opened this page. Reload to see the latest, then apply your change again.",
      });
    }

    res.set("Cache-Control", "no-store");
    res.status(200).json({ success: true, data: settingsService.toAdminSettings(result.settings) });
  } catch (error) {
    next(error);
  }
};
