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

      // GOAT free tier: no prices, but has affiliate links + release dates
      const goatBySku = {};
      for (const g of goatProducts) {
        const key = normSku(g.sku);
        if (key) goatBySku[key] = g;
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

  // === KicksDB Trending/Popular (StockX only — GOAT adds too much latency for 4x queries) ===
  if (body.action === "trending") {
    const limit = body.limit || 21;
    const page = body.page || 1;
    const perQuery = 8;
    const offset = (page - 1) * perQuery;
    if (!KICKSDB_KEY) return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "KICKSDB_API_KEY not configured" }) };

    try {
      const queries = ["Jordan 2026", "Nike Dunk 2026", "New Balance 2025", "Yeezy 2025"];
      const headers = { "Authorization": `Bearer ${KICKSDB_KEY}` };
      const allProducts = [];
      
      await Promise.all(queries.map(q =>
        fetch(`${KICKSDB_BASE}/stockx/products?query=${encodeURIComponent(q)}&limit=${perQuery}&offset=${offset}&page=${page}`, { headers })
          .then(r => r.json())
          .then(d => { if (d?.data) allProducts.push(...d.data); })
          .catch(() => {})
      ));

      const seen = new Set();
      const unique = [];
      for (const p of allProducts) {
        if (p.slug && !seen.has(p.slug)) {
          seen.add(p.slug);
          unique.push(p);
        }
      }
      unique.sort((a, b) => (b.weekly_orders || 0) - (a.weekly_orders || 0));

      console.log("KicksDB trending page", page, ":", unique.length, "products");
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
