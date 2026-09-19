 function renderRelatedProducts(products) {
              // RELATED PRODUCTS
         const container = document.getElementById("relatedProducts");

          if (!container) return;

         container.innerHTML = "";
         // RESTORED FALLBACK LOGIC
         if (!products.length) {

         container.innerHTML =
            "<p>No related products found</p>";

         return;
        }
        // if (!products.length) {
        //    fetch(window.UniMartConfig.getEndpoint('products'))
        //      .then(res => {

        //        if (!res.ok) {
        //          throw new Error(`HTTP error! Status: ${res.status}`);
        //        }

        //        return res.json();

        //      })


        //      .then(allEnvelope => {
        //        const all = allEnvelope.data ? allEnvelope.data : allEnvelope;
        //        const featured = all.filter(p => p.isFeatured).slice(0, 4);
        //        const title = document.querySelector(".related-section h2");
        //        // if (title) title.textContent = "Featured for You";
        //        if (title) {
        //          title.textContent = "Related Products";
        //        }
        //        if(featured.length > 0) renderRelatedProducts(featured);
        //      });


        //    return;
        //  }

         products.forEach(product => {

           if (product.status === 'inactive') return;
           const card = document.createElement("article");
           card.className = "product-card";

           // 2. Safe image selection: Check if images array exists and has length

         //  const productImage = (product.images && product.images.length > 0) ? product.images[0] : "../assets/images/no-image.png";
         const productImage = product.images?.[0]
         || '../assets/images/no-image.png';

           let ribbon = "";
           if (product.isNew) ribbon += `<span class="ribbon new">NEW</span>`;
           if (product.isFeatured) ribbon += `<span class="ribbon featured">FEATURED</span>`;
           if (product.isBestSeller) ribbon += `<span class="ribbon best-seller">BESTSELLER</span>`;

           let stars = "";
           if (product.ratings) {
             const fullStars = Math.floor(product.ratings);
             const halfStar = product.ratings % 1 >= 0.5 ? 1 : 0;
             const emptyStars = 5 - fullStars - halfStar;
             stars = `<div class="rating">${'★'.repeat(fullStars)}${halfStar ? "½" : ""}${'☆'.repeat(emptyStars)}</div>`;

           }

           card.innerHTML = `
             <div class="product-img">
               ${ribbon}
              <img src="${productImage}" alt="${product.name}">
             </div>

             <div class="product-info">
               <h3 class="product-title">${product.name}</h3>
               <p class="short-desc">${product.description || ''}</p>
               <div class="price-row">
                 <span class="price">${UniMartConfig.formatPrice(product.price || 0)}</span>
                 ${product.oldPrice ? `<span class="old-price">${UniMartConfig.formatPrice(product.oldPrice)}</span>` : ''}
                 ${product.discount ? `<span class="discount">${product.discount}% OFF</span>` : ''}
               </div>
               ${stars}
             </div>
           `;

           card.onclick = () => {
             window.location.href = `product.html?id=${product._id}`;
           };

           container.appendChild(card);
         });


      }
    window.renderRelatedProducts = renderRelatedProducts;
