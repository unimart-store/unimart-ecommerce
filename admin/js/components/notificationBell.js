/**
 * UNiMART Admin - notification bell (topbar), plus the item builder shared
 * with the full Notifications page.
 *
 * Refresh strategy (no realtime infrastructure): the unread count is fetched
 * on load and then every 90s, but only while the tab is visible; returning to
 * the tab refreshes immediately (at most once per 30s); polling stops when the
 * page is left. Actions (open / mark read) update the UI at once.
 */
const AdminNotificationBell = (() => {
  const POLL_MS = 90 * 1000;
  const MIN_GAP_MS = 30 * 1000;
  const PANEL_LIMIT = 8;

  let unread = 0;
  let timer = null;
  let lastFetch = 0;
  let panelOpen = false;
  const el = {};

  // ---- helpers shared with the full page ----
  const linkFor = (n) => {
    if (n.data && n.data.orderNumber) return `orders.html?order=${encodeURIComponent(n.data.orderNumber)}`;
    if (n.type === "LOW_STOCK") return "products.html";
    return "notifications.html";
  };

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

  const TYPE_LABEL = { ORDER_CREATED: "New order", ORDER_STATUS_CHANGED: "Status", ORDER_CANCELLED: "Cancelled", LOW_STOCK: "Low stock" };

  // Builds one notification row with textContent only (values are never parsed as HTML).
  const buildItem = (n, { onOpen } = {}) => {
    const a = document.createElement("a");
    a.className = `admin-notif-item${n.readAt ? "" : " admin-notif-item--unread"}`;
    a.href = linkFor(n);

    const dot = document.createElement("span");
    dot.className = "admin-notif-dot";
    dot.setAttribute("aria-hidden", "true");

    const body = document.createElement("span");
    body.className = "admin-notif-body";
    const title = document.createElement("strong");
    title.textContent = n.title;
    const msg = document.createElement("span");
    msg.className = "admin-notif-msg";
    msg.textContent = n.message;
    const meta = document.createElement("span");
    meta.className = "admin-notif-meta";
    meta.textContent = `${TYPE_LABEL[n.type] || "Notification"} \u00B7 ${timeAgo(n.createdAt)}${n.readAt ? "" : " \u00B7 Unread"}`;
    body.append(title, msg, meta);

    a.append(dot, body);
    a.addEventListener("click", async (event) => {
      event.preventDefault();
      if (onOpen) await onOpen(n, a.href);
    });
    return a;
  };

  // Marks read (briefly awaited so the request isn't cut off by navigation), then goes to the order.
  const openNotification = async (n, href) => {
    if (!n.readAt) {
      unread = Math.max(0, unread - 1);
      renderBadge();
      await Promise.race([AdminNotificationService.markRead(n.id).catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
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
      unread = await AdminNotificationService.unreadCount();
      renderBadge();
    } catch (error) {
      // A failed refresh must never disturb the page: keep the last known count.
    }
  };

  // ---- dropdown ----
  const renderPanel = async () => {
    el.list.textContent = "";
    const loading = document.createElement("p");
    loading.className = "admin-notif-empty";
    loading.textContent = "Loading\u2026";
    el.list.appendChild(loading);
    try {
      const res = await AdminNotificationService.list({ page: 1, limit: PANEL_LIMIT });
      unread = res.unreadCount;
      renderBadge();
      el.list.textContent = "";
      if (!res.data.length) {
        const empty = document.createElement("p");
        empty.className = "admin-notif-empty";
        empty.textContent = "No notifications yet.";
        el.list.appendChild(empty);
      }
      res.data.forEach((n) => el.list.appendChild(buildItem(n, { onOpen: openNotification })));
      el.markAll.disabled = unread === 0;
    } catch (error) {
      el.list.textContent = "";
      const err = document.createElement("p");
      err.className = "admin-notif-empty";
      err.textContent = "Couldn't load notifications.";
      el.list.appendChild(err);
    }
  };

  const setOpen = (open) => {
    panelOpen = open;
    el.panel.hidden = !open;
    el.btn.setAttribute("aria-expanded", String(open));
    if (open) renderPanel();
  };

  // ---- polling ----
  const tick = () => {
    if (document.hidden) return; // no background polling
    refreshCount();
    if (panelOpen) renderPanel();
  };
  const start = () => {
    if (timer) return;
    timer = setInterval(tick, POLL_MS);
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };

  const mount = (container) => {
    if (!container || el.btn) return;

    el.btn = document.createElement("button");
    el.btn.type = "button";
    el.btn.className = "admin-notif-btn";
    el.btn.setAttribute("aria-haspopup", "true");
    el.btn.setAttribute("aria-expanded", "false");
    el.btn.setAttribute("aria-label", "Notifications");
    el.btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>`;
    el.badge = document.createElement("span");
    el.badge.className = "admin-notif-badge";
    el.badge.hidden = true;
    el.btn.appendChild(el.badge);

    el.panel = document.createElement("div");
    el.panel.className = "admin-notif-panel";
    el.panel.hidden = true;
    el.panel.setAttribute("role", "dialog");
    el.panel.setAttribute("aria-label", "Notifications");

    const head = document.createElement("div");
    head.className = "admin-notif-head";
    const h = document.createElement("strong");
    h.textContent = "Notifications";
    el.markAll = document.createElement("button");
    el.markAll.type = "button";
    el.markAll.className = "admin-btn admin-btn--ghost admin-btn--sm";
    el.markAll.textContent = "Mark all read";
    head.append(h, el.markAll);

    el.list = document.createElement("div");
    el.list.className = "admin-notif-list";

    const foot = document.createElement("a");
    foot.className = "admin-notif-foot";
    foot.href = "notifications.html";
    foot.textContent = "View all notifications";

    el.panel.append(head, el.list, foot);
    container.append(el.btn, el.panel);

    el.btn.addEventListener("click", () => setOpen(!panelOpen));
    el.markAll.addEventListener("click", async () => {
      el.markAll.disabled = true;
      try {
        await AdminNotificationService.markAllRead();
        unread = 0;
        renderBadge();
        renderPanel();
      } catch (error) {
        el.markAll.disabled = false;
        window.showAdminToast?.("Could not mark notifications as read", "error");
      }
    });
    document.addEventListener("click", (e) => {
      if (panelOpen && !container.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panelOpen) {
        setOpen(false);
        el.btn.focus();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - lastFetch > MIN_GAP_MS) tick();
    });
    window.addEventListener("pagehide", stop);

    refreshCount();
    start();
  };

  return { mount, refreshCount, buildItem, openNotification, linkFor, timeAgo };
})();

window.AdminNotificationBell = AdminNotificationBell;
