/**
 * UNiMART Admin - Settings form logic (PURE: no DOM access, so it is unit-tested).
 *  - renderForm(settings, errors): the whole settings form as an HTML string
 *  - toPayload(settings):          what PUT /api/settings receives
 *  - setByPath / readFieldValue:   how an edited input updates the state
 * The backend validates every field again; nothing here is a security boundary.
 * All values are HTML-escaped when rendered.
 */
const AdminSettingsForm = (() => {
  const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const DAY_LABELS = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
  const AREA_TYPES = [
    ["local", "Local delivery (own delivery)"],
    ["paid", "Paid delivery (courier / flat fee)"],
    ["unsupported", "Not supported (we do not deliver)"],
  ];

  const escapeHtml = (value) =>
    String(value === undefined || value === null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const emptyArea = () => ({ name: "", type: "local", enabled: true, fee: null, minOrder: null, courierId: null, message: "" });
  const emptyCourier = () => ({ name: "", enabled: true, coverage: "", fee: null, feeNotes: "", codSupported: false, notes: "" });

  // ---- state updates ----
  const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  const setByPath = (obj, path, value) => {
    const keys = String(path).split(".");
    if (keys.some((k) => BLOCKED_KEYS.has(k))) return false;
    let target = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (target[keys[i]] === undefined || target[keys[i]] === null) return false;
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = value;
    return true;
  };

  // kind: "text" | "number" | "bool"
  const readFieldValue = (kind, raw, checked) => {
    if (kind === "bool") return Boolean(checked);
    if (kind === "number") {
      const text = String(raw === undefined || raw === null ? "" : raw).trim();
      if (text === "") return null;
      const n = Number(text);
      return Number.isFinite(n) ? n : text; // a non-number is sent as-is so the server can flag it
    }
    return String(raw === undefined || raw === null ? "" : raw);
  };

  // ---- payload ----
  const withId = (id, obj) => (id ? { id, ...obj } : obj);

  const toPayload = (s) => ({
    business: { ...s.business },
    social: { ...s.social },
    hours: { enabled: Boolean(s.hours.enabled), days: s.hours.days.map((d) => ({ day: d.day, closed: Boolean(d.closed), open: d.open || "", close: d.close || "" })) },
    delivery: {
      enabled: Boolean(s.delivery.enabled),
      localEnabled: Boolean(s.delivery.localEnabled),
      localFee: s.delivery.localFee,
      freeDeliveryMinOrder: s.delivery.freeDeliveryMinOrder,
      deliveryHours: s.delivery.deliveryHours,
      notes: s.delivery.notes,
      areas: s.delivery.areas.map((a) =>
        withId(a.id, {
          name: a.name,
          type: a.type,
          enabled: Boolean(a.enabled),
          fee: a.type === "paid" ? a.fee : null,
          minOrder: a.type === "unsupported" ? null : a.minOrder,
          courierId: a.type === "paid" && a.courierId ? a.courierId : null,
          message: a.type === "unsupported" ? a.message : "",
        })
      ),
    },
    payment: { whatsappEnabled: Boolean(s.payment.whatsappEnabled), codEnabled: Boolean(s.payment.codEnabled) },
    couriers: s.couriers.map((c) =>
      withId(c.id, { name: c.name, enabled: Boolean(c.enabled), coverage: c.coverage, fee: c.fee, feeNotes: c.feeNotes, codSupported: Boolean(c.codSupported), notes: c.notes })
    ),
    notifications: s.notifications
      ? {
          channels: { inApp: Boolean(s.notifications.channels.inApp), whatsapp: Boolean(s.notifications.channels.whatsapp) },
          whatsapp: {
            costAcknowledged: Boolean(s.notifications.whatsapp.costAcknowledged),
            adminNumber: s.notifications.whatsapp.adminNumber,
            adminTemplate: { name: s.notifications.whatsapp.adminTemplate.name, language: s.notifications.whatsapp.adminTemplate.language },
            customerTemplate: { name: s.notifications.whatsapp.customerTemplate.name, language: s.notifications.whatsapp.customerTemplate.language },
          },
          admin: {
            newOrder: Boolean(s.notifications.admin.newOrder),
            statusChange: Boolean(s.notifications.admin.statusChange),
            cancellation: Boolean(s.notifications.admin.cancellation),
            lowStock: Boolean(s.notifications.admin.lowStock),
            lowStockThreshold: s.notifications.admin.lowStockThreshold,
          },
          customer: {
            orderCreated: Boolean(s.notifications.customer.orderCreated),
            statusChange: Boolean(s.notifications.customer.statusChange),
            cancellation: Boolean(s.notifications.customer.cancellation),
          },
        }
      : undefined, // an older backend without notification settings: leave that section alone
    revision: s.revision,
  });

  // ---- rendering ----
  const idFor = (path) => `f-${String(path).replace(/[^a-zA-Z0-9]/g, "-")}`;

  const errorHtml = (errors, path) =>
    errors[path] ? `<span class="admin-error-text" data-error-for="${escapeHtml(path)}">${escapeHtml(errors[path])}</span>` : "";

  // kind: text | number | bool ; opts: {type, hint, max, rerender, wide}
  const field = (errors, path, label, value, kind = "text", opts = {}) => {
    const id = idFor(path);
    const invalid = errors[path] ? ' aria-invalid="true"' : "";
    const hint = opts.hint ? `<span class="admin-hint">${escapeHtml(opts.hint)}</span>` : "";
    const wide = opts.wide ? " admin-field--full" : "";

    if (kind === "bool") {
      return `<div class="admin-field${wide}">
        <div class="admin-checkbox-row">
          <input type="checkbox" id="${id}" data-path="${escapeHtml(path)}" data-kind="bool" ${opts.rerender ? 'data-rerender="true"' : ""} ${value ? "checked" : ""}${invalid} />
          <label for="${id}">${escapeHtml(label)}</label>
        </div>${hint}${errorHtml(errors, path)}</div>`;
    }
    if (opts.textarea) {
      return `<div class="admin-field${wide}"><label for="${id}">${escapeHtml(label)}</label>
        <textarea class="admin-textarea" id="${id}" rows="2" data-path="${escapeHtml(path)}" data-kind="text" maxlength="${opts.max || 300}"${invalid}>${escapeHtml(value)}</textarea>${hint}${errorHtml(errors, path)}</div>`;
    }
    const type = kind === "number" ? "number" : opts.type || "text";
    const extra = kind === "number" ? ' min="0" step="any" inputmode="decimal"' : ` maxlength="${opts.max || 200}"`;
    return `<div class="admin-field${wide}"><label for="${id}">${escapeHtml(label)}</label>
      <input class="admin-input" type="${type}" id="${id}" data-path="${escapeHtml(path)}" data-kind="${kind}" value="${escapeHtml(value === null || value === undefined ? "" : value)}"${extra}${invalid} autocomplete="off" />${hint}${errorHtml(errors, path)}</div>`;
  };

  const select = (errors, path, label, value, options, opts = {}) => {
    const id = idFor(path);
    const invalid = errors[path] ? ' aria-invalid="true"' : "";
    const optionsHtml = options
      .map(([v, text]) => `<option value="${escapeHtml(v)}" ${String(v) === String(value === null || value === undefined ? "" : value) ? "selected" : ""}>${escapeHtml(text)}</option>`)
      .join("");
    return `<div class="admin-field"><label for="${id}">${escapeHtml(label)}</label>
      <select class="admin-select" id="${id}" data-path="${escapeHtml(path)}" data-kind="text" ${opts.rerender ? 'data-rerender="true"' : ""}${invalid}>${optionsHtml}</select>${opts.hint ? `<span class="admin-hint">${escapeHtml(opts.hint)}</span>` : ""}${errorHtml(errors, path)}</div>`;
  };

  const card = (title, description, body) => `
    <section class="admin-card settings-card">
      <div class="admin-card__header"><h2>${escapeHtml(title)}</h2></div>
      <div class="admin-card__body">${description ? `<p class="settings-desc">${escapeHtml(description)}</p>` : ""}${body}</div>
    </section>`;

  const grid = (inner) => `<div class="settings-grid">${inner}</div>`;

  const renderBusiness = (s, e) =>
    card("Business Information", "Shown on the website footer and used in customer messages.", grid(
      field(e, "business.name", "Business name", s.business.name, "text", { max: 100 }) +
      field(e, "business.address", "Address", s.business.address, "text", { max: 200, wide: true, hint: "Full shop address as customers should read it." }) +
      field(e, "business.locationText", "Location / area", s.business.locationText, "text", { max: 200, hint: "e.g. town and district." }) +
      field(e, "business.mapUrl", "Google Maps link", s.business.mapUrl, "text", { max: 500, type: "url", wide: true, hint: "Paste the share link of your shop from Google Maps (must start with https://). Powers \"Get Directions\"." })
    ));

  const renderContact = (s, e) =>
    card("Contact & Social Links", "Leave a field empty to hide it from the website.", grid(
      field(e, "business.phone", "Phone", s.business.phone, "text", { max: 30 }) +
      field(e, "business.whatsappNumber", "WhatsApp number", s.business.whatsappNumber, "text", { max: 30, hint: "With country code, e.g. +977 98XXXXXXXX. Used for the WhatsApp buttons." }) +
      field(e, "business.email", "Email", s.business.email, "text", { max: 120, type: "email" }) +
      field(e, "social.facebook", "Facebook link", s.social.facebook, "text", { max: 500, type: "url" }) +
      field(e, "social.instagram", "Instagram link", s.social.instagram, "text", { max: 500, type: "url" }) +
      field(e, "social.tiktok", "TikTok link", s.social.tiktok, "text", { max: 500, type: "url" })
    ));

  const renderHours = (s, e) => {
    const rows = s.hours.days
      .map(
        (d, i) => `<div class="settings-hours-row">
          <span class="settings-hours-day">${escapeHtml(DAY_LABELS[d.day] || d.day)}</span>
          ${field(e, `hours.days.${i}.closed`, "Closed", d.closed, "bool", { rerender: true })}
          ${d.closed ? "" : field(e, `hours.days.${i}.open`, "Opens", d.open, "text", { type: "time", max: 5 }) + field(e, `hours.days.${i}.close`, "Closes", d.close, "text", { type: "time", max: 5 })}
        </div>`
      )
      .join("");
    return card("Business Hours", "Nothing is shown on the website until you turn this on.",
      field(e, "hours.enabled", "Show business hours on the website", s.hours.enabled, "bool") + errorHtml(e, "hours.days") + `<div class="settings-hours">${rows}</div>`);
  };

  const courierOptions = (s) => [["", "None - use the fee entered here"], ...s.couriers.filter((c) => c.id).map((c) => [c.id, c.name || "(unnamed courier)"])];

  const renderArea = (s, e, a, i) => {
    const p = `delivery.areas.${i}`;
    return `<div class="settings-item">
      <div class="settings-item__head"><strong>Area ${i + 1}${a.name ? ` - ${escapeHtml(a.name)}` : ""}</strong>
        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-action="remove-area" data-index="${i}">Remove</button></div>
      ${grid(
        field(e, `${p}.name`, "Area name", a.name, "text", { max: 80, hint: "What the customer picks at checkout, e.g. a town, district or zone." }) +
        select(e, `${p}.type`, "Delivery type", a.type, AREA_TYPES, { rerender: true }) +
        (a.type === "paid" ? field(e, `${p}.fee`, "Delivery fee (NPR)", a.fee, "number", { hint: "Leave empty to use the courier's fee." }) + select(e, `${p}.courierId`, "Courier", a.courierId, courierOptions(s), { hint: "Save your couriers first, then link them here." }) : "") +
        (a.type === "unsupported" ? field(e, `${p}.message`, "Message shown to customers", a.message, "text", { max: 200, wide: true, hint: "e.g. Sorry, we do not deliver here yet." }) : field(e, `${p}.minOrder`, "Minimum order (NPR)", a.minOrder, "number", { hint: "Optional. Orders below this cannot be delivered to this area." })) +
        field(e, `${p}.enabled`, "Active (customers can choose this area)", a.enabled, "bool")
      )}
    </div>`;
  };

  const renderDelivery = (s, e) => {
    const d = s.delivery;
    const areas = d.areas.map((a, i) => renderArea(s, e, a, i)).join("");
    return card("Delivery",
      "Customers choose an area at checkout and the server calculates the delivery fee from these rules. If you add no areas, orders are accepted with the delivery charge \"to be confirmed\".",
      grid(
        field(e, "delivery.enabled", "Accept delivery orders", d.enabled, "bool", { hint: "Turn off to stop all orders that need delivery." }) +
        field(e, "delivery.localEnabled", "Local delivery is available", d.localEnabled, "bool") +
        field(e, "delivery.localFee", "Local delivery fee (NPR)", d.localFee, "number", { hint: "Leave empty for free local delivery." }) +
        field(e, "delivery.freeDeliveryMinOrder", "Free local delivery from (NPR)", d.freeDeliveryMinOrder, "number", { hint: "Only used with a local fee: orders at or above this amount get free local delivery." }) +
        field(e, "delivery.deliveryHours", "Delivery hours", d.deliveryHours, "text", { max: 100, hint: "Shown for information, e.g. 10 AM - 6 PM." }) +
        field(e, "delivery.notes", "Delivery notes", d.notes, "text", { max: 300, wide: true })
      ) +
      `<h3 class="settings-subtitle">Delivery areas</h3>${errorHtml(e, "delivery.areas")}<div class="settings-list">${areas || '<p class="settings-empty">No areas yet - delivery charge is shown as "to be confirmed".</p>'}</div>
       <button type="button" class="admin-btn admin-btn--secondary admin-btn--sm" data-action="add-area">+ Add delivery area</button>`);
  };

  const renderPayment = (s, e) =>
    card("Payment", "Customers can only choose the methods enabled here.",
      field(e, "payment.whatsappEnabled", "Confirm & pay manually on WhatsApp", s.payment.whatsappEnabled, "bool") +
      field(e, "payment.codEnabled", "Cash on Delivery (COD)", s.payment.codEnabled, "bool", { hint: "Turned off until you confirm you want to offer COD." }));

  const renderCourier = (s, e, c, i) => {
    const p = `couriers.${i}`;
    return `<div class="settings-item">
      <div class="settings-item__head"><strong>Courier ${i + 1}${c.name ? ` - ${escapeHtml(c.name)}` : ""}</strong>
        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-action="remove-courier" data-index="${i}">Remove</button></div>
      ${grid(
        field(e, `${p}.name`, "Courier name", c.name, "text", { max: 60 }) +
        field(e, `${p}.fee`, "Standard fee (NPR)", c.fee, "number", { hint: "Used by paid areas linked to this courier." }) +
        field(e, `${p}.coverage`, "Coverage", c.coverage, "text", { max: 300, wide: true, hint: "Where this courier delivers (for your reference)." }) +
        field(e, `${p}.feeNotes`, "Pricing notes", c.feeNotes, "text", { max: 300, wide: true, hint: "Weight bands, COD charges, return charges... (for your reference)." }) +
        field(e, `${p}.notes`, "Notes", c.notes, "text", { max: 300, wide: true }) +
        field(e, `${p}.codSupported`, "Supports Cash on Delivery", c.codSupported, "bool") +
        field(e, `${p}.enabled`, "Active", c.enabled, "bool")
      )}
    </div>`;
  };

  const renderCouriers = (s, e) =>
    card("Courier Services", "Couriers you use for areas outside local delivery. Fees are yours to enter - none are pre-filled.",
      `${errorHtml(e, "couriers")}<div class="settings-list">${s.couriers.map((c, i) => renderCourier(s, e, c, i)).join("") || '<p class="settings-empty">No couriers added.</p>'}</div>
       <button type="button" class="admin-btn admin-btn--secondary admin-btn--sm" data-action="add-courier">+ Add courier</button>`);

  const renderNotifications = (s, e) => {
    const n = s.notifications;
    if (!n) return ""; // backend without notification settings: nothing to edit
    const sub = (t) => `<h3 class="settings-subtitle">${escapeHtml(t)}</h3>`;
    return card("Notifications",
      "Choose what you and your customers are told about. The bell (in-app) is free. WhatsApp is optional and off until you turn it on.",
      sub("Channels") + grid(
        field(e, "notifications.channels.inApp", "In-app notifications (the bell here and on the website)", n.channels.inApp, "bool", { wide: true }) +
        field(e, "notifications.channels.whatsapp", "Also send notifications on WhatsApp", n.channels.whatsapp, "bool", { wide: true, hint: "Business-initiated WhatsApp messages can be charged by Meta, and outside the 24-hour customer-service window they need a Meta-approved template. Uses your existing WhatsApp connection." })
      ) +
      sub("WhatsApp delivery") + grid(
        field(e, "notifications.whatsapp.costAcknowledged", "I understand Meta may charge for business-initiated WhatsApp messages", n.whatsapp.costAcknowledged, "bool", { wide: true, hint: "Required before the WhatsApp channel can be switched on." }) +
        field(e, "notifications.whatsapp.adminNumber", "Your WhatsApp number for alerts", n.whatsapp.adminNumber, "text", { max: 30, wide: true, hint: "Your own number, with country code (e.g. +977 98XXXXXXXX). Not the shop's chat number. Leave empty to send no alerts to yourself." }) +
        field(e, "notifications.whatsapp.adminTemplate.name", "Approved template for your alerts", n.whatsapp.adminTemplate.name, "text", { max: 100, hint: "Name exactly as approved in Meta. Two text variables: title, message." }) +
        field(e, "notifications.whatsapp.adminTemplate.language", "Template language", n.whatsapp.adminTemplate.language, "text", { max: 10, hint: "e.g. en or en_US" }) +
        field(e, "notifications.whatsapp.customerTemplate.name", "Approved template for customers", n.whatsapp.customerTemplate.name, "text", { max: 100, hint: "Used when the customer has not messaged you in the last 24 hours." }) +
        field(e, "notifications.whatsapp.customerTemplate.language", "Template language", n.whatsapp.customerTemplate.language, "text", { max: 10 })
      ) +
      sub("Alerts to you") + grid(
        field(e, "notifications.admin.newOrder", "New orders", n.admin.newOrder, "bool") +
        field(e, "notifications.admin.statusChange", "Order status changes", n.admin.statusChange, "bool") +
        field(e, "notifications.admin.cancellation", "Order cancellations", n.admin.cancellation, "bool") +
        field(e, "notifications.admin.lowStock", "Low-stock warnings", n.admin.lowStock, "bool") +
        field(e, "notifications.admin.lowStockThreshold", "Warn when stock is at or below", n.admin.lowStockThreshold, "number", { hint: "Required for low-stock warnings. Whole number." })
      ) +
      sub("Messages to customers") + grid(
        field(e, "notifications.customer.orderCreated", "Order placed", n.customer.orderCreated, "bool") +
        field(e, "notifications.customer.statusChange", "Order status changes", n.customer.statusChange, "bool") +
        field(e, "notifications.customer.cancellation", "Order cancelled", n.customer.cancellation, "bool")
      ));
  };

  const renderForm = (settings, errors = {}) => {
    const count = Object.keys(errors).length;
    const summary = count ? `<div class="settings-error-summary" role="alert">Please fix the highlighted fields (${count} ${count === 1 ? "problem" : "problems"}).</div>` : "";
    return summary + renderBusiness(settings, errors) + renderContact(settings, errors) + renderHours(settings, errors) + renderDelivery(settings, errors) + renderPayment(settings, errors) + renderCouriers(settings, errors) + renderNotifications(settings, errors);
  };

  return { DAYS, escapeHtml, emptyArea, emptyCourier, setByPath, readFieldValue, toPayload, renderForm, idFor };
})();

window.AdminSettingsForm = AdminSettingsForm;
