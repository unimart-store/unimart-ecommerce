const OrderStatusColors = {
  Pending: "#f0ad4e",
  Processing: "#5bc0de",
  Shipped: "#0275d8",
  Delivered: "#1a7f37",
  Cancelled: "#d32f2f",
};

const formatNPR = (amount) => UniMartConfig.formatPrice(amount);

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

async function renderOrderList() {
  const container = document.getElementById("ordersContainer");
  let orders = [];
  try {
    orders = await OrderService.getMyOrders();
  } catch (error) {
    container.innerHTML = `<p class="orders-error">Could not load your orders. Please try again.</p>`;
    return;
  }

  if (orders.length === 0) {
    container.innerHTML = `
      <div class="empty-cart-msg">
        <span class="icon">📦</span>
        <h3>No orders yet</h3>
        <a href="${UniMartConfig.getPath("index.html")}" class="shop-now-btn">Start Shopping</a>
      </div>`;
    return;
  }

  container.innerHTML = orders.map((order) => `
    <a class="order-card" href="orders.html?id=${order._id}">
      <div class="order-card-top">
        <strong>${order.orderId}</strong>
        <span class="order-status" style="background:${OrderStatusColors[order.status] || "#999"}">${order.status}</span>
      </div>
      <p class="order-meta">Placed: ${formatDate(order.createdAt)} · ${order.items.length} item${order.items.length === 1 ? "" : "s"}</p>
      <p class="order-total">${formatNPR(order.totalAmount)}</p>
    </a>
  `).join("");
}

async function renderOrderDetail(id) {
  const container = document.getElementById("ordersContainer");
  let order;
  try {
    order = await OrderService.getMyOrderById(id);
  } catch (error) {
    container.innerHTML = `<p class="orders-error">Order not found.</p><a href="orders.html" class="shop-now-btn">Back to My Orders</a>`;
    return;
  }

  container.innerHTML = `
    <a href="orders.html" class="back-to-orders">⬅ My Orders</a>
    <div class="order-detail-card">
      <div class="order-card-top">
        <strong>${order.orderId}</strong>
        <span class="order-status" style="background:${OrderStatusColors[order.status] || "#999"}">${order.status}</span>
      </div>
      <p class="order-meta">Placed: ${formatDate(order.createdAt)}</p>
      <hr>
      ${order.items.map((item) => `
        <div class="order-item-row">
          <span>${item.name} × ${item.quantity}</span>
          <span>${formatNPR(item.price * item.quantity)}</span>
        </div>
      `).join("")}
      <hr>
      <div class="order-item-row order-total-row"><span>Total</span><span>${formatNPR(order.totalAmount)}</span></div>
      <p class="order-meta">Delivery to: ${order.customerAddress}</p>
      ${order.status === "Pending" ? `
        <div id="cancelOrderArea">
          <button id="cancelOrderBtn" class="btn-checkout cancel-btn">Cancel Order</button>
        </div>
      ` : ""}
    </div>
  `;

  document.getElementById("cancelOrderBtn")?.addEventListener("click", () => {
    const area = document.getElementById("cancelOrderArea");
    area.innerHTML = `
      <p class="cancel-confirm-text">Are you sure you want to cancel this order?</p>
      <div class="cancel-confirm-actions">
        <button id="confirmCancelBtn" class="btn-checkout cancel-btn">Yes, Cancel Order</button>
        <button id="dismissCancelBtn" class="link-btn">Never mind</button>
      </div>
    `;

    document.getElementById("dismissCancelBtn").addEventListener("click", () => renderOrderDetail(id));

    document.getElementById("confirmCancelBtn").addEventListener("click", async (e) => {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = "Cancelling...";
      try {
        await OrderService.cancelMyOrder(id);
        window.showToast?.("Order cancelled");
        renderOrderDetail(id);
      } catch (error) {
        window.showToast?.(error.message || "Could not cancel order");
        renderOrderDetail(id);
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (window.AuthState && !AuthState.initialized) {
    await AuthState.init();
  }
  if (!AuthState.isLoggedIn()) {
    window.location.href = UniMartConfig.getPath("index.html");
    return;
  }

  const id = new URLSearchParams(window.location.search).get("id");
  if (id) {
    renderOrderDetail(id);
  } else {
    renderOrderList();
  }
});
