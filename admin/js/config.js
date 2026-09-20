/**
 * UNiMART Admin — Centralized environment/API configuration.
 * This is the ONLY file in the admin frontend allowed to contain a backend
 * URL. Every service builds requests through this file's getUrl(). Mirrors
 * frontend/js/config.js so both frontends stay consistent if the backend
 * ever moves.
 */
const AdminConfig = (() => {
  const IS_LOCAL_DEVELOPMENT =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  const LOCAL_BACKEND_URL = "http://localhost:5000";
  const PRODUCTION_BACKEND_URL = "https://unimart-ecommerce.onrender.com";

  const API_BASE_URL = IS_LOCAL_DEVELOPMENT
    ? LOCAL_BACKEND_URL
    : PRODUCTION_BACKEND_URL;

  const endpoints = {
    login: "/api/auth/login",
    logout: "/api/auth/logout",
    me: "/api/auth/me",
    categories: "/api/categories",
    products: "/api/products",
    orders: "/api/orders",
    settings: "/api/settings",
    uploadImages: "/api/uploads/images",
    uploadImage: "/api/uploads/image",
  };

  // Builds a full URL for a registered endpoint, optionally with a path
  // suffix (e.g. getUrl("products", "/64f...") -> ".../api/products/64f...")
  const getUrl = (name, suffix = "") => {
    const path = endpoints[name];
    if (!path) {
      throw new Error(`[AdminConfig] Unknown endpoint: "${name}"`);
    }
    return `${API_BASE_URL}${path}${suffix}`;
  };

  // ---- Admin frontend base path (for navigation, not the API) ----
  // Derived from where THIS script (config.js) actually resolved to, same
  // approach as the storefront's config.js - works whether the admin app is
  // served from the site root, a /admin/ subpath, or locally under Live
  // Server, without any hardcoded path.
  const ADMIN_BASE_URL = (() => {
    const thisScript =
      document.currentScript ||
      document.querySelector('script[src*="config.js"]');
    if (!thisScript) return new URL("/", window.location.href).href;
    // config.js is at "<adminRoot>/js/config.js" - ".." goes up to "<adminRoot>/"
    return new URL("..", thisScript.src).href;
  })();

  const getPath = (relativePath = "") => new URL(relativePath, ADMIN_BASE_URL).href;

  // The real storefront homepage - admin/ and frontend/ are sibling folders
  // in this repo, so this is derived the same way ADMIN_BASE_URL is, one
  // level further up. This assumes admin and storefront are served from the
  // same origin (true for local dev and for a typical single-host deploy);
  // if they're ever split across two different production hosts, this
  // constant is the one place to point at the real storefront domain.
  const STOREFRONT_URL = IS_LOCAL_DEVELOPMENT
  ? new URL("../frontend/index.html", ADMIN_BASE_URL).href
  : "https://unimartstore.vercel.app/";

  return Object.freeze({
    IS_LOCAL_DEVELOPMENT,
    API_BASE_URL,
    ADMIN_BASE_URL,
    STOREFRONT_URL,
    getUrl,
    getPath,
  });
})();

window.AdminConfig = AdminConfig;
