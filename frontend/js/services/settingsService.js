/**
 * Public business settings (footer/contact/hours/delivery areas/payment
 * options) from GET /api/settings/public. Loaded at most once per page and
 * NEVER rejects: if the request fails, load() resolves to null and every page
 * keeps its built-in content, so a settings outage cannot break the shop.
 * These are display settings only - the server re-checks everything that
 * matters (delivery fee, total, payment method) when an order is placed.
 */
const SiteSettings = (() => {
  let promise = null;
  let data = null;

  const load = () => {
    if (!promise) {
      promise = ApiClient.get(UniMartConfig.getUrl("settings", "/public"))
        .then((res) => {
          data = res && res.data && typeof res.data === "object" ? res.data : null;
          if (data && data.business) UniMartConfig.setWhatsAppNumber(data.business.whatsappNumber);
          return data;
        })
        .catch(() => null);
    }
    return promise;
  };

  return { load, get: () => data };
})();

window.SiteSettings = SiteSettings;
