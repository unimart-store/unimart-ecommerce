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

  const renderForm = (settings, errors = {}) => {
    const count = Object.keys(errors).length;
    const summary = count ? `<div class="settings-error-summary" role="alert">Please fix the highlighted fields (${count} ${count === 1 ? "problem" : "problems"}).</div>` : "";
    return summary + renderBusiness(settings, errors) + renderContact(settings, errors) + renderHours(settings, errors) + renderDelivery(settings, errors) + renderPayment(settings, errors) + renderCouriers(settings, errors);
  };

  return { DAYS, escapeHtml, emptyArea, emptyCourier, setByPath, readFieldValue, toPayload, renderForm, idFor };
})();

window.AdminSettingsForm = AdminSettingsForm;
