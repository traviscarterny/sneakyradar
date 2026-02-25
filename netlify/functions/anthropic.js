var https = require("https");

function httpReq(url, opts, postData) {
  return new Promise(function(resolve, reject) {
    var req = https.request(url, opts, function(res) {
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
      });
    });
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function cors(code, body) {
  return {
    statusCode: code,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
}

var KICKS_KEY = process.env.KICKSDB_API_KEY || "KICKS-6062-7071-95FB-58E9612A472D";

function kicksSearch(query, limit, page) {
  var l = limit || 30;
  var skip = ((page || 1) - 1) * l;
  var url = "https://api.kicks.dev/v3/stockx/products?query=" + encodeURIComponent(query) + "&limit=" + l + "&skip=" + skip;
  return httpReq(url, { method: "GET", headers: { "Authorization": "Bearer " + KICKS_KEY } }).then(function(r) {
    try { return JSON.parse(r.body); } catch(e) { return { error: r.body }; }
  });
}

function kicksSearchGoat(query, limit) {
  var url = "https://api.kicks.dev/v3/goat/products?query=" + encodeURIComponent(query) + "&limit=" + (limit || 100);
  return httpReq(url, { method: "GET", headers: { "Authorization": "Bearer " + KICKS_KEY } }).then(function(r) {
    try { return JSON.parse(r.body); } catch(e) { return { error: "GOAT parse error" }; }
  });
}

function normSku(s) {
  return s ? s.replace(/[\s\-\/]/g, "").toUpperCase() : "";
}

// eBay OAuth
var ebayToken = null;
var ebayTokenExpiry = 0;

function getEbayToken() {
  var cid = process.env.EBAY_CLIENT_ID;
  var cs = process.env.EBAY_CLIENT_SECRET;
  if (!cid || !cs) return Promise.resolve(null);
  if (ebayToken && Date.now() < ebayTokenExpiry) return Promise.resolve(ebayToken);

  var creds = Buffer.from(cid + ":" + cs).toString("base64");
  var pd = "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope";
  return httpReq("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": "Basic " + creds }
  }, pd).then(function(r) {
    try {
      var d = JSON.parse(r.body);
      if (d.access_token) {
        ebayToken = d.access_token;
        ebayTokenExpiry = Date.now() + ((d.expires_in || 7200) - 300) * 1000;
        return ebayToken;
      }
    } catch(e) {}
    console.log("eBay token error:", r.body.substring(0, 200));
    return null;
  }).catch(function() { return null; });
}

function searchEbay(query, limit) {
  return getEbayToken().then(function(token) {
    if (!token) return [];
    var camp = process.env.EBAY_CAMPAIGN_ID || "";
    var h = { "Authorization": "Bearer " + token, "Content-Type": "application/json", "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" };
    if (camp) h["X-EBAY-C-ENDUSERCTX"] = "affiliateCampaignId=" + camp;
    var url = "https://api.ebay.com/buy/browse/v1/item_summary/search?q=" + encodeURIComponent(query) + "&category_ids=93427&filter=conditionIds:{1000|1500|3000},price:[50..],deliveryCountry:US,buyingOptions:{FIXED_PRICE}&sort=price&limit=" + (limit || 20);
    return httpReq(url, { method: "GET", headers: h }).then(function(r) {
      try {
        var d = JSON.parse(r.body);
        if (!d.itemSummaries) return [];
        return d.itemSummaries.map(function(it) {
          return {
            title: it.title,
            price: parseFloat(it.price ? it.price.value : "0"),
            url: camp ? (it.itemAffiliateWebUrl || it.itemWebUrl) : it.itemWebUrl,
            image: it.thumbnailImages ? it.thumbnailImages[0].imageUrl : null,
            authenticity: it.qualifiedPrograms ? it.qualifiedPrograms.indexOf("AUTHENTICITY_GUARANTEE") >= 0 : false
          };
        });
      } catch(e) { return []; }
    }).catch(function() { return []; });
  });
}

function buildEbayMap(items) {
  var map = {};
  (items || []).forEach(function(it) {
    var t = (it.title || "").toUpperCase();
    var m = t.match(/[A-Z]{1,3}\d{4,}[\s\-]?\d{2,3}/);
    if (m) { var k = normSku(m[0]); if (!map[k]) map[k] = it; }
  });
  return map;
}

