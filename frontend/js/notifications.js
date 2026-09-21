/**
 * Customer Notifications page (pages/notifications.html): full history with
 * pagination, unread filter and mark-all-read. Backed entirely by
 * /api/notifications - the server only ever returns the logged-in customer's
 * own notifications.
 */
(() => {
  const PAGE_SIZE = 20;
  const POLL_MS = 90 * 1000;
  const state = { page: 1, pages: 1, unreadOnly: false, loading: false };
  let timer = null;

  const $ = (id) => document.getElementById(id);

  const message = (text) => {
    const list = $("notifList");
    list.textContent = "";
    const p = document.createElement("p");
    p.className = "notif-empty";
    p.textContent = text;
    list.appendChild(p);
  };

  const load = async ({ quiet = false } = {}) => {
    if (state.loading) return;
    state.loading = true;
    if (!quiet) message("Loading\u2026");
    try {
      const res = await NotificationService.list({ page: state.page, limit: PAGE_SIZE, unread: state.unreadOnly });
      state.pages = res.pagination.pages;
      if (state.page > state.pages) {
        state.page = state.pages;
        state.loading = false;
        return load();
      }
      const list = $("notifList");
      list.textContent = "";
      if (!res.data.length) {
        message(state.unreadOnly ? "You're all caught up - no unread notifications." : "You have no notifications yet.");
      } else {
        res.data.forEach((n) => list.appendChild(NotificationBell.buildItem(n, { onOpen: NotificationBell.openNotification })));
      }
      $("notifPager").hidden = state.pages <= 1;
      $("notifPageInfo").textContent = `Page ${state.page} of ${state.pages}`;
      $("notifPrev").disabled = state.page <= 1;
      $("notifNext").disabled = state.page >= state.pages;
      $("notifMarkAll").disabled = res.unreadCount === 0;
      NotificationBell.refreshCount();
    } catch (error) {
      if (!quiet) message(error?.message || "Couldn't load notifications.");
    } finally {
      state.loading = false;
    }
  };

  document.addEventListener("DOMContentLoaded", async () => {
    if (window.AuthState && !AuthState.initialized) await AuthState.init();
    if (!AuthState.isLoggedIn()) {
      window.location.href = UniMartConfig.getPath("index.html");
      return;
    }

    $("notifFilter").addEventListener("change", (e) => {
      state.unreadOnly = e.target.value === "unread";
      state.page = 1;
      load();
    });
    $("notifPrev").addEventListener("click", () => { if (state.page > 1) { state.page -= 1; load(); } });
    $("notifNext").addEventListener("click", () => { if (state.page < state.pages) { state.page += 1; load(); } });
    $("notifMarkAll").addEventListener("click", async () => {
      $("notifMarkAll").disabled = true;
      try {
        await NotificationService.markAllRead();
        window.showToast?.("All notifications marked as read");
        load();
      } catch (error) {
        $("notifMarkAll").disabled = false;
        window.showToast?.(error?.message || "Could not mark notifications as read");
      }
    });

    // Light auto-refresh: only while visible and only on page 1.
    timer = setInterval(() => { if (!document.hidden && state.page === 1) load({ quiet: true }); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && state.page === 1) load({ quiet: true }); });
    window.addEventListener("pagehide", () => { clearInterval(timer); timer = null; });

    load();
  });
})();
