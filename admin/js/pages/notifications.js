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
    p.className = "admin-notif-empty";
    p.textContent = text;
    list.appendChild(p);
  };

  // quiet = background refresh: don't flash a loading state over what's on screen
  const load = async ({ quiet = false } = {}) => {
    if (state.loading) return;
    state.loading = true;
    if (!quiet) message("Loading\u2026");
    try {
      const res = await AdminNotificationService.list({ page: state.page, limit: PAGE_SIZE, unread: state.unreadOnly });
      state.pages = res.pagination.pages;
      if (state.page > state.pages) {
        state.page = state.pages;
        state.loading = false;
        return load();
      }

      const list = $("notifList");
      list.textContent = "";
      if (!res.data.length) {
        message(state.unreadOnly ? "You're all caught up - no unread notifications." : "No notifications yet.");
      } else {
        res.data.forEach((n) =>
          list.appendChild(
            AdminNotificationBell.buildItem(n, {
              onOpen: async (item, href) => {
                await AdminNotificationBell.openNotification(item, href);
              },
            })
          )
        );
      }

      $("notifPager").hidden = state.pages <= 1;
      $("notifPageInfo").textContent = `Page ${state.page} of ${state.pages}`;
      $("notifPrev").disabled = state.page <= 1;
      $("notifNext").disabled = state.page >= state.pages;
      $("notifMarkAll").disabled = res.unreadCount === 0;
      AdminNotificationBell.refreshCount();
    } catch (error) {
      if (!quiet) message(error?.message || "Couldn't load notifications.");
    } finally {
      state.loading = false;
    }
  };

  const stop = () => {
    clearInterval(timer);
    timer = null;
  };

  (async () => {
    const user = await AdminLayout.guardAndRender("notifications");
    if (!user) return;

    $("adminContent").appendChild($("notificationsTemplate").content.cloneNode(true));

    $("notifFilter").addEventListener("change", (e) => {
      state.unreadOnly = e.target.value === "unread";
      state.page = 1;
      load();
    });
    $("notifPrev").addEventListener("click", () => {
      if (state.page > 1) { state.page -= 1; load(); }
    });
    $("notifNext").addEventListener("click", () => {
      if (state.page < state.pages) { state.page += 1; load(); }
    });
    $("notifMarkAll").addEventListener("click", async () => {
      $("notifMarkAll").disabled = true;
      try {
        await AdminNotificationService.markAllRead();
        showAdminToast("All notifications marked as read", "success");
        load();
      } catch (error) {
        $("notifMarkAll").disabled = false;
        showAdminToast(error?.message || "Could not mark notifications as read", "error");
      }
    });

    // Light auto-refresh: only while visible, only on page 1 (so paging isn't yanked away).
    timer = setInterval(() => {
      if (!document.hidden && state.page === 1) load({ quiet: true });
    }, POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.page === 1) load({ quiet: true });
    });
    window.addEventListener("pagehide", stop);

    await load();
  })();
})();