function mergeAll(sx, goat, ebay) {
  var goatMap = {};
  (goat || []).forEach(function(g) { var k = normSku(g.sku); if (k) goatMap[k] = g; });
  var ebayMap = buildEbayMap(ebay);
  var gm = 0, em = 0;

  var products = (sx || []).map(function(p) {
    var cat = ((p.category || p.product_type || "") + "").toLowerCase();
    var ok = cat.indexOf("sneaker") >= 0 || cat.indexOf("shoe") >= 0 || cat.indexOf("footwear") >= 0 || cat === "sneakers" || cat === "";
    if (!ok) return null;

    var sku = normSku(p.sku);
    var g = sku ? goatMap[sku] : null;
    var e = sku ? ebayMap[sku] : null;
    if (g) gm++;
    if (e) em++;

    var r = {
      id: p.id, title: p.title || p.name, brand: p.brand, sku: p.sku, slug: p.slug,
      image: p.image, url: p.url, min_price: p.min_price, max_price: p.max_price,
      avg_price: p.avg_price, weekly_orders: p.weekly_orders || 0, rank: p.rank
    };
    if (g) r._goat = { link: g.link || null, release_date: g.release_date || null, sku: g.sku };
    if (e) r._ebay = { price: e.price, url: e.url, authenticity: e.authenticity };
    return r;
  }).filter(Boolean);

  return { products: products, goatMatched: gm, ebayMatched: em };
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") return cors(200, "");
  if (event.httpMethod !== "POST") return cors(405, { error: "Method not allowed" });

  var body;
  try { body = JSON.parse(event.body); }
  catch(e) { return cors(400, { error: "Invalid JSON" }); }

  // ── KicksDB Search ──
  if (body.action === "search") {
    var q = body.query || "Jordan";
    var limit = body.limit || 30;
    var page = body.page || 1;
    var t0 = Date.now();
    try {
      var all = await Promise.all([
        kicksSearch(q, limit, page),
        kicksSearchGoat(q, 100),
        searchEbay(q, 20)
      ]);
      var sxP = (all[0] && all[0].data) ? all[0].data : [];
      var gP = (all[1] && all[1].data) ? all[1].data : [];
      var eP = all[2] || [];
      var m = mergeAll(sxP, gP, eP);
      console.log("Search: " + q + " | SX:" + sxP.length + " GOAT:" + gP.length + " eBay:" + eP.length + " gm:" + m.goatMatched + " em:" + m.ebayMatched + " | " + (Date.now() - t0) + "ms");
      return cors(200, { data: m.products, total: all[0].total || m.products.length, page: page });
    } catch(err) {
      console.error("Search error:", err.message);
      return cors(500, { error: err.message });
    }
  }

  // ── KicksDB Trending ──
  if (body.action === "trending") {
    var lim = body.limit || 30;
    var t1 = Date.now();
    try {
      var tr = await Promise.all([
        kicksSearch("Jordan", 50, 1),
        kicksSearchGoat("Jordan 1", 50),
        kicksSearchGoat("Jordan 4", 50),
        kicksSearchGoat("Jordan 3", 50),
        kicksSearchGoat("Jordan 11", 50),
        kicksSearchGoat("Jordan 5", 50),
        searchEbay("Air Jordan Retro", 20)
      ]);
      var sxD = (tr[0] && tr[0].data) ? tr[0].data : [];
      var allG = [];
      for (var i = 1; i <= 5; i++) { if (tr[i] && tr[i].data) allG = allG.concat(tr[i].data); }
      var eT = tr[6] || [];
      var m2 = mergeAll(sxD, allG, eT);
      m2.products.sort(function(a, b) { return (b.weekly_orders || 0) - (a.weekly_orders || 0); });
      m2.products = m2.products.slice(0, lim);
      console.log("Trending: SX:" + sxD.length + " GOAT:" + allG.length + " eBay:" + eT.length + " gm:" + m2.goatMatched + " em:" + m2.ebayMatched + " | " + (Date.now() - t1) + "ms");
      return cors(200, { data: m2.products, total: m2.products.length, page: 1 });
    } catch(err) {
      console.error("Trending error:", err.message);
      return cors(500, { error: err.message });
    }
  }

  // ── Legacy image search ──
  if (body.action === "sneaker_image") {
    var gk = process.env.GOOGLE_API_KEY;
    var gc = process.env.GOOGLE_CSE_ID;
    if (!gk || !gc) return cors(200, { thumbnail: null });
    try {
      var iu = "https://www.googleapis.com/customsearch/v1?key=" + gk + "&cx=" + gc + "&q=" + encodeURIComponent(body.query) + "&searchType=image&num=1";
      var ir = await httpReq(iu, { method: "GET" });
      var id = JSON.parse(ir.body);
      return cors(200, { thumbnail: (id.items && id.items[0]) ? id.items[0].link : null });
    } catch(e) {
      return cors(200, { thumbnail: null });
    }
  }

  // ── Anthropic API Proxy (chat widget + any direct API calls) ──
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return cors(500, { error: "ANTHROPIC_API_KEY not configured" });

  var usesWS = Array.isArray(body.tools) && body.tools.some(function(t) {
    return t.type && t.type.indexOf("web_search") >= 0;
  });
  var aH = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  };
  if (usesWS) aH["anthropic-beta"] = "web-search-2025-03-05";

  try {
    var aR = await httpReq("https://api.anthropic.com/v1/messages", { method: "POST", headers: aH }, JSON.stringify(body));
    return { statusCode: aR.status, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: aR.body };
  } catch(err) {
    return cors(500, { error: err.message });
  }
};
