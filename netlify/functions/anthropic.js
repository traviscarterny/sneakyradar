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

      // Fetch StockX and GOAT in parallel
      const [stockxRes, goatRes] = await Promise.all([
        fetch(`${KICKSDB_BASE}/stockx/products?query=${encodeURIComponent(query)}&limit=${limit}&page=${page}&offset=${offset}`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`${KICKSDB_BASE}/goat/products?query=${encodeURIComponent(query)}&limit=${limit}`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
      ]);

      const stockxProducts = stockxRes?.data || [];
      const goatProducts = goatRes?.data || [];

      // Build GOAT lookup by SKU (normalize: remove spaces, dashes, slashes, uppercase)
      const normSku = s => s ? s.replace(/[\s\-\/]/g, "").toUpperCase() : null;
      const goatBySku = {};
      for (const g of goatProducts) {
        const key = normSku(g.sku);
        if (key) goatBySku[key] = g;
      }

      // Merge GOAT data into StockX products
      const merged = stockxProducts.map(p => {
        const skuKey = normSku(p.sku);
        const goatMatch = skuKey ? goatBySku[skuKey] : null;
        return {
          ...p,
          _goat: goatMatch ? {
            slug: goatMatch.slug || null,
            min_price: goatMatch.min_price || null,
            max_price: goatMatch.max_price || null,
            avg_price: goatMatch.avg_price || null,
            image: goatMatch.image || goatMatch.images?.[0] || null,
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

  // === KicksDB Trending/Popular (StockX + GOAT) ===
  if (body.action === "trending") {
    const limit = body.limit || 21;
    const page = body.page || 1;
    const perQuery = 8;
    const offset = (page - 1) * perQuery;
    if (!KICKSDB_KEY) return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "KICKSDB_API_KEY not configured" }) };

    try {
      const queries = ["Jordan 2026", "Nike Dunk 2026", "New Balance 2025", "Yeezy 2025"];
      const headers = { "Authorization": `Bearer ${KICKSDB_KEY}` };
      const allStockx = [];
      const allGoat = [];
      
      const fetches = queries.flatMap(q => [
        fetch(`${KICKSDB_BASE}/stockx/products?query=${encodeURIComponent(q)}&limit=${perQuery}&offset=${offset}&page=${page}`, { headers }).then(r => r.json()).then(d => { if (d?.data) allStockx.push(...d.data); }).catch(() => {}),
        fetch(`${KICKSDB_BASE}/goat/products?query=${encodeURIComponent(q)}&limit=${perQuery}`, { headers }).then(r => r.json()).then(d => { if (d?.data) allGoat.push(...d.data); }).catch(() => {}),
      ]);
      await Promise.all(fetches);

      const normSku = s => s ? s.replace(/[\s\-\/]/g, "").toUpperCase() : null;
      const goatBySku = {};
      for (const g of allGoat) {
        const key = normSku(g.sku);
        if (key) goatBySku[key] = g;
      }

      const seen = new Set();
      const unique = [];
      for (const p of allStockx) {
        if (p.slug && !seen.has(p.slug)) {
          seen.add(p.slug);
          const skuKey = normSku(p.sku);
          const goatMatch = skuKey ? goatBySku[skuKey] : null;
          unique.push({
            ...p,
            _goat: goatMatch ? {
              slug: goatMatch.slug || null,
              min_price: goatMatch.min_price || null,
              max_price: goatMatch.max_price || null,
              avg_price: goatMatch.avg_price || null,
              image: goatMatch.image || (goatMatch.images && goatMatch.images[0]) || null,
            } : null,
          });
        }
      }
      unique.sort((a, b) => (b.weekly_orders || 0) - (a.weekly_orders || 0));

      const goatMatches = unique.filter(p => p._goat).length;
      console.log("KicksDB trending page", page, ":", unique.length, "products,", goatMatches, "GOAT matches");
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ data: unique.slice(0, limit), _page: page }) };
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
