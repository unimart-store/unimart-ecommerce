/**
 * UNiMART Admin — Shared formatting helpers.
 */
const AdminFormat = {
  currency: (amount) => {
     const n = Number(amount);
     if (Number.isNaN(n)) return "—";
   
     return `NPR ${new Intl.NumberFormat("en-IN", {
       maximumFractionDigits: 2,
     }).format(n)}`;
   },

  date: (isoString) => {
    if (!isoString) return "—";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  },

  dateTime: (isoString) => {
    if (!isoString) return "—";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  },

  // Order status -> badge modifier class
  orderStatusBadge: (status) => {
    const map = {
      Pending: "warning",
      Processing: "info",
      Shipped: "info",
      Delivered: "success",
      Cancelled: "danger",
    };
    return map[status] || "neutral";
  },

  // Product status -> badge modifier class
  productStatusBadge: (status) => (status === "active" ? "success" : "neutral"),

  escapeHtml: (str) => {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  },
};

window.AdminFormat = AdminFormat;
