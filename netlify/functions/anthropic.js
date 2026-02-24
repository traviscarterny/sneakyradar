// KicksDB + Anthropic proxy
// KicksDB for product search (images, links, prices)
// Anthropic for trending/editorial drops on landing page

const KICKSDB_KEY = process.env.KICKSDB_API_KEY;
const KICKSDB_BASE = "https://api.kicks.dev/v3";

exports.handler = async function(event) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  // === KicksDB Product Search (StockX + GOAT) ===
  if (body.action === "search") {
    const query = body.query || "";
    const limit = body.limit || 21;
    const page = body.page || 1;
    if (!query) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ data: [] }) };
    if (!KICKSDB_KEY) return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "KICKSDB_API_KEY not configured" }) };

    try {
      const offset = (page - 1) * limit;
      const headers = { "Authorization": `Bearer ${KICKSDB_KEY}` };
      const startTime = Date.now();
      const normSku = s => s ? s.replace(/[\s\-\/]/g, "").toUpperCase() : null;

      const [stockxRes, goatRes] = await Promise.all([
        fetch(`${KICKSDB_BASE}/stockx/products?query=${encodeURIComponent(query)}&limit=${limit}&page=${page}&offset=${offset}`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`${KICKSDB_BASE}/goat/products?query=${encodeURIComponent(query)}&limit=${limit}`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
      ]);

      const stockxProducts = stockxRes?.data || [];
      const goatProducts = goatRes?.data || [];

      // Build GOAT lookup by SKU — paid tier has prices in variants
      const goatBySku = {};
      for (const g of goatProducts) {
        const key = normSku(g.sku);
        if (!key) continue;
        // Extract prices from variants array
        let minPrice = null;
        let maxPrice = null;
        if (g.variants && g.variants.length > 0) {
          const vp = g.variants.map(v => v.price || v.lowest_price || v.min_price).filter(p => p && p > 0);
          if (vp.length) { minPrice = Math.min(...vp); maxPrice = Math.max(...vp); }
        }
        // Fallback to sizes array
        if (!minPrice && g.sizes && g.sizes.length > 0) {
          const sp = g.sizes.map(s => s.price || s.lowest_price).filter(p => p && p > 0);
          if (sp.length) { minPrice = Math.min(...sp); maxPrice = Math.max(...sp); }
        }
        goatBySku[key] = { ...g, _minPrice: minPrice, _maxPrice: maxPrice };
      }

      // Log first GOAT match — dump first size object to find field names
      const firstGoatKey = Object.keys(goatBySku)[0];
      if (firstGoatKey) {
        const fg = goatBySku[firstGoatKey];
        const firstSize = fg.sizes?.[0] || null;
        console.log(`GOAT price check: ${fg.name || fg.slug} | min: ${fg._minPrice} | max: ${fg._maxPrice} | variants: ${fg.variants?.length || 0} | sizes: ${fg.sizes?.length || 0}`);
        console.log(`GOAT first size keys: ${firstSize ? JSON.stringify(firstSize) : 'none'}`);
      }

      const merged = stockxProducts.map(p => {
        const skuKey = normSku(p.sku);
        const gm = skuKey ? goatBySku[skuKey] : null;
        return {
          ...p,
          _goat: gm ? {
            slug: gm.slug || null,
            link: gm.link || null,
            image_url: gm.image_url || null,
            release_date: gm.release_date || null,
            min_price: gm._minPrice,
            max_price: gm._maxPrice,
          } : null,
        };
      });

      const duration = Date.now() - startTime;
      const goatMatches = merged.filter(p => p._goat).length;
      console.log(`KicksDB search: ${query} | StockX: ${stockxProducts.length}, GOAT: ${goatProducts.length}, matched: ${goatMatches} | ${duration}ms`);

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ data: merged, _page: page, _limit: limit }) };
    } catch(err) {
      console.error("KicksDB error:", err.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
  }

  // === KicksDB Product Detail ===
  if (body.action === "product") {
    const slug = body.slug || "";
    if (!slug) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "slug required" }) };
    if (!KICKSDB_KEY) return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "KICKSDB_API_KEY not configured" }) };

    try {
      const url = `${KICKSDB_BASE}/stockx/products/${encodeURIComponent(slug)}`;
      const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${KICKSDB_KEY}` }
      });
      const data = await res.json();
      return { statusCode: res.status, headers: corsHeaders, body: JSON.stringify(data) };
    } catch(err) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
  }

  // === KicksDB Trending ===
  if (body.action === "trending") {
    const limit = body.limit || 21;
    const page = body.page || 1;
    if (!KICKSDB_KEY) return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "KICKSDB_API_KEY not configured" }) };

    try {
      const headers = { "Authorization": `Bearer ${KICKSDB_KEY}` };
      const startTime = Date.now();
      const offset = (page - 1) * limit;
      
      const q = "Jordan";
      
      const res = await fetch(`${KICKSDB_BASE}/stockx/products?query=${encodeURIComponent(q)}&limit=50&offset=${offset}&page=${page}`, { headers });
      const data = await res.json();
      let products = data?.data || [];
      
      // Filter to sneakers only (exclude apparel, accessories, etc)
      products = products.filter(p => {
        const cat = (p.category || p.product_type || "").toLowerCase();
        return cat.includes("sneaker") || cat.includes("shoe") || cat.includes("footwear") || cat === "sneakers" || cat === "";
      });
      
      products.sort((a, b) => (b.weekly_orders || 0) - (a.weekly_orders || 0));
      products = products.slice(0, limit);

      const duration = Date.now() - startTime;
      console.log("KicksDB trending page", page, ":", products.length, "products for", q, "in", duration, "ms");
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ data: products, _page: page }) };
    } catch(err) {
      console.error("KicksDB trending error:", err.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
  }

  // === Anthropic API proxy (for editorial content if needed) ===
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) };

  const usesWebSearch = Array.isArray(body.tools) &&
    body.tools.some(t => t.type?.includes("web_search"));

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
  if (usesWebSearch) headers["anthropic-beta"] = "web-search-2025-03-05";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return {
      statusCode: response.status,
      headers: corsHeaders,
      body: JSON.stringify(data),
    };
  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
