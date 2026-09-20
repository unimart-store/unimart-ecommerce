/**
 * UNiMART Admin - Settings service. Wraps /api/settings exactly as implemented
 * in backend/controllers/settingsController.js: responses are {success, data}.
 * Both calls require an admin session; the backend enforces that.
 */
const AdminSettingsService = {
  // GET /api/settings -> full settings incl. couriers and `revision`
  get: async () => (await AdminApiClient.get(AdminConfig.getUrl("settings"))).data,

  // PUT /api/settings -> saved settings. 400 => body.errors {path: message}; 409 => changed elsewhere.
  update: async (payload) => (await AdminApiClient.put(AdminConfig.getUrl("settings"), payload)).data,
};

window.AdminSettingsService = AdminSettingsService;
