// SneakyRadar Backend — uses native fetch() (Node 18+)
var KICKS_KEY = process.env.KICKSDB_API_KEY || "KICKS-6062-7071-95FB-58E9612A472D";

// Release calendar cache (persists across warm function invocations)
var cachedReleases = null;
var cachedReleasesTime = null;

var RELEASES_PROMPT = 'Search the internet for upcoming confirmed sneaker release dates for the next 60 days. Find Jordan, Nike, Adidas, and New Balance releases with confirmed dates and prices. Return ONLY a JSON array. Each object: {"name":"full name","sku":"style code","date":"YYYY-MM-DD","price":200,"brand":"Jordan","color":"colorway","collab":false}. No explanation. Start with [ end with ].';

var FALLBACK_RELEASES = [
  {name:"Air Jordan 5 \"Wolf Grey\"",sku:"DD0587-002",date:"2026-02-28",price:220,brand:"Jordan",color:"Light Graphite/White-Wolf Grey",collab:false},
  {name:"Air Jordan 1 Low \"Lucky Cat\"",sku:"IQ3460-010",date:"2026-03-01",price:145,brand:"Jordan",color:"Black/Multi",collab:false},
  {name:"Teyana Taylor x AJ3 \"Concrete Rose\"",sku:"IF3097-300",date:"2026-03-07",price:280,brand:"Jordan",color:"Fir/Fire Red-Victory Green",collab:true},
  {name:"Air Jordan 4 OG \"Lakers\"",sku:"FV5029-500",date:"2026-03-07",price:220,brand:"Jordan",color:"Imperial Purple/Multi-Color",collab:false},
  {name:"Air Jordan 1 High OG \"Psychic Blue\" (W)",sku:"FD2596-102",date:"2026-03-07",price:185,brand:"Jordan",color:"Pale Ivory/Psychic Blue",collab:false},
  {name:"Air Jordan 13 \"Chicago\"",sku:"414571-102",date:"2026-03-13",price:215,brand:"Jordan",color:"White/Black-True Red",collab:false},
  {name:"Dashawn Jordan x Nike SB Dunk Low",sku:"IB6208-200",date:"2026-03-14",price:140,brand:"Nike",color:"String/Black-Bright Spruce",collab:true},
  {name:"Air Jordan 14 \"University Blue\"",sku:"487471-007",date:"2026-03-21",price:210,brand:"Jordan",color:"Black/University Blue-Silver",collab:false},
  {name:"Swarovski x Air Jordan 1 High OG",sku:"HF6248-002",date:"2026-03-21",price:1005,brand:"Jordan",color:"Vast Grey/Photon Dust",collab:true},
  {name:"Nike Kobe 5 Protro \"Lower Merion Away\"",sku:"IM0557-001",date:"2026-03-23",price:200,brand:"Nike",color:"Metallic Silver/Team Red",collab:false},
  {name:"Travis Scott x Jumpman Jack \"Green Spark\"",sku:"IM9113-300",date:"2026-03-27",price:205,brand:"Jordan",color:"Green Spark/Vapor Green-Black",collab:true},
  {name:"Virgil Abloh x Air Jordan 1 \"Alaska\"",sku:"AA3834-100",date:"2026-03-28",price:230,brand:"Jordan",color:"White/White",collab:true},
  {name:"Air Jordan 3 OG \"Spring is in the Air\"",sku:"IF4396-100",date:"2026-03-28",price:210,brand:"Jordan",color:"Sail/Jade Aura-Iced Carmine",collab:false},
  {name:"Air Jordan 3 \"Orange Citrus\" (W)",sku:"CK9246-101",date:"2026-04-04",price:205,brand:"Jordan",color:"White/Cement Grey-Fire Red",collab:false},
  {name:"Air Jordan 5 \"White Metallic\"",sku:"TBD-WM5",date:"2026-04-25",price:220,brand:"Jordan",color:"White/Metallic Silver",collab:false},
  {name:"Air Jordan 4 \"Toro Bravo\"",sku:"FQ8138-600",date:"2026-05-02",price:220,brand:"Jordan",color:"Fire Red/White-Black-Cement Grey",collab:false},
  {name:"Nigel Sylvester x Air Jordan 4",sku:"IQ8055-100",date:"2026-05-09",price:230,brand:"Jordan",color:"Sail/Cinnabar-Black",collab:true},
  {name:"Air Jordan 3 OG \"True Blue\"",sku:"IF4396-102",date:"2026-07-03",price:230,brand:"Jordan",color:"White/True Blue",collab:false},
  {name:"Air Jordan 4 OG \"Bred\"",sku:"TBD-BRED4",date:"2026-11-27",price:220,brand:"Jordan",color:"Black/Cement Grey-Fire Red",collab:false},
  {name:"Air Jordan 11 \"Space Jam\"",sku:"TBD-SJ11",date:"2026-12-20",price:235,brand:"Jordan",color:"Black/Concord-White",collab:true},
];

