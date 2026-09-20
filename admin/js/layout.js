/**
 * UNiMART Admin — Shell layout. Renders the sidebar + topbar into
 * #adminShellRoot on every authenticated admin page, wires up mobile nav
 * toggle, active-route highlighting, the profile dropdown (account info +
 * logout with confirmation).
 *
 * Usage: each protected page includes config.js, apiClient.js, authService.js,
 * authState.js, toast.js, then this file, then calls:
 *   AdminLayout.guardAndRender('dashboard')  // 'dashboard' | 'categories' | 'products' | 'orders' | 'settings'
 * which resolves to the current user (redirecting to login if not an admin)
 * and only then renders the shell + reveals the page content.
 */
const AdminLayout = (() => {
  const NAV_ITEMS = [
    { key: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "\u25A6" },
    { key: "categories", label: "Categories", href: "categories.html", icon: "\u2637" },
    { key: "products", label: "Products", href: "products.html", icon: "\u25A3" },
    { key: "orders", label: "Orders", href: "orders.html", icon: "\u2637" },
    { key: "settings", label: "Settings", href: "settings.html", icon: "\u2699" },
  ];

  const initials = (name) => {
    if (!name) return "A";
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "A";
  };

  const escapeHtml = (str) => (window.AdminFormat?.escapeHtml ? AdminFormat.escapeHtml(str) : String(str ?? ""));

  // ---- Logout confirmation ----

  const performLogout = async () => {
    try {
      await AdminAuthState.logout();
    } catch (err) {
      // Even if the network call fails, we still want to send the admin
      // back to login rather than leave them stuck on a broken screen.
      console.error("[AdminLayout] Logout request failed:", err);
    }
    window.location.href = AdminConfig.getPath("pages/login.html");
  };

  const openLogoutConfirm = () => {
    const backdrop = document.createElement("div");
    backdrop.className = "admin-modal-backdrop";
    backdrop.innerHTML = `
      <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="logoutConfirmTitle">
        <div class="admin-modal__body">
          <div class="admin-confirm-icon admin-confirm-icon--danger" aria-hidden="true">!</div>
          <h2 id="logoutConfirmTitle">Log out?</h2>
          <p style="color: var(--admin-text-muted); font-size: var(--admin-fs-sm); margin-top: var(--admin-sp-2);">You'll need to sign in again to access the admin panel.</p>
          <div class="admin-form-actions">
            <button class="admin-btn admin-btn--secondary" type="button" data-logout-cancel>Cancel</button>
            <button class="admin-btn admin-btn--danger" type="button" data-logout-confirm>
              <span>Log out</span>
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector("[data-logout-cancel]").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
    });

    backdrop.querySelector("[data-logout-confirm]").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.querySelector("span").textContent = "Logging out…";
      await performLogout();
    });
  };

  // ---- Account panel (read-only - backend has no password/profile-edit endpoints yet) ----

  const openAccountModal = (user) => {
    const backdrop = document.createElement("div");
    backdrop.className = "admin-modal-backdrop";
    const memberSince = user.createdAt && window.AdminFormat ? AdminFormat.date(user.createdAt) : null;

    backdrop.innerHTML = `
      <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="accountModalTitle">
        <div class="admin-modal__header">
          <h2 id="accountModalTitle">Account</h2>
          <button class="admin-modal__close" type="button" data-account-close aria-label="Close">&times;</button>
        </div>
        <div class="admin-modal__body">
          <div class="admin-account-field">
            <label>Name</label>
            <div class="admin-account-value">${escapeHtml(user.name)}</div>
          </div>
          <div class="admin-account-field">
            <label>Email</label>
            <div class="admin-account-value">${escapeHtml(user.email)}</div>
          </div>
          <div class="admin-account-field">
            <label>Role</label>
            <div class="admin-account-value" style="text-transform: capitalize;">${escapeHtml(user.role)}</div>
          </div>
          ${memberSince ? `
          <div class="admin-account-field">
            <label>Member Since</label>
            <div class="admin-account-value">${memberSince}</div>
          </div>` : ""}
          <div class="admin-account-note">Password and profile editing aren't available yet - this section will support them once the backend adds account-management endpoints.</div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector("[data-account-close]").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
    });
  };

  // ---- Profile dropdown ----

  const wireUserMenu = (user) => {
    const wrap = document.getElementById("adminUserMenuWrap");
    const btn = document.getElementById("adminUserMenuBtn");
    if (!wrap || !btn) return;

    const closeMenu = () => {
      const dropdown = document.getElementById("adminUserDropdown");
      dropdown?.remove();
      btn.setAttribute("aria-expanded", "false");
    };

    const openMenu = () => {
      if (document.getElementById("adminUserDropdown")) return;
      const dropdown = document.createElement("div");
      dropdown.className = "admin-user-dropdown";
      dropdown.id = "adminUserDropdown";
      dropdown.innerHTML = `
        <div class="admin-user-dropdown__header">
          <div class="admin-user-dropdown__name">${escapeHtml(user.name || "Admin")}</div>
          <div class="admin-user-dropdown__email">${escapeHtml(user.email || "")}</div>
        </div>
        <button class="admin-user-dropdown__item" type="button" data-menu-account>Account</button>
        <button class="admin-user-dropdown__item admin-user-dropdown__item--danger" type="button" data-menu-logout>Log out</button>
      `;
      wrap.appendChild(dropdown);
      btn.setAttribute("aria-expanded", "true");

      dropdown.querySelector("[data-menu-account]").addEventListener("click", () => {
        closeMenu();
        openAccountModal(user);
      });
      dropdown.querySelector("[data-menu-logout]").addEventListener("click", () => {
        closeMenu();
        openLogoutConfirm();
      });
    };

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (document.getElementById("adminUserDropdown")) closeMenu();
      else openMenu();
    });

    document.addEventListener("click", (e) => {
      const dropdown = document.getElementById("adminUserDropdown");
      if (dropdown && !wrap.contains(e.target)) closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
  };

  // ---- Shell render ----

  const renderShell = (activeKey, user) => {
    const root = document.getElementById("adminShellRoot");
    if (!root) return;

    const navHtml = NAV_ITEMS.map((item) => `
      <a class="admin-nav-link" href="${item.href}" ${item.key === activeKey ? 'aria-current="page"' : ""}>
        <span class="admin-nav-icon" aria-hidden="true">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    `).join("");

    root.innerHTML = `
      <div class="admin-sidebar-backdrop" id="adminSidebarBackdrop"></div>
      <aside class="admin-sidebar" id="adminSidebar" aria-label="Admin navigation">
        <div class="admin-sidebar__brand">
          <span class="admin-sidebar__brand-mark" aria-hidden="true">U</span>
          <span>UNiMART Admin</span>
        </div>
        <nav class="admin-sidebar__nav">${navHtml}</nav>
        <div class="admin-sidebar__footer">
          <a class="admin-nav-link" href="${AdminConfig.STOREFRONT_URL}" target="_blank" rel="noopener" data-storefront-link>
            <span class="admin-nav-icon" aria-hidden="true">\u2197</span>
            <span>View Storefront</span>
          </a>
        </div>
      </aside>
      <div class="admin-main">
        <header class="admin-topbar">
          <div class="admin-topbar__left">
            <button class="admin-mobile-toggle" id="adminMobileToggle" aria-label="Toggle navigation menu" aria-expanded="false">
              <span aria-hidden="true">\u2630</span>
            </button>
            <span class="admin-topbar__title" id="adminTopbarTitle"></span>
          </div>
          <div class="admin-topbar__right">
            <div class="admin-user-menu-wrap" id="adminUserMenuWrap">
              <button class="admin-user-menu-btn" id="adminUserMenuBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">
                <span class="admin-user-avatar" aria-hidden="true">${user.avatar ? `<img src="${user.avatar}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />` : initials(user.name)}</span>
                <span class="admin-user-info">
                  <span class="admin-user-name">${escapeHtml(user.name || "Admin")}</span>
                  <span class="admin-user-role">${escapeHtml(user.role || "admin")}</span>
                </span>
                <span class="admin-user-menu-caret" aria-hidden="true">\u25BE</span>
              </button>
            </div>
          </div>
        </header>
        <main class="admin-content" id="adminContent"></main>
      </div>
      <div id="toastContainer" aria-live="polite"></div>
    `;

    const activeItem = NAV_ITEMS.find((i) => i.key === activeKey);
    const titleEl = document.getElementById("adminTopbarTitle");
    if (titleEl) titleEl.textContent = activeItem ? activeItem.label : "Admin";

    // Mobile nav toggle
    const shell = document.getElementById("adminShell");
    const toggleBtn = document.getElementById("adminMobileToggle");
    const backdrop = document.getElementById("adminSidebarBackdrop");
    const closeSidebar = () => {
      shell?.classList.remove("admin-sidebar-open");
      toggleBtn?.setAttribute("aria-expanded", "false");
    };
    toggleBtn?.addEventListener("click", () => {
      const isOpen = shell?.classList.toggle("admin-sidebar-open");
      toggleBtn.setAttribute("aria-expanded", String(Boolean(isOpen)));
    });
    backdrop?.addEventListener("click", closeSidebar);
    document.querySelectorAll(".admin-nav-link").forEach((link) => link.addEventListener("click", closeSidebar));

    wireUserMenu(user);
  };

  // Resolves the current admin, redirecting to login when not authenticated
  // or not an admin. Returns the user object on success so the calling page
  // can proceed to render its own content. This is a UX guard only - the
  // real security boundary is the backend's protect + authorize("admin").
  const guardAndRender = async (activeKey) => {
    const user = await AdminAuthState.init();

    if (!user || user.role !== "admin") {
      window.location.href = AdminConfig.getPath("pages/login.html");
      return null;
    }

    renderShell(activeKey, user);
    return user;
  };

  return { guardAndRender, NAV_ITEMS };
})();

window.AdminLayout = AdminLayout;
