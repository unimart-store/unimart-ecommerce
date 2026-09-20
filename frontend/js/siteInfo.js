/**
 * Applies public business settings to elements marked with data-site="...".
 *
 * The HTML ships with the currently confirmed business details as built-in
 * fallback content. When settings load, they are applied on top:
 *   - a value that is present replaces the text/link;
 *   - a value the owner cleared hides that element (or its data-site-row);
 *   - a missing/invalid value can never render "undefined" or a broken link.
 * Text is always set with textContent (never innerHTML); links must be https
 * (or tel:/mailto: built here from validated values).
 */
const SiteInfo = (() => {
  const str = (v) => (typeof v === "string" ? v.trim() : "");

  const safeHttps = (v) => {
    try {
      const u = new URL(str(v));
      return u.protocol === "https:" ? u.href : null;
    } catch (e) {
      return null;
    }
  };
  const telHref = (phone) => {
    const d = str(phone).replace(/[^\d+]/g, "");
    return (d.match(/\d/g) || []).length >= 7 ? `tel:${d}` : null;
  };
  const mailHref = (email) => (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(str(email)) ? `mailto:${str(email)}` : null);

  const DAY_LABEL = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };

  const hoursText = (hours) => {
    if (!hours || !hours.enabled || !Array.isArray(hours.days) || hours.days.length === 0) return "";
    return hours.days
      .filter((d) => DAY_LABEL[d.day])
      .map((d) => `${DAY_LABEL[d.day]}: ${d.closed ? "Closed" : `${str(d.open)} - ${str(d.close)}`}`)
      .join("\n");
  };

  // key -> {text, href}. text/href null = "leave that part alone".
  const resolve = (key, s) => {
    const b = s.business || {};
    const social = s.social || {};
    switch (key) {
      case "phone": return { text: str(b.phone), href: telHref(b.phone), required: "text" };
      case "email": return { text: str(b.email), href: mailHref(b.email), required: "text" };
      case "address": return { text: str(b.address) || str(b.locationText), href: safeHttps(b.mapUrl), required: "text" };
      case "map": return { text: null, href: safeHttps(b.mapUrl), required: "href" };
      case "hours": return { text: hoursText(s.hours), href: null, required: "text" };
      case "facebook": return { text: null, href: safeHttps(social.facebook), required: "href" };
      case "instagram": return { text: null, href: safeHttps(social.instagram), required: "href" };
      case "tiktok": return { text: null, href: safeHttps(social.tiktok), required: "href" };
      case "whatsapp": return { text: null, href: null, wa: true, required: "href" };
      default: return null;
    }
  };

  const setHidden = (el, hidden) => {
    const target = (el.closest && el.closest("[data-site-row]")) || el;
    target.hidden = hidden;
    target.style.display = hidden ? "none" : "";
  };

  const apply = (settings, elements = document.querySelectorAll("[data-site]")) => {
    if (!settings || typeof settings !== "object") return;

    Array.from(elements).forEach((el) => {
      const key = el.dataset && el.dataset.site;
      const info = resolve(key, settings);
      if (!info) return;

      let href = info.href;
      if (info.wa) href = window.UniMartConfig ? UniMartConfig.getWhatsAppUrl(el.dataset.waText || "") : null;

      const missing = info.required === "text" ? !info.text : !href;
      if (missing) return setHidden(el, true);

      setHidden(el, false);
      if (info.text !== null && info.text !== undefined) {
        el.textContent = info.text;
        if (key === "hours") el.style.whiteSpace = "pre-line";
      }
      if (href) el.href = href;
      else if (el.removeAttribute && el.tagName === "A") el.removeAttribute("href"); // no map link -> plain text, not a dead link
    });
  };

  return { apply };
})();

window.SiteInfo = SiteInfo;

document.addEventListener("DOMContentLoaded", () => {
  if (!window.SiteSettings) return;
  SiteSettings.load().then((settings) => {
    if (settings) SiteInfo.apply(settings);
  });
});