function cors(code, body) {
  return {
    statusCode: code,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
}

async function kicksSearch(query, limit, page) {
  var l = limit || 30;
  var skip = ((page || 1) - 1) * l;
  var url = "https://api.kicks.dev/v3/stockx/products?query=" + encodeURIComponent(query) + "&limit=" + l + "&skip=" + skip;
  try {
    var res = await fetch(url, { headers: { "Authorization": "Bearer " + KICKS_KEY } });
    var text = await res.text();
    console.log("kicksSearch raw status:", res.status, "body length:", text.length);
    return JSON.parse(text);
  } catch(e) {
    console.log("kicksSearch error:", e.message);
    return { data: [] };
  }
}

async function kicksSearchGoat(query, limit) {
  var url = "https://api.kicks.dev/v3/goat/products?query=" + encodeURIComponent(query) + "&limit=" + (limit || 100);
  try {
    var res = await fetch(url, { headers: { "Authorization": "Bearer " + KICKS_KEY } });
    return await res.json();
  } catch(e) {
    console.log("kicksSearchGoat error:", e.message);
    return { data: [] };
  }
}

function normSku(s) {
  return s ? s.replace(/[\s\-\/]/g, "").toUpperCase() : "";
}

// eBay OAuth
var ebayToken = null;
var ebayTokenExpiry = 0;

async function getEbayToken() {
  var cid = process.env.EBAY_CLIENT_ID;
  var cs = process.env.EBAY_CLIENT_SECRET;
  if (!cid || !cs) return null;
  if (ebayToken && Date.now() < ebayTokenExpiry) return ebayToken;
  try {
    var creds = Buffer.from(cid + ":" + cs).toString("base64");
    var res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": "Basic " + creds },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope"
    });
    var d = await res.json();
    if (d.access_token) {
      ebayToken = d.access_token;
      ebayTokenExpiry = Date.now() + ((d.expires_in || 7200) - 300) * 1000;
      return ebayToken;
    }
    console.log("eBay token error:", JSON.stringify(d).substring(0, 200));
    return null;
  } catch(e) {
    console.log("eBay token fetch error:", e.message);
    return null;
  }
}

var EBAY_JUNK_WORDS = ["box only","empty box","replacement box","shoe box only","no shoes","laces only","insole","keychain","charm","sticker","patch","pin","socks","poster","card","trading card","lot of","bulk","wholesale","display","stand","shoe tree","crep protect","sneaker shields","force field","sole protector","heel tap","custom","painted","air freshener","deodorizer","cleaning kit"];

function isEbayJunk(title) {
  var t = (title || "").toLowerCase();
  for (var i = 0; i < EBAY_JUNK_WORDS.length; i++) {
    if (t.indexOf(EBAY_JUNK_WORDS[i]) >= 0) return true;
  }
  // Flag listings that mention "box" without "with box" or "og box"
  if (t.indexOf("box") >= 0 && t.indexOf("with box") < 0 && t.indexOf("og box") < 0 && t.indexOf("new in box") < 0 && t.indexOf("deadstock") < 0 && t.indexOf("ds") < 0) {
    // If "box" appears but none of the legit phrases, check if it's "box only" style
    if (t.indexOf("box only") >= 0 || t.indexOf("empty") >= 0 || t.indexOf("no shoe") >= 0) return true;
  }
  return false;
}

