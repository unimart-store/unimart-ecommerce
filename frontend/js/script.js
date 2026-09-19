/**
 * UNiMART — Product listing page (index.html).
 * Search/category/pagination now all go through the backend's real query
 * params instead of fetching every product and filtering in the browser.
 * A request token guards against a slow earlier request overwriting a
 * faster later one (e.g. typing quickly in search).
 */
(() => {
  const grid = document.getElementById("productGrid");
  if (!grid) return; // not on the listing page

  const loader = document.getElementById("indexLoader");
  const content = document.getElementById("indexContent");
  const noResult = document.getElementById("noResult");
  const pagination = document.getElementById("pagination");

  const state = {
    page: 1,
    limit: 20,
    category: new URLSearchParams(window.location.search).get("category") || "",
    categoryName: "",
    search: new URLSearchParams(window.location.search).get("search") || "",
  };

  let requestToken = 0;

  const renderActiveFilterChip = () => {
    const row = document.getElementById("activeFilterRow");
    if (!row) return;
    if (!state.category) {
      row.innerHTML = "";
      return;
    }
    row.innerHTML = `
      <div class="filter-chip">
        ${state.categoryName || state.category}
        <button aria-label="Remove filter" id="clearCategoryChip">✕</button>
      </div>
    `;
    document.getElementById("clearCategoryChip").addEventListener("click", () => {
      window.applyCategoryFilter(null, null);
      window.resetCategoryNavHighlight?.();
    });
  };

  const renderCard = (product) => {
    const p = Normalize.product(product);
    const discount = p.oldPrice && p.oldPrice > p.price
      ? Math.round(((p.oldPrice - p.price) / p.oldPrice) * 100)
      : null;

    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-img">
        <img src="${p.imageUrl}" alt="${p.name}" loading="lazy" onerror="this.src='${Normalize.PLACEHOLDER_IMAGE}'">
        <span class="wishlist" aria-label="Add to wishlist" onclick="event.stopPropagation()"><i class="fa fa-heart"></i></span>
      </div>
      <div class="product-info">
        <h3 class="product-title">${p.name}</h3>
        <p class="short-desc">${(p.description || "").slice(0, 60)}</p>
        <div class="price-row">
          <span class="price">${UniMartConfig.formatPrice(p.price)}</span>
          ${p.oldPrice ? `<span class="old-price">${UniMartConfig.formatPrice(p.oldPrice)}</span>` : ""}
          ${discount ? `<span class="discount">${discount}% OFF</span>` : ""}
        </div>
      </div>
    `;
    card.addEventListener("click", () => {
      window.location.href = UniMartConfig.getPath(`product.html?id=${p._id}`);
    });
    return card;
  };

  const renderPagination = (meta) => {
    pagination.innerHTML = "";
    if (!meta || meta.totalPages <= 1) return;

    for (let i = 1; i <= meta.totalPages; i++) {
      const btn = document.createElement("button");
      btn.textContent = i;
      btn.className = i === meta.currentPage ? "active" : "";
      btn.addEventListener("click", () => {
        state.page = i;
        load();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      pagination.appendChild(btn);
    }
  };

  const load = async () => {
    const thisRequest = ++requestToken;
    loader.style.display = "flex";
    content.style.display = "none";
    renderActiveFilterChip();

    try {
      const res = await ProductService.getProducts({
        page: state.page,
        limit: state.limit,
        category: state.category || undefined,
        search: state.search || undefined,
        onlyActive: true,
      });

      if (thisRequest !== requestToken) return; // a newer request already superseded this one

      grid.innerHTML = "";
      const products = res?.data || [];

      if (products.length === 0) {
        noResult.style.display = "block";
        noResult.innerHTML = state.category || state.search
          ? `No products found.${' '}<button id="clearFiltersBtn" class="link-btn">Clear filters</button>`
          : "No products found.";
        document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
          state.category = "";
          state.categoryName = "";
          state.search = "";
          state.page = 1;
          window.resetCategoryNavHighlight?.();
          load();
        });
      } else {
        noResult.style.display = "none";
        products.forEach((p) => grid.appendChild(renderCard(p)));
      }

      renderPagination(res?.pagination);
    } catch (error) {
      if (thisRequest !== requestToken) return;

      // Customer-facing message stays simple; the actual cause goes to
      // console only, so it can be diagnosed without exposing internals.
      console.error("[Products] Failed to load:", { status: error.status, message: error.message, networkError: error.networkError || false });
      if (error.networkError) {
        console.error("[Products] Likely cause: backend unreachable - server down, wrong API_BASE_URL, or the request never got an HTTP response at all.");
      } else if (error.status === 429) {
        console.error("[Products] Likely cause: rate limit exceeded (429) - expected under heavy repeated requests, not a bug.");
      } else if (error.status >= 500) {
        console.error("[Products] Likely cause: backend server error (5xx) - check backend logs / MongoDB connection.");
      }

      noResult.style.display = "block";
      noResult.innerHTML = `Couldn't load products. <button id="retryLoadBtn" class="link-btn">Try Again</button>`;
      document.getElementById("retryLoadBtn")?.addEventListener("click", load);
    } finally {
      if (thisRequest === requestToken) {
        loader.style.display = "none";
        content.style.display = "block";
      }
    }
  };

  // Exposed for layout.js (search box + category nav) to call into.
  window.applySearch = (value) => {
    state.search = value;
    state.page = 1;
    load();
  };
  window.applyCategoryFilter = (slug, name) => {
    state.category = slug || "";
    state.categoryName = name || "";
    state.page = 1;
    load();
  };

  // The nav "Order on WhatsApp" button had no link at all on this page (only the
  // product page ever set it). Give it the same chat link as the footer.
  const navWhatsappBtn = document.getElementById("whatsappBtn");
  if (navWhatsappBtn) {
    navWhatsappBtn.href = UniMartConfig.getWhatsAppUrl("Hello Unimart Team, I want to know more");
  }

  load();
})();
