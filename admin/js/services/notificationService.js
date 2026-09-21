/**
 * UNiMART Admin - Notification service. Wraps /api/notifications/admin/* as
 * implemented in backend/controllers/notificationController.js. Every call
 * needs an admin session; the backend derives the recipient from that session
 * (a recipient id is never sent from here).
 */
const AdminNotificationService = {
  // -> {data:[...], pagination:{page,limit,total,pages}, unreadCount}
  list: ({ page = 1, limit = 20, unread = false } = {}) =>
    AdminApiClient.get(AdminConfig.getUrl("notifications", `/admin?page=${page}&limit=${limit}${unread ? "&unread=true" : ""}`)),

  unreadCount: async () => (await AdminApiClient.get(AdminConfig.getUrl("notifications", "/admin/unread-count"))).data.unreadCount,

  markRead: (id) => AdminApiClient.patch(AdminConfig.getUrl("notifications", `/admin/${encodeURIComponent(id)}/read`)),

  markAllRead: () => AdminApiClient.patch(AdminConfig.getUrl("notifications", "/admin/read-all")),
};

window.AdminNotificationService = AdminNotificationService;
