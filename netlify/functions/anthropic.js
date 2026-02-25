exports.handler = async function(event) {
  var KICKSDB_KEY = process.env.KICKSDB_API_KEY;
  var KICKSDB_BASE = "https://api.kicks.dev/v3";
  var corsHeaders = {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"};

  if (event.httpMethod === "OPTIONS") {
    return {statusCode: 200, headers: corsHeaders, body: ""};
  }
  if (event.httpMethod !== "POST") {
    return {statusCode: 405, body: JSON.stringify({error: "Method not allowed"})};
  }

  var body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return {statusCode: 400, body: JSON.stringify({error: "Invalid JSON"})};
  }

  function normSku(s) {
    if (!s) return null;
    return s.replace(/[\s\-\/\.]/g, "").toUpperCase();
  }

  function buildGoatMap(goatProducts) {
    var map = {};
    for (var i = 0; i < goatProducts.length; i++) {
      var g = goatProducts[i];
      var key = normSku(g.sku);
      if (key) map[key] = g;
    }
    return map;
  }

  function mergeGoat(stockxProducts, goatBySku) {
    return stockxProducts.map(function(p) {
      var skuKey = normSku(p.sku);
      var gm = skuKey ? goatBySku[skuKey] : null;
      var result = {};
      for (var k in p) result[k] = p[k];
      result._goat = gm ? {
        slug: gm.slug || null,
        link: gm.link || null,
        image_url: gm.image_url || null,
        release_date: gm.release_date || null
      } : null;
      return result;
    });
  }

  function isSneaker(p) {
    var cat = (p.category || p.product_type || "").toLowerCase();
    return cat.indexOf("sneaker") >= 0 || cat.indexOf("shoe") >= 0 || cat.indexOf("footwear") >= 0 || cat === "sneakers" || cat === "";
  }

  // === SEARCH ===
  if (body.action === "search") {
    var query = body.query || "";
    var limit = body.limit || 21;
    var page = body.page || 1;
    if (!query) return {statusCode: 200, headers: corsHeaders, body: JSON.stringify({data: []})};
    if (!KICKSDB_KEY) return {statusCode: 500, headers: corsHeaders, body: JSON.stringify({error: "KICKSDB_API_KEY not configured"})};

    try {
      var offset = (page - 1) * limit;
      var authHeaders = {"Authorization": "Bearer " + KICKSDB_KEY};
      var startTime = Date.now();

      var stockxUrl = KICKSDB_BASE + "/stockx/products?query=" + encodeURIComponent(query) + "&limit=" + limit + "&page=" + page + "&offset=" + offset;
      var goatUrl = KICKSDB_BASE + "/goat/products?query=" + encodeURIComponent(query) + "&limit=" + limit;

      var results = await Promise.all([
        fetch(stockxUrl, {headers: authHeaders}).then(function(r) { return r.json(); }).catch(function() { return {data: []}; }),
        fetch(goatUrl, {headers: authHeaders}).then(function(r) { return r.json(); }).catch(function() { return {data: []}; })
      ]);

      var stockxProducts = (results[0] && results[0].data) ? results[0].data : [];
      var goatProducts = (results[1] && results[1].data) ? results[1].data : [];
      var goatBySku = buildGoatMap(goatProducts);
      var merged = mergeGoat(stockxProducts, goatBySku);

      var duration = Date.now() - startTime;
      var goatMatches = merged.filter(function(p) { return p._goat; }).length;
      console.log("KicksDB search: " + query + " | StockX: " + stockxProducts.length + ", GOAT: " + goatProducts.length + ", matched: " + goatMatches + " | " + duration + "ms");

      // Debug: log first 5 SKUs from each source to diagnose matching
      if (goatMatches < 3) {
        var sxSkus = stockxProducts.slice(0, 5).map(function(p) { return p.sku + " -> " + normSku(p.sku); });
        var gtSkus = goatProducts.slice(0, 5).map(function(p) { return p.sku + " -> " + normSku(p.sku); });
        console.log("SKU debug StockX: " + JSON.stringify(sxSkus));
        console.log("SKU debug GOAT:   " + JSON.stringify(gtSkus));
      }

      return {statusCode: 200, headers: corsHeaders, body: JSON.stringify({data: merged, _page: page, _limit: limit})};
    } catch(err) {
      console.error("KicksDB error:", err.message);
      return {statusCode: 500, headers: corsHeaders, body: JSON.stringify({error: err.message})};
    }
  }

  // === PRODUCT DETAIL ===
  if (body.action === "product") {
    var slug = body.slug || "";
    if (!slug) return {statusCode: 400, headers: corsHeaders, body: JSON.stringify({error: "slug required"})};
    if (!KICKSDB_KEY) return {statusCode: 500, headers: corsHeaders, body: JSON.stringify({error: "KICKSDB_API_KEY not configured"})};

    try {
      var detailUrl = KICKSDB_BASE + "/stockx/products/" + encodeURIComponent(slug);
      var res = await fetch(detailUrl, {headers: {"Authorization": "Bearer " + KICKSDB_KEY}});
      var data = await res.json();
      return {statusCode: res.status, headers: corsHeaders, body: JSON.stringify(data)};
    } catch(err) {
      return {statusCode: 500, headers: corsHeaders, body: JSON.stringify({error: err.message})};
    }
  }

  // === TRENDING ===
  if (body.action === "trending") {
    var trendLimit = body.limit || 21;
    var trendPage = body.page || 1;
    if (!KICKSDB_KEY) return {statusCode: 500, headers: corsHeaders, body: JSON.stringify({error: "KICKSDB_API_KEY not configured"})};

    try {
      var trendHeaders = {"Authorization": "Bearer " + KICKSDB_KEY};
      var trendStart = Date.now();
      var trendOffset = (trendPage - 1) * trendLimit;
      var trendQuery = "Jordan";

      var trendStockxUrl = KICKSDB_BASE + "/stockx/products?query=" + encodeURIComponent(trendQuery) + "&limit=50&offset=" + trendOffset + "&page=" + trendPage;
      var trendGoatUrl = KICKSDB_BASE + "/goat/products?query=" + encodeURIComponent(trendQuery) + "&limit=50";

      var trendResults = await Promise.all([
        fetch(trendStockxUrl, {headers: trendHeaders}).then(function(r) { return r.json(); }).catch(function() { return {data: []}; }),
        fetch(trendGoatUrl, {headers: trendHeaders}).then(function(r) { return r.json(); }).catch(function() { return {data: []}; })
      ]);

      var trendStockx = (trendResults[0] && trendResults[0].data) ? trendResults[0].data : [];
      var trendGoat = (trendResults[1] && trendResults[1].data) ? trendResults[1].data : [];
      var trendGoatMap = buildGoatMap(trendGoat);

      var products = trendStockx.filter(isSneaker);
      products = mergeGoat(products, trendGoatMap);
      products.sort(function(a, b) { return (b.weekly_orders || 0) - (a.weekly_orders || 0); });
      products = products.slice(0, trendLimit);

      var trendMatched = products.filter(function(p) { return p._goat; }).length;
      var trendDuration = Date.now() - trendStart;
      console.log("KicksDB trending page " + trendPage + ": " + products.length + " products, GOAT matched: " + trendMatched + " in " + trendDuration + "ms");

      return {statusCode: 200, headers: corsHeaders, body: JSON.stringify({data: products, _page: trendPage})};
    } catch(err) {
      console.error("KicksDB trending error:", err.message);
      return {statusCode: 500, headers: corsHeaders, body: JSON.stringify({error: err.message})};
    }
  }

  // === ANTHROPIC API PROXY ===
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return {statusCode: 500, body: JSON.stringify({error: "ANTHROPIC_API_KEY not configured"})};

  var usesWebSearch = Array.isArray(body.tools) && body.tools.some(function(t) { return t.type && t.type.indexOf("web_search") >= 0; });

  var anthropicHeaders = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  };
  if (usesWebSearch) anthropicHeaders["anthropic-beta"] = "web-search-2025-03-05";

  try {
    var response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders,
      body: JSON.stringify(body)
    });
    var responseData = await response.json();
    return {statusCode: response.status, headers: corsHeaders, body: JSON.stringify(responseData)};
  } catch(err) {
    return {statusCode: 500, body: JSON.stringify({error: err.message})};
  }
};