async function searchEbay(query, limit) {
  var token = await getEbayToken();
  if (!token) return [];
  try {
    var camp = process.env.EBAY_CAMPAIGN_ID || "";
    var h = { "Authorization": "Bearer " + token, "Content-Type": "application/json", "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" };
    if (camp) h["X-EBAY-C-ENDUSERCTX"] = "affiliateCampaignId=" + camp;
    // Request more results so we still have enough after filtering junk
    var fetchLimit = Math.min((limit || 20) * 2, 50);
    var url = "https://api.ebay.com/buy/browse/v1/item_summary/search?q=" + encodeURIComponent(query + " sneaker shoe") +
      "&category_ids=93427&filter=conditionIds:{1000|1500|3000},price:[50..],deliveryCountry:US,buyingOptions:{FIXED_PRICE}&sort=price&limit=" + fetchLimit;
    var res = await fetch(url, { headers: h });
    var d = await res.json();
    if (!d.itemSummaries) return [];
    var filtered = [];
    var junkCount = 0;
    for (var i = 0; i < d.itemSummaries.length; i++) {
      var it = d.itemSummaries[i];
      if (isEbayJunk(it.title)) { junkCount++; continue; }
      if (filtered.length >= (limit || 20)) break;
      filtered.push({
        title: it.title,
        price: parseFloat(it.price ? it.price.value : "0"),
        url: camp ? (it.itemAffiliateWebUrl || it.itemWebUrl) : it.itemWebUrl,
        image: it.thumbnailImages ? it.thumbnailImages[0].imageUrl : null,
        authenticity: it.qualifiedPrograms ? it.qualifiedPrograms.indexOf("AUTHENTICITY_GUARANTEE") >= 0 : false
      });
    }
    console.log("eBay results: " + d.itemSummaries.length + " raw, " + junkCount + " junk filtered, " + filtered.length + " kept");
    return filtered;
  } catch(e) {
    console.log("eBay search error:", e.message);
    return [];
  }
}

function buildEbayMap(items) {
  var map = {};
  (items || []).forEach(function(it) {
    var t = (it.title || "").toUpperCase();
    // Try SKU-based matching first
    var m = t.match(/[A-Z]{1,3}\d{4,}[\s\-]?\d{2,3}/);
    if (m) { var k = normSku(m[0]); if (!map[k]) map[k] = it; }
  });
  return map;
}

function normTitle(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function titleWords(s) {
  return normTitle(s).split(" ").filter(function(w) {
    return w.length > 1 && ["the","and","for","new","men","mens","women","womens","size","with","box","ds","og","ship","free","shipping","authentic","brand","pair"].indexOf(w) < 0;
  });
}

function titleMatchScore(stockxTitle, ebayTitle) {
  var sWords = titleWords(stockxTitle);
  var eWords = titleWords(ebayTitle);
  if (sWords.length === 0) return 0;
  var eStr = " " + eWords.join(" ") + " ";
  var matches = 0;
  var keyMatches = 0;
  // Key words are model identifiers like "jordan", "dunk", "yeezy", numbers like "1", "4", "350"
  var keyPatterns = ["jordan","dunk","yeezy","force","max","kobe","samba","550","990","1130","kayano"];
  for (var i = 0; i < sWords.length; i++) {
    for (var j = 0; j < eWords.length; j++) {
      if (sWords[i] === eWords[j]) {
        matches++;
        if (keyPatterns.indexOf(sWords[i]) >= 0 || sWords[i].match(/^\d+$/)) keyMatches++;
        break;
      }
    }
  }
  // Must match at least one key identifier word (model name or number)
  if (keyMatches === 0) return 0;
  return matches / sWords.length;
}

function matchEbayToProducts(products, ebayItems) {
  if (!ebayItems || ebayItems.length === 0) return;
  
  // First pass: SKU matching (most accurate)
  var skuMap = buildEbayMap(ebayItems);
  var usedEbay = {};
  
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    if (p._ebay) continue;
    var sku = normSku(p.sku);
    if (sku && skuMap[sku]) {
      p._ebay = { price: skuMap[sku].price, url: skuMap[sku].url, authenticity: skuMap[sku].authenticity };
      usedEbay[skuMap[sku].url] = true;
    }
  }
  
  // Second pass: fuzzy title matching for unmatched products
  var remaining = ebayItems.filter(function(e) { return !usedEbay[e.url]; });
  if (remaining.length === 0) return;
  
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    if (p._ebay) continue;
    var bestScore = 0;
    var bestItem = null;
    for (var j = 0; j < remaining.length; j++) {
      if (usedEbay[remaining[j].url]) continue;
      var score = titleMatchScore(p.title || p.name || "", remaining[j].title);
      if (score > bestScore) { bestScore = score; bestItem = remaining[j]; }
    }
    // Require at least 70% word match to avoid bad pairings
    if (bestItem && bestScore >= 0.7) {
      p._ebay = { price: bestItem.price, url: bestItem.url, authenticity: bestItem.authenticity };
      usedEbay[bestItem.url] = true;
    }
  }
}

