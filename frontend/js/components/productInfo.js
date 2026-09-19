  function renderProductInfo(product) {

    const productName =
        document.getElementById("productName");

    const productPrice =
        document.getElementById("productPrice");

    const oldPrice =
        document.getElementById("oldPrice");

    const discount =
        document.getElementById("discount");

    const productDesc =
        document.getElementById("productDesc");

    if (productName) {
        productName.textContent =
            product.name || "Unnamed Product";
    }

    const price = product.price || 0;

    if (productPrice) {
        productPrice.textContent =
            UniMartConfig.formatPrice(price);
    }

    if (oldPrice) {
        oldPrice.textContent =
            product.oldPrice
                ? UniMartConfig.formatPrice(product.oldPrice)
                : "";
    }

    if (discount) {
        discount.textContent =
            product.discount
                ? `${product.discount}% OFF`
                : "";
    }

    if (productDesc) {
        productDesc.textContent =
            product.description ||
            "No description available.";
    }
}
window.renderProductInfo = renderProductInfo;
