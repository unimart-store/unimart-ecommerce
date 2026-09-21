/**
 * Customer notification API (/api/notifications). The backend derives the
 * recipient from the logged-in session: a customer can only ever read or
 * change THEIR OWN notifications, and no recipient id is sent from here.
 */
const NotificationService = {
  // -> {data:[...], pagination:{page,limit,total,pages}, unreadCount}
  list: ({ page = 1, limit = 20, unread = false } = {}) =>
    ApiClient.get(UniMartConfig.getUrl("notifications", `?page=${page}&limit=${limit}${unread ? "&unread=true" : ""}`)),

  unreadCount: async () => (await ApiClient.get(UniMartConfig.getUrl("notifications", "/unread-count"))).data.unreadCount,

  markRead: (id) => ApiClient.patch(UniMartConfig.getUrl("notifications", `/${encodeURIComponent(id)}/read`)),

  markAllRead: () => ApiClient.patch(UniMartConfig.getUrl("notifications", "/read-all")),
};

window.NotificationService = NotificationService;