function mergeAll(sx, goat, ebay) {
  var goatMap = {};
  (goat || []).forEach(function(g) { var k = normSku(g.sku); if (k) goatMap[k] = g; });
  var gm = 0, em = 0;

  var products = (sx || []).map(function(p) {
    var cat = ((p.category || "") + "").toLowerCase();
    var pt = ((p.product_type || "") + "").toLowerCase();
    var combined = cat + " " + pt;
    var isShoe = combined.indexOf("sneaker") >= 0 || combined.indexOf("shoe") >= 0 || combined.indexOf("footwear") >= 0 || pt === "sneakers" || (cat === "" && pt === "");
    var isApparel = pt === "apparel" || pt === "clothing" || pt === "accessories";
    if (isApparel) return null;

    var sku = normSku(p.sku);
    var g = sku ? goatMap[sku] : null;
    if (g) gm++;

    var r = {
      id: p.id, title: p.title || p.name, brand: p.brand, sku: p.sku, slug: p.slug,
      image: p.image, url: p.url, min_price: p.min_price, max_price: p.max_price,
      avg_price: p.avg_price, weekly_orders: p.weekly_orders || 0, rank: p.rank
    };
    if (g) r._goat = { link: g.link || null, release_date: g.release_date || null, sku: g.sku };
    return r;
  }).filter(Boolean);

  // Match eBay using SKU + fuzzy title matching
  matchEbayToProducts(products, ebay);
  products.forEach(function(p) { if (p._ebay) em++; });

  console.log("eBay matching: " + em + "/" + products.length + " products matched from " + (ebay || []).length + " eBay results");
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
      var results = await Promise.all([
        kicksSearch(q, limit, page),
        kicksSearchGoat(q, 100),
        searchEbay(q, 20)
      ]);
      var sxP = (results[0] && results[0].data) ? results[0].data : [];
      var gP = (results[1] && results[1].data) ? results[1].data : [];
      var eP = results[2] || [];
      var m = mergeAll(sxP, gP, eP);
      console.log("Search: " + q + " | SX:" + sxP.length + " GOAT:" + gP.length + " eBay:" + eP.length + " gm:" + m.goatMatched + " em:" + m.ebayMatched + " merged:" + m.products.length + " | " + (Date.now() - t0) + "ms");
      return cors(200, { data: m.products, total: results[0].total || m.products.length, page: page });
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
      console.log("Trending: SX:" + sxD.length + " GOAT:" + allG.length + " eBay:" + eT.length + " gm:" + m2.goatMatched + " em:" + m2.ebayMatched + " merged:" + m2.products.length + " | " + (Date.now() - t1) + "ms");
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
      var ir = await fetch("https://www.googleapis.com/customsearch/v1?key=" + gk + "&cx=" + gc + "&q=" + encodeURIComponent(body.query) + "&searchType=image&num=1");
      var id = await ir.json();
      return cors(200, { thumbnail: (id.items && id.items[0]) ? id.items[0].link : null });
    } catch(e) {
      return cors(200, { thumbnail: null });
    }
  }

  // ── Release Calendar: Get releases ──
  if (body.action === "get_releases") {
    return cors(200, {
      releases: cachedReleases || FALLBACK_RELEASES,
      updated: cachedReleasesTime || "hardcoded",
      source: cachedReleases ? "live" : "fallback"
    });
  }

  // ── Release Calendar: Trigger update via Anthropic web search ──
  if (body.action === "update_releases") {
    var relKey = process.env.ANTHROPIC_API_KEY;
    if (!relKey) return cors(500, { error: "No API key" });
    console.log("Fetching release calendar via Anthropic...");
    try {
      // Step 1: Try multiple release sites (some use server-side rendering)
      var sources = [
        "https://justfreshkicks.com/air-jordan-sneaker-releases-2026/",
        "https://www.kickscrew.com/blogs/sneakernews/air-jordan-release-dates"
      ];
      var trimmed = "";
      for (var si = 0; si < sources.length; si++) {
        try {
          var pageRes = await fetch(sources[si], { headers: { "User-Agent": "Mozilla/5.0 (compatible; SneakyRadar/1.0)" } });
          var pageText = await pageRes.text();
          console.log("Fetched source " + si + ": " + sources[si].substring(0, 50) + " length:" + pageText.length);
          
          // Find content with release dates - look for date patterns
          var dateIdx = pageText.indexOf("Release Date:");
          if (dateIdx === -1) dateIdx = pageText.indexOf("Release Date");
          if (dateIdx === -1) dateIdx = pageText.indexOf("release-date");
          if (dateIdx === -1) dateIdx = pageText.indexOf("2026");
          
          if (dateIdx > 0) {
            // Grab content starting 500 chars before first date reference
            var start = Math.max(0, dateIdx - 500);
            var chunk = pageText.substring(start, start + 40000);
            chunk = chunk.replace(/<script[\s\S]*?<\/script>/gi, '');
            chunk = chunk.replace(/<style[\s\S]*?<\/style>/gi, '');
            chunk = chunk.replace(/<!\-\-[\s\S]*?\-\->/g, '');
            if (chunk.length > trimmed.length) trimmed = chunk;
            console.log("Found release content at idx:", dateIdx, "extracted:", chunk.length, "chars");
            console.log("Content preview:", chunk.substring(0, 300));
            break; // use first successful source
          }
        } catch(e) {
          console.log("Source " + si + " error:", e.message);
        }
      }
      
      if (trimmed.length < 500) {
        console.log("No release content found from any source");
        return cors(500, { error: "Could not fetch release data from sources" });
      }

      // Step 2: Have Claude parse the HTML into structured JSON (no web search needed = fast)
      var relRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": relKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: "You are a JSON API. Extract sneaker release data from the provided HTML. Output ONLY a valid JSON array. No other text.",
          messages: [{ role: "user", content: "Extract all sneaker releases from this HTML page. For each release return: {\"name\":\"full name with colorway\",\"sku\":\"style code\",\"date\":\"YYYY-MM-DD\",\"price\":200,\"brand\":\"Jordan or Nike or Adidas or New Balance or Other\",\"color\":\"colorway\",\"collab\":false}. Only include releases with confirmed dates in YYYY-MM-DD format. Return ONLY a JSON array starting with [ and ending with ].\n\nHTML:\n" + trimmed }]
        })
      });

      var relData = await relRes.json();
      if (!relRes.ok) {
        console.log("Anthropic parse error:", JSON.stringify(relData).substring(0, 500));
        return cors(relRes.status, { error: "Anthropic API error" });
      }
      var relText = "";
      if (relData.content) {
        for (var ri = 0; ri < relData.content.length; ri++) {
          if (relData.content[ri].type === "text") relText += relData.content[ri].text;
        }
      }
      console.log("Parse response length:", relText.length);

      var parsed = null;
      try { parsed = JSON.parse(relText.trim()); } catch(e) {}
      if (!parsed) { var rm = relText.match(/\[[\s\S]*\]/); if (rm) try { parsed = JSON.parse(rm[0]); } catch(e) {} }
      if (!parsed) { var fm = relText.match(/```(?:json)?\s*([\s\S]*?)```/); if (fm) try { parsed = JSON.parse(fm[1].trim()); } catch(e) {} }
      if (!parsed || !Array.isArray(parsed)) {
        console.log("Failed to parse releases:", relText.substring(0, 500));
        return cors(500, { error: "Failed to parse releases" });
      }
      var cleaned = parsed.filter(function(r) {
        return r.name && r.date && r.date.match(/^\d{4}-\d{2}-\d{2}$/);
      }).map(function(r) {
        return {
          name: String(r.name || "").substring(0, 200),
          sku: String(r.sku || "TBD").substring(0, 30),
          date: r.date,
          price: Number(r.price) || 0,
          brand: String(r.brand || "Other").substring(0, 20),
          color: String(r.color || "").substring(0, 100),
          collab: Boolean(r.collab)
        };
      });
      cachedReleases = cleaned;
      cachedReleasesTime = new Date().toISOString();
      console.log("Updated releases: " + cleaned.length + " entries");
      return cors(200, { success: true, count: cleaned.length, updated: cachedReleasesTime, releases: cleaned });
    } catch(err) {
      console.error("Update releases error:", err.message);
      return cors(500, { error: err.message });
    }
  }

  // ── Anthropic API Proxy (chat widget) ──
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
    var aR = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: aH,
      body: JSON.stringify(body)
    });
    var aBody = await aR.text();
    return { statusCode: aR.status, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: aBody };
  } catch(err) {
    return cors(500, { error: err.message });
  }
};
