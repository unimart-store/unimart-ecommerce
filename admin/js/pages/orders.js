(() => {
  let allOrders = [];

  const cardBody = () => document.getElementById("ordersCardBody");

  const getFilters = () => ({
    status: document.getElementById("orderStatusFilter")?.value || "all",
    search: document.getElementById("orderSearchInput")?.value.trim().toLowerCase() || "",
  });

  const applyFilters = () => {
    const { status, search } = getFilters();
    return allOrders.filter((order) => {
      if (status !== "all" && order.status !== status) return false;
      if (search) {
        const haystack = `${order.orderId} ${order.customerName}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  };

  // ---- States ----

  const renderLoading = () => {
    cardBody().innerHTML = `
      <div class="admin-state">
        <div class="admin-spinner" role="status" aria-label="Loading"></div>
        <p class="admin-state__desc">Loading orders…</p>
      </div>
    `;
  };

  const renderError = (message) => {
    cardBody().innerHTML = `
      <div class="admin-state">
        <div class="admin-state__icon" aria-hidden="true">⚠</div>
        <div class="admin-state__title">Couldn't load orders</div>
        <div class="admin-state__desc">${AdminFormat.escapeHtml(message)}</div>
        <button class="admin-btn admin-btn--primary" id="ordersRetryBtn" type="button">Try again</button>
      </div>
    `;
    document.getElementById("ordersRetryBtn")?.addEventListener("click", loadOrders);
  };

  const renderEmpty = (hasFilters) => {
    cardBody().innerHTML = `
      <div class="admin-state">
        <div class="admin-state__icon" aria-hidden="true">\u2637</div>
        <div class="admin-state__title">${hasFilters ? "No orders match your filters" : "No orders yet"}</div>
        <div class="admin-state__desc">${hasFilters ? "Try a different search term or status." : "Orders placed by customers will show up here."}</div>
      </div>
    `;
  };

  const renderRow = (order) => `
    <tr>
      <td class="admin-cell-primary admin-cell-truncate" title="${AdminFormat.escapeHtml(order.orderId)}">${AdminFormat.escapeHtml(order.orderId)}</td>
      <td class="admin-cell-truncate" title="${AdminFormat.escapeHtml(order.customerName)}">${AdminFormat.escapeHtml(order.customerName)}</td>
      <td>${order.items?.length ?? 0}</td>
      <td>${AdminFormat.currency(order.totalAmount)}</td>
      <td><span class="admin-badge admin-badge--${AdminFormat.orderStatusBadge(order.status)}">${AdminFormat.escapeHtml(order.status)}</span></td>
      <td class="admin-cell-muted">${AdminFormat.date(order.createdAt)}</td>
      <td>
        <div class="admin-cell-actions">
          <button class="admin-btn admin-btn--secondary admin-btn--sm" data-view="${order._id}" type="button">View</button>
        </div>
      </td>
    </tr>
  `;

  const renderTable = (orders) => {
    cardBody().innerHTML = `
      <div class="admin-table-wrap">
        <table class="admin-table admin-table--orders">
          <thead>
            <tr><th>Order ID</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Placed</th><th></th></tr>
          </thead>
          <tbody>${orders.map(renderRow).join("")}</tbody>
        </table>
      </div>
    `;
    cardBody().querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const order = allOrders.find((o) => o._id === btn.dataset.view);
        if (order) openDetailModal(order);
      });
    });
  };

  const renderList = () => {
    const filtered = applyFilters();
    const { status, search } = getFilters();
    if (filtered.length === 0) {
      renderEmpty(status !== "all" || Boolean(search));
    } else {
      renderTable(filtered);
    }
  };

  const loadOrders = async () => {
    renderLoading();
    try {
      const res = await AdminOrderService.getAll();
      allOrders = Array.isArray(res) ? res : [];
      renderList();
    } catch (error) {
      renderError(error?.message || "Something went wrong loading orders.");
    }
  };

  // ---- Detail modal ----

  const renderItemsTable = (items, order) => {
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    return `
      <table class="admin-order-items">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${AdminFormat.escapeHtml(item.name)}</td>
              <td>${item.quantity}</td>
              <td>${AdminFormat.currency(item.price)}</td>
              <td>${AdminFormat.currency(item.price * item.quantity)}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>${AdminOrderView.renderTotalsRows(order, total)}</tfoot>
      </table>
    `;
  };

  const openDetailModal = (order) => {
    // Only offer the current status plus the moves the server will accept.
    const nextStatuses = ADMIN_ORDER_TRANSITIONS[order.status] || [];
    const isFinal = nextStatuses.length === 0;
    const statusOptions = [order.status, ...nextStatuses];

    const template = document.getElementById("orderDetailModalTemplate");
    document.body.appendChild(template.content.cloneNode(true));

    document.getElementById("orderDetailTitle").textContent = order.orderId;
    const body = document.getElementById("orderDetailBody");
    body.innerHTML = `
      <div class="admin-order-detail-section">
        <h3>Customer</h3>
        <dl class="admin-order-detail-grid">
          <div><dt>Name</dt><dd>${AdminFormat.escapeHtml(order.customerName)}</dd></div>
          <div><dt>Phone</dt><dd>${AdminFormat.escapeHtml(order.customerPhone)}</dd></div>
          <div style="grid-column: 1 / -1;"><dt>Address</dt><dd>${AdminFormat.escapeHtml(order.customerAddress)}</dd></div>
        </dl>
      </div>

      ${AdminOrderView.renderDeliverySection(order)}

      <div class="admin-order-detail-section">
        <h3>Payment</h3>
        <dl class="admin-order-detail-grid">
          <div><dt>Method</dt><dd>${AdminFormat.escapeHtml(order.paymentMethod)}</dd></div>
          <div><dt>Payment Status</dt><dd><span class="admin-badge admin-badge--${order.paymentStatus === "Paid" ? "success" : order.paymentStatus === "Failed" ? "danger" : "neutral"}">${AdminFormat.escapeHtml(order.paymentStatus)}</span></dd></div>
          <div><dt>Placed</dt><dd>${AdminFormat.dateTime(order.createdAt)}</dd></div>
          <div><dt>Last Updated</dt><dd>${AdminFormat.dateTime(order.updatedAt)}</dd></div>
        </dl>
      </div>

      <div class="admin-order-detail-section">
        <h3>Items</h3>
        ${renderItemsTable(order.items || [], order)}
      </div>

      <div class="admin-order-detail-section">
        <h3>Order Status</h3>
        <div class="admin-order-status-row">
          <select class="admin-select" id="orderStatusSelect" style="width: auto; min-width: 160px;" ${isFinal ? "disabled" : ""}>
            ${statusOptions.map((s) => `<option value="${s}" ${s === order.status ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          <button class="admin-btn admin-btn--primary admin-btn--sm" id="orderStatusUpdateBtn" type="button" ${isFinal ? "disabled" : ""}>
            <span id="orderStatusUpdateText">Update Status</span>
          </button>
        </div>
        ${isFinal ? `<p class="admin-state__desc" style="margin-top: 8px;">This order is ${AdminFormat.escapeHtml(order.status)} - its status can no longer be changed.</p>` : ""}
      </div>
    `;

    const backdrop = document.getElementById("orderDetailBackdrop");
    const close = () => backdrop.remove();
    document.getElementById("orderDetailCloseBtn").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

    document.getElementById("orderStatusUpdateBtn").addEventListener("click", () => {
      const select = document.getElementById("orderStatusSelect");
      const newStatus = select.value;
      if (newStatus === order.status) {
        showAdminToast("Status is already set to that value.", "info");
        return;
      }
      if (newStatus === "Cancelled") {
        openCancelConfirm(order, close);
      } else {
        applyStatusUpdate(order, newStatus, close);
      }
    });
  };

  const applyStatusUpdate = async (order, newStatus, closeParentModal) => {
    const btn = document.getElementById("orderStatusUpdateBtn");
    const text = document.getElementById("orderStatusUpdateText");
    if (btn) { btn.disabled = true; text.textContent = "Updating…"; }

    try {
      const updated = await AdminOrderService.updateStatus(order._id, newStatus);
      const idx = allOrders.findIndex((o) => o._id === order._id);
      if (idx !== -1) allOrders[idx] = updated;
      showAdminToast(`Order status updated to ${newStatus}.`, "success");
      closeParentModal();
      renderList();
    } catch (error) {
      showAdminToast(error?.message || "Something went wrong updating the status.", "error");
      if (btn) { btn.disabled = false; text.textContent = "Update Status"; }
    }
  };

  const openCancelConfirm = (order, closeParentModal) => {
    const template = document.getElementById("orderStatusConfirmTemplate");
    document.body.appendChild(template.content.cloneNode(true));

    const backdrop = document.getElementById("orderStatusConfirmBackdrop");
    const okBtn = document.getElementById("orderStatusConfirmOkBtn");
    const okText = document.getElementById("orderStatusConfirmOkText");

    const close = () => backdrop.remove();
    document.getElementById("orderStatusConfirmCancelBtn").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

    okBtn.addEventListener("click", async () => {
      okBtn.disabled = true;
      okText.textContent = "Cancelling…";
      try {
        const updated = await AdminOrderService.updateStatus(order._id, "Cancelled");
        const idx = allOrders.findIndex((o) => o._id === order._id);
        if (idx !== -1) allOrders[idx] = updated;
        showAdminToast("Order cancelled.", "success");
        close();
        closeParentModal();
        renderList();
      } catch (error) {
        showAdminToast(error?.message || "Something went wrong cancelling the order.", "error");
        okBtn.disabled = false;
        okText.textContent = "Cancel Order";
      }
    });
  };

  (async () => {
    const user = await AdminLayout.guardAndRender("orders");
    if (!user) return;

    const contentEl = document.getElementById("adminContent");
    const template = document.getElementById("ordersTemplate");
    contentEl.appendChild(template.content.cloneNode(true));

    document.getElementById("orderStatusFilter")?.addEventListener("change", renderList);
    document.getElementById("orderSearchInput")?.addEventListener("input", debounce(renderList, 300));

    await loadOrders();
  })();
})();
