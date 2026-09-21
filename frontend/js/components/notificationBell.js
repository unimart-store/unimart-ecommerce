/**
 * Storefront notification bell (logged-in customers only) + the row builder
 * shared with the full Notifications page.
 *
 * Refresh strategy (no realtime infrastructure): unread count on login/page
 * load, then every 90s while the tab is visible; returning to the tab
 * refreshes (at most once per 30s); polling stops on logout and page exit.
 */
const NotificationBell = (() => {
  const POLL_MS = 90 * 1000;
  const MIN_GAP_MS = 30 * 1000;
  const PANEL_LIMIT = 6;

  let unread = 0;
  let timer = null;
  let lastFetch = 0;
  let panelOpen = false;
  const el = {};

  // ---- helpers shared with the full page ----
  const linkFor = (n) =>
    n.data && n.data.orderRef
      ? UniMartConfig.getPath(`pages/orders.html?id=${encodeURIComponent(n.data.orderRef)}`)
      : UniMartConfig.getPath("pages/notifications.html");

  const timeAgo = (iso) => {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  // textContent only: notification text is never parsed as HTML.
  const buildItem = (n, { onOpen } = {}) => {
    const a = document.createElement("a");
    a.className = `notif-item${n.readAt ? "" : " notif-item--unread"}`;
    a.href = linkFor(n);

    const dot = document.createElement("span");
    dot.className = "notif-dot";
    dot.setAttribute("aria-hidden", "true");

    const body = document.createElement("span");
    body.className = "notif-body";
    const title = document.createElement("strong");
    title.textContent = n.title;
    const msg = document.createElement("span");
    msg.className = "notif-msg";
    msg.textContent = n.message;
    const meta = document.createElement("span");
    meta.className = "notif-meta";
    meta.textContent = `${timeAgo(n.createdAt)}${n.readAt ? "" : " \u00B7 Unread"}`;
    body.append(title, msg, meta);

    a.append(dot, body);
    a.addEventListener("click", async (event) => {
      event.preventDefault();
      if (onOpen) await onOpen(n, a.href);
    });
    return a;
  };

  const openNotification = async (n, href) => {
    if (!n.readAt) {
      unread = Math.max(0, unread - 1);
      renderBadge();
      // Briefly awaited so navigation doesn't cut the request off.
      await Promise.race([NotificationService.markRead(n.id).catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
    }
    window.location.href = href;
  };

  // ---- badge ----
  const renderBadge = () => {
    if (!el.badge) return;
    el.badge.hidden = unread <= 0;
    el.badge.textContent = unread > 99 ? "99+" : String(unread);
    el.btn.setAttribute("aria-label", unread > 0 ? `Notifications, ${unread} unread` : "Notifications");
  };

  const refreshCount = async () => {
    lastFetch = Date.now();
    try {
      unread = await NotificationService.unreadCount();
      renderBadge();
    } catch (error) {
      // Never disturb the page over a failed refresh: keep the last known count.
    }
  };

  // ---- dropdown ----
  const message = (text) => {
    el.list.textContent = "";
    const p = document.createElement("p");
    p.className = "notif-empty";
    p.textContent = text;
    el.list.appendChild(p);
  };

  const renderPanel = async () => {
    message("Loading\u2026");
    try {
      const res = await NotificationService.list({ page: 1, limit: PANEL_LIMIT });
      unread = res.unreadCount;
      renderBadge();
      if (!res.data.length) {
        message("No notifications yet.");
      } else {
        el.list.textContent = "";
        res.data.forEach((n) => el.list.appendChild(buildItem(n, { onOpen: openNotification })));
      }
      el.markAll.disabled = unread === 0;
    } catch (error) {
      message("Couldn't load notifications.");
    }
  };

  const setOpen = (open) => {
    panelOpen = open;
    el.panel.hidden = !open;
    el.btn.setAttribute("aria-expanded", String(open));
    if (open) {
      el.panel.style.setProperty("--notif-top", `${Math.round(el.btn.getBoundingClientRect().bottom + 8)}px`);
      renderPanel();
    }
  };

  // ---- polling ----
  const tick = () => {
    if (document.hidden) return; // no background polling
    refreshCount();
    if (panelOpen) renderPanel();
  };
  const start = () => {
    if (!timer) timer = setInterval(tick, POLL_MS);
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };

  // ---- mounting: the bell lives in the existing header, next to the account icon ----
  const ensureMounted = () => {
    if (el.btn) return true;
    const account = document.getElementById("accountLink");
    if (!account || !account.parentNode) return false;

    el.btn = document.createElement("a");
    el.btn.id = "notifBell";
    el.btn.className = "notif-bell";
    el.btn.href = UniMartConfig.getPath("pages/notifications.html"); // works without JS / middle-click
    el.btn.setAttribute("aria-haspopup", "true");
    el.btn.setAttribute("aria-expanded", "false");
    el.btn.setAttribute("aria-label", "Notifications");
    el.btn.innerHTML = '<i class="fa-regular fa-bell" aria-hidden="true"></i>';
    el.badge = document.createElement("span");
    el.badge.className = "notif-badge";
    el.badge.hidden = true;
    el.btn.appendChild(el.badge);
    account.parentNode.insertBefore(el.btn, account);

    el.panel = document.createElement("div");
    el.panel.className = "notif-panel";
    el.panel.hidden = true;
    el.panel.setAttribute("role", "dialog");
    el.panel.setAttribute("aria-label", "Notifications");

    const head = document.createElement("div");
    head.className = "notif-head";
    const h = document.createElement("strong");
    h.textContent = "Notifications";
    el.markAll = document.createElement("button");
    el.markAll.type = "button";
    el.markAll.className = "notif-link-btn";
    el.markAll.textContent = "Mark all read";
    head.append(h, el.markAll);

    el.list = document.createElement("div");
    el.list.className = "notif-list";

    const foot = document.createElement("a");
    foot.className = "notif-foot";
    foot.href = UniMartConfig.getPath("pages/notifications.html");
    foot.textContent = "View all notifications";

    el.panel.append(head, el.list, foot);
    document.body.appendChild(el.panel);

    el.btn.addEventListener("click", (e) => {
      e.preventDefault();
      setOpen(!panelOpen);
    });
    el.markAll.addEventListener("click", async () => {
      el.markAll.disabled = true;
      try {
        await NotificationService.markAllRead();
        unread = 0;
        renderBadge();
        renderPanel();
      } catch (error) {
        el.markAll.disabled = false;
        window.showToast?.("Could not mark notifications as read");
      }
    });
    document.addEventListener("click", (e) => {
      if (panelOpen && !el.panel.contains(e.target) && !el.btn.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panelOpen) {
        setOpen(false);
        el.btn.focus();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && AuthState.isLoggedIn() && Date.now() - lastFetch > MIN_GAP_MS) tick();
    });
    window.addEventListener("pagehide", stop);
    return true;
  };

  // Follows the login state: bell + polling only while logged in.
  const sync = () => {
    if (AuthState.isLoggedIn()) {
      if (!ensureMounted()) return;
      el.btn.hidden = false;
      refreshCount();
      start();
    } else {
      stop();
      unread = 0;
      if (el.btn) {
        renderBadge();
        el.btn.hidden = true;
        setOpen(false);
      }
    }
  };

  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.AuthState) return;
    await AuthState.init();
    sync();
    AuthState.onChange(sync);
  });

  return { refreshCount, buildItem, openNotification, linkFor, timeAgo };
})();

window.NotificationBell = NotificationBell;
