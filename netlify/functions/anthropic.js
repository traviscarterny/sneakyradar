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

  // === KicksDB Product Search ===
  if (body.action === "search") {
    const query = body.query || "";
    const limit = body.limit || 21;
    const page = body.page || 1;
    if (!query) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ data: [] }) };
    if (!KICKSDB_KEY) return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "KICKSDB_API_KEY not configured" }) };

    try {
      // Try both page and offset params — KicksDB docs unclear on which is supported
      const offset = (page - 1) * limit;
      const url = `${KICKSDB_BASE}/stockx/products?query=${encodeURIComponent(query)}&limit=${limit}&page=${page}&offset=${offset}`;
      console.log("KicksDB search:", query, "page:", page, "offset:", offset, "limit:", limit);
      const startTime = Date.now();
      const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${KICKSDB_KEY}` }
      });
      const data = await res.json();
      const duration = Date.now() - startTime;
      const count = data?.data?.length || 0;
      console.log(`KicksDB results: ${count} products in ${duration}ms (page ${page})`);
      // Pass back page info so frontend knows if there are more
      return { statusCode: res.status, headers: corsHeaders, body: JSON.stringify({ ...data, _page: page, _limit: limit }) };
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

  // === KicksDB Trending/Popular ===
  if (body.action === "trending") {
    const limit = body.limit || 21;
    const page = body.page || 1;
    const perQuery = 8;
    const offset = (page - 1) * perQuery;
    if (!KICKSDB_KEY) return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "KICKSDB_API_KEY not configured" }) };

    try {
      // Fetch from multiple popular categories to build a diverse landing page
      const queries = ["Jordan 2026", "Nike Dunk 2026", "New Balance 2025", "Yeezy 2025"];
      const allProducts = [];
      
      for (const q of queries) {
        try {
          const url = `${KICKSDB_BASE}/stockx/products?query=${encodeURIComponent(q)}&limit=${perQuery}&offset=${offset}&page=${page}`;
          const res = await fetch(url, {
            headers: { "Authorization": `Bearer ${KICKSDB_KEY}` }
          });
          const data = await res.json();
          if (data?.data) allProducts.push(...data.data);
        } catch(e) {
          console.error("Trending query failed:", q, e.message);
        }
      }

      // Dedupe by slug and take top results
      const seen = new Set();
      const unique = [];
      for (const p of allProducts) {
        if (p.slug && !seen.has(p.slug)) {
          seen.add(p.slug);
          unique.push(p);
        }
      }
      // Sort by weekly_orders descending if available
      unique.sort((a, b) => (b.weekly_orders || 0) - (a.weekly_orders || 0));

      console.log("KicksDB trending page", page, ":", unique.length, "unique products from", queries.length, "queries");
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
