/**
 * UNiMART - business constants used by SERVER-SIDE validation.
 *
 * PHASE 1: fixed constants (the business is Nepal-only today).
 * PHASE 2: these values move to admin-managed settings stored in MongoDB.
 * That is why validators and controllers never hard-code any of this - they
 * receive a config object (defaulting to this file), so swapping the source
 * later does not touch checkout logic.
 *
 * Deliberately NOT here (Phase 2, uncle-controlled): store address, map link,
 * opening hours, delivery areas/fees/couriers, free-delivery rules.
 */
module.exports = Object.freeze({
  country: "Nepal",
  countryCode: "NP",
  // Accepted spellings for the `country` field. Anything else is rejected.
  countryAliases: Object.freeze(["nepal", "np", "नेपाल"]),
  phoneCountryCode: "+977",
  currency: "NPR",

  // Payment methods the storefront actually offers today (checkout.html:
  // only "WhatsApp Order" is enabled; eSewa is a disabled placeholder).
  paymentMethods: Object.freeze(["WhatsApp"]),
  defaultPaymentMethod: "WhatsApp",
});
