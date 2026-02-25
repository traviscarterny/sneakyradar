// KicksDB + Anthropic proxy
// Uses Standard API for StockX + GOAT, Unified API for cross-platform matching (incl. Flight Club)

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

  // === KicksDB Product Search (StockX + GOAT + Unified for FC) ===
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

      // 3-way parallel fetch: StockX + GOAT + Unified (for FC cross-match)
      const [stockxRes, goatRes, unifiedRes] = await Promise.all([
        fetch(`${KICKSDB_BASE}/stockx/products?query=${encodeURIComponent(query)}&limit=${limit}&page=${page}&offset=${offset}`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`${KICKSDB_BASE}/goat/products?query=${encodeURIComponent(query)}&limit=${limit}`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`${KICKSDB_BASE}/unified/products?query=${encodeURIComponent(query)}&limit=${limit}`, { headers }).then(r => r.json()).catch(e => { console.log("Unified fetch error:", e.message); return { data: [] }; }),
      ]);

      const stockxProducts = stockxRes?.data || [];
      const goatProducts = goatRes?.data || [];
      const unifiedProducts = unifiedRes?.data || [];

      // Log first GOAT product to debug price fields
      if (goatProducts.length > 0) {
        const g = goatProducts[0];
        console.log("GOAT sample fields:", JSON.stringify({
          title: g.title || g.name,
          sku: g.sku,
          min_price: g.min_price,
          max_price: g.max_price,
          avg_price: g.avg_price,
          retail_prices: g.retail_prices,
          has_variants: !!(g.variants && g.variants.length),
          variant_count: g.variants ? g.variants.length : 0,
          has_sizes: !!(g.sizes && g.sizes.length),
          link: g.link ? g.link.substring(0, 60) : null,
        }));
      }

      // Log first unified product to see FC data structure
      if (unifiedProducts.length > 0) {
        const u = unifiedProducts[0];
        console.log("Unified sample:", JSON.stringify({
          title: u.title || u.name,
          sku: u.sku,
          sources: u.sources ? Object.keys(u.sources) : null,
          platforms: u.platforms,
          keys: Object.keys(u).slice(0, 20),
        }));
      }

      // Build GOAT lookup by SKU
      const goatBySku = {};
      for (const g of goatProducts) {
        const key = normSku(g.sku);
        if (key) goatBySku[key] = g;
      }

      // Build Unified/FC lookup by SKU
      const unifiedBySku = {};
      for (const u of unifiedProducts) {
        const key = normSku(u.sku);
        if (key) unifiedBySku[key] = u;
      }

      const merged = stockxProducts.map(p => {
        const skuKey = normSku(p.sku);
        const gm = skuKey ? goatBySku[skuKey] : null;
        const um = skuKey ? unifiedBySku[skuKey] : null;

        // Extract FC data from unified response if available
        let fcData = null;
        if (um) {
          // Unified API may have sources like { stockx: {...}, goat: {...}, flightclub: {...} }
          const fcSource = um.sources?.flightclub || um.sources?.fc || um.sources?.flight_club || null;
          if (fcSource) {
            fcData = {
              slug: fcSource.slug || null,
              link: fcSource.link || fcSource.url || null,
              min_price: fcSource.min_price || fcSource.lowest_price || null,
              max_price: fcSource.max_price || null,
              avg_price: fcSource.avg_price || null,
            };
          }
          // Also check if unified itself has FC pricing in a different format
          if (!fcData && um.prices) {
            const fcPrice = um.prices.flightclub || um.prices.fc || um.prices.flight_club;
            if (fcPrice) {
              fcData = {
                link: `https://www.flightclub.com/search?query=${encodeURIComponent(p.sku || p.title || "")}`,
                min_price: typeof fcPrice === "number" ? fcPrice : fcPrice.min || fcPrice.lowest || null,
              };
            }
          }
        }

        return {
          ...p,
          _goat: gm ? {
            slug: gm.slug || null,
            link: gm.link || null,
            image_url: gm.image_url || null,
            release_date: gm.release_date || null,
            min_price: gm.min_price || null,
            max_price: gm.max_price || null,
            avg_price: gm.avg_price || null,
          } : null,
          _fc: fcData,
          _unified: um ? {
            sources: um.sources ? Object.keys(um.sources) : [],
          } : null,
        };
      });

      const duration = Date.now() - startTime;
      const goatMatches = merged.filter(p => p._goat).length;
      const fcMatches = merged.filter(p => p._fc).length;
      const unifiedMatches = merged.filter(p => p._unified).length;
      console.log(`KicksDB search: ${query} | StockX: ${stockxProducts.length}, GOAT: ${goatProducts.length}, Unified: ${unifiedProducts.length}, goat-match: ${goatMatches}, fc-match: ${fcMatches}, unified-match: ${unifiedMatches} | ${duration}ms`);

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
