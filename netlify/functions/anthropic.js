// eBay OAuth token cache (in-memory, refreshes every 2 hours)
var ebayTokenCache = { token: null, expires: 0 };

async function getEbayToken() {
  var now = Date.now();
  if (ebayTokenCache.token && now < ebayTokenCache.expires) {
    return ebayTokenCache.token;
  }
  var clientId = process.env.EBAY_CLIENT_ID;
  var clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  var creds = Buffer.from(clientId + ":" + clientSecret).toString("base64");
  try {
    var res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + creds
      },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope"
    });
    var data = await res.json();
    if (data.access_token) {
      ebayTokenCache.token = data.access_token;
      ebayTokenCache.expires = now + ((data.expires_in || 7200) - 300) * 1000;
      return data.access_token;
    }
    console.log("eBay token error:", JSON.stringify(data));
    return null;
  } catch(err) {
    console.log("eBay token fetch error:", err.message);
    return null;
  }
}

async function searchEbay(query, limit) {
  var token = await getEbayToken();
  if (!token) return [];

  var campaignId = process.env.EBAY_CAMPAIGN_ID || "";
  var ebayHeaders = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json",
    "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
  };
  if (campaignId) {
    ebayHeaders["X-EBAY-C-ENDUSERCTX"] = "affiliateCampaignId=" + campaignId + ",contextualLocation=country=US,zip=10001";
  } else {
    ebayHeaders["X-EBAY-C-ENDUSERCTX"] = "contextualLocation=country=US,zip=10001";
  }

  var searchLimit = Math.min(limit || 10, 20);
  var url = "https://api.ebay.com/buy/browse/v1/item_summary/search"
    + "?q=" + encodeURIComponent(query + " sneaker")
    + "&limit=" + searchLimit
    + "&filter=conditionIds:{1000|1500},deliveryCountry:US,price:[50..],buyingOptions:{FIXED_PRICE}"
    + "&category_ids=93427"
    + "&sort=price";

  try {
    var res = await fetch(url, { headers: ebayHeaders });
    var data = await res.json();
    if (!data.itemSummaries) {
      if (data.errors) console.log("eBay search error:", JSON.stringify(data.errors[0]));
      return [];
    }
    return data.itemSummaries.map(function(item) {
      return {
        title: item.title || "",
        price: item.price ? parseFloat(item.price.value) : null,
        currency: item.price ? item.price.currency : "USD",
        url: item.itemAffiliateWebUrl || item.itemWebUrl || null,
        image: item.thumbnailImages && item.thumbnailImages[0] ? item.thumbnailImages[0].imageUrl : null,
        condition: item.condition || null,
        itemId: item.itemId || null,
        seller: item.seller ? item.seller.username : null,
        authenticity: item.qualifiedPrograms ? item.qualifiedPrograms.indexOf("AUTHENTICITY_GUARANTEE") >= 0 : false
      };
    });
  } catch(err) {
    console.log("eBay search error:", err.message);
    return [];
  }
}

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

  function buildEbayMap(ebayItems, stockxProducts) {
    var map = {};
    for (var i = 0; i < ebayItems.length; i++) {
      var item = ebayItems[i];
      var title = (item.title || "").toUpperCase();
      for (var j = 0; j < stockxProducts.length; j++) {
        var sx = stockxProducts[j];
        var sku = sx.sku || "";
        if (sku && title.indexOf(sku.replace(/-/g, "")) >= 0) {
          var skuKey = normSku(sku);
          if (skuKey && !map[skuKey]) map[skuKey] = item;
        }
      }
    }
    return map;
  }

  function mergeAll(stockxProducts, goatBySku, ebayBySku) {
    return stockxProducts.map(function(p) {
      var skuKey = normSku(p.sku);
      var gm = skuKey ? goatBySku[skuKey] : null;
      var em = skuKey ? ebayBySku[skuKey] : null;
      var result = {};
      for (var k in p) result[k] = p[k];
      result._goat = gm ? {
        slug: gm.slug || null,
        link: gm.link || null,
        image_url: gm.image_url || null,
        release_date: gm.release_date || null
      } : null;
      result._ebay = em ? {
        price: em.price || null,
        url: em.url || null,
        condition: em.condition || null,
        authenticity: em.authenticity || false
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
      var goatUrl = KICKSDB_BASE + "/goat/products?query=" + encodeURIComponent(query) + "&limit=100";

      // Fetch StockX + GOAT + eBay in parallel
      var results = await Promise.all([
        fetch(stockxUrl, {headers: authHeaders}).then(function(r) { return r.json(); }).catch(function() { return {data: []}; }),
        fetch(goatUrl, {headers: authHeaders}).then(function(r) { return r.json(); }).catch(function() { return {data: []}; }),
        searchEbay(query, 20)
      ]);

      var stockxProducts = (results[0] && results[0].data) ? results[0].data : [];
      var goatProducts = (results[1] && results[1].data) ? results[1].data : [];
      var ebayItems = results[2] || [];

      var goatBySku = buildGoatMap(goatProducts);
      var ebayBySku = buildEbayMap(ebayItems, stockxProducts);
      var merged = mergeAll(stockxProducts, goatBySku, ebayBySku);

      var duration = Date.now() - startTime;
      var goatMatches = merged.filter(function(p) { return p._goat; }).length;
      var ebayMatches = merged.filter(function(p) { return p._ebay; }).length;
      console.log("Search: " + query + " | StockX: " + stockxProducts.length + ", GOAT: " + goatProducts.length + ", eBay: " + ebayItems.length + ", goat-match: " + goatMatches + ", ebay-match: " + ebayMatches + " | " + duration + "ms");

      return {statusCode: 200, headers: corsHeaders, body: JSON.stringify({data: merged, _page: page, _limit: limit})};
    } catch(err) {
      console.error("Search error:", err.message);
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
      var goatQueries = ["Jordan 1", "Jordan 4", "Jordan 3", "Jordan 11", "Jordan 5"];

      var fetchPromises = [
        fetch(trendStockxUrl, {headers: trendHeaders}).then(function(r) { return r.json(); }).catch(function() { return {data: []}; })
      ];
      for (var qi = 0; qi < goatQueries.length; qi++) {
        var gUrl = KICKSDB_BASE + "/goat/products?query=" + encodeURIComponent(goatQueries[qi]) + "&limit=50";
        fetchPromises.push(
          fetch(gUrl, {headers: trendHeaders}).then(function(r) { return r.json(); }).catch(function() { return {data: []}; })
        );
      }
      // Also fetch eBay trending
      fetchPromises.push(searchEbay("Air Jordan Retro", 20));

      var trendResults = await Promise.all(fetchPromises);

      var trendStockx = (trendResults[0] && trendResults[0].data) ? trendResults[0].data : [];

      var allGoat = [];
      for (var gi = 1; gi < trendResults.length - 1; gi++) {
        var gData = (trendResults[gi] && trendResults[gi].data) ? trendResults[gi].data : [];
        allGoat = allGoat.concat(gData);
      }
      var trendGoatMap = buildGoatMap(allGoat);

      var trendEbayItems = trendResults[trendResults.length - 1] || [];
      var trendEbayMap = buildEbayMap(trendEbayItems, trendStockx);

      var products = trendStockx.filter(isSneaker);
      products = mergeAll(products, trendGoatMap, trendEbayMap);
      products.sort(function(a, b) { return (b.weekly_orders || 0) - (a.weekly_orders || 0); });
      products = products.slice(0, trendLimit);

      var trendGoatMatched = products.filter(function(p) { return p._goat; }).length;
      var trendEbayMatched = products.filter(function(p) { return p._ebay; }).length;
      var trendDuration = Date.now() - trendStart;
      console.log("Trending page " + trendPage + ": " + products.length + " products, GOAT pool: " + allGoat.length + ", goat-match: " + trendGoatMatched + ", ebay: " + trendEbayItems.length + ", ebay-match: " + trendEbayMatched + " | " + trendDuration + "ms");

      return {statusCode: 200, headers: corsHeaders, body: JSON.stringify({data: products, _page: trendPage})};
    } catch(err) {
      console.error("Trending error:", err.message);
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
