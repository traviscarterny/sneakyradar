// Kicks Crew price proxy — bypasses Cloudflare + CORS issues
// Frontend calls this, it fetches from KC Shopify API

exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const items = body.items || []; // [{sku, title}, ...]
    if (!items.length) return { statusCode: 200, headers, body: JSON.stringify({ results: [] }) };

    const results = await Promise.all(items.slice(0, 12).map(async (item) => {
      try {
        // Search by title (Shopify suggest works with product names)
        var searchTitle = (item.title || "").replace(/\(.*?\)/g, "").replace(/['"]/g, "").trim();
        var words = searchTitle.split(/\s+/).slice(0, 6).join(" ");
        var q = words || item.sku || "";
        if (!q) return null;

        var url = "https://www.kickscrew.com/search/suggest.json?q=" + encodeURIComponent(q) + "&resources[type]=product&resources[limit]=5";
        var controller = new AbortController();
        var timeout = setTimeout(function() { controller.abort(); }, 5000);
        var res = await fetch(url, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!res.ok) {
          console.log("KC proxy status:", res.status, "for:", q);
          return null;
        }

        var d = await res.json();
        var products = d && d.resources && d.resources.results && d.resources.results.products ? d.resources.results.products : [];
        if (!products.length) return null;

        // Match by SKU in handle
        var normSku = (item.sku || "").toUpperCase().replace(/[-\s]/g, "");
        if (normSku) {
          for (var i = 0; i < products.length; i++) {
            var p = products[i];
            var h = (p.handle || "").toUpperCase().replace(/-/g, "");
            if (h.indexOf(normSku) >= 0) {
              var price = parseFloat(p.price);
              if (price > 30) {
                return { sku: item.sku, price: price, url: "https://www.kickscrew.com/products/" + p.handle };
              }
            }
          }
        }

        // Fallback: word match
        var first = products[0];
        var fp = parseFloat(first.price);
        if (fp > 50) {
          var titleWords = (item.title || "").toLowerCase().split(/\s+/);
          var matchTitle = (first.title || "").toLowerCase();
          var matchCount = 0;
          for (var j = 0; j < titleWords.length; j++) {
            if (titleWords[j].length > 2 && matchTitle.indexOf(titleWords[j]) >= 0) matchCount++;
          }
          if (matchCount >= 3) {
            return { sku: item.sku, price: fp, url: "https://www.kickscrew.com/products/" + first.handle };
          }
        }
        return null;
      } catch(e) {
        return null;
      }
    }));

    var matched = results.filter(Boolean);
    console.log("KC proxy:", matched.length, "matched out of", items.length);
    return { statusCode: 200, headers, body: JSON.stringify({ results: matched }) };
  } catch(e) {
    console.log("KC proxy error:", e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ results: [], error: e.message }) };
  }
};
