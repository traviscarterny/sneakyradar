// Dynamic Sitemap Generator — queries KicksDB for popular sneakers
var KICKS_KEY = process.env.KICKSDB_API_KEY;

// Cache sitemap for 6 hours to avoid hammering the API
var cachedSitemap = null;
var cachedSitemapTime = null;
var CACHE_TTL = 6 * 60 * 60 * 1000;

function nameToSlug(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/['']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function kicksSearch(query, limit) {
  var url = "https://api.kicks.dev/v3/stockx/products?query=" + encodeURIComponent(query) + "&limit=" + (limit || 100) + "&skip=0";
  try {
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 10000);
    var res = await fetch(url, { headers: { "Authorization": "Bearer " + KICKS_KEY }, signal: controller.signal });
    clearTimeout(timeout);
    var parsed = JSON.parse(await res.text());
    return parsed.data || [];
  } catch(e) {
    console.log("sitemap kicksSearch error:", e.message);
    return [];
  }
}

exports.handler = async function(event) {
  // Return cached version if fresh
  if (cachedSitemap && cachedSitemapTime && (Date.now() - cachedSitemapTime) < CACHE_TTL) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=21600" },
      body: cachedSitemap,
    };
  }

  var today = new Date().toISOString().split("T")[0];

  // Static pages
  var staticPages = [
    { loc: "https://www.sneakyradar.com/", priority: "1.0", freq: "daily" },
    { loc: "https://www.sneakyradar.com/resell", priority: "0.9", freq: "weekly" },
    { loc: "https://www.sneakyradar.com/releases", priority: "0.9", freq: "weekly" },
    { loc: "https://www.sneakyradar.com/auth", priority: "0.9", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/collection", priority: "0.8", freq: "weekly" },
    { loc: "https://www.sneakyradar.com/blog", priority: "0.8", freq: "weekly" },
    { loc: "https://www.sneakyradar.com/blog/best-jordan-releases-2026", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/sneaker-price-comparison-guide", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/best-sneakers-under-150", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/best-sneakers-resale-2026", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/how-to-authenticate-sneakers", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/how-stockx-works", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/yeezy-price-guide-2026", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/nike-dunk-release-calendar-2026", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/new-balance-buying-guide", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/asics-kayano-14-vs-gel-1130", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/best-sneakers-under-100", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/sneaker-release-dates-2026", priority: "0.8", freq: "weekly" },
    { loc: "https://www.sneakyradar.com/blog/how-to-buy-sneakers-retail", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/goat-vs-stockx-fees", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/are-yeezy-slides-worth-it", priority: "0.7", freq: "monthly" },
    { loc: "https://www.sneakyradar.com/blog/jordan-4-price-history", priority: "0.7", freq: "monthly" },
  ];

  // Sneaker queries to cover popular categories
  var queries = [
    "Jordan 1 Retro",
    "Jordan 3 Retro",
    "Jordan 4 Retro",
    "Jordan 5 Retro",
    "Jordan 6 Retro",
    "Jordan 11 Retro",
    "Jordan 12 Retro",
    "Jordan 13 Retro",
    "Nike Dunk Low",
    "Nike Dunk High",
    "Nike Air Max 1",
    "Nike Air Max 90",
    "Nike Air Max 95",
    "Nike Air Max 97",
    "Nike Air Force 1",
    "Nike SB Dunk",
    "Yeezy Boost 350",
    "Yeezy Boost 700",
    "Yeezy Slide",
    "Yeezy Foam Runner",
    "New Balance 550",
    "New Balance 2002R",
    "New Balance 990",
    "New Balance 993",
    "Adidas Samba",
    "Adidas Gazelle",
    "Adidas Campus",
    "ASICS Gel-Kayano 14",
    "ASICS Gel-1130",
    "Puma Suede",
    "Nike Blazer Mid",
    "Nike Vomero 5",
  ];

  // Fetch all in parallel (batched to avoid rate limits)
  var allProducts = [];
  var BATCH_SIZE = 8;

  try {
    for (var i = 0; i < queries.length; i += BATCH_SIZE) {
      var batch = queries.slice(i, i + BATCH_SIZE);
      var results = await Promise.all(batch.map(function(q) { return kicksSearch(q, 100); }));
      results.forEach(function(products) {
        allProducts = allProducts.concat(products);
      });
    }
  } catch(e) {
    console.log("sitemap fetch error:", e.message);
  }

  // Dedupe by title
  var seen = new Map();
  allProducts.forEach(function(p) {
    var name = p.title || p.name || "";
    var slug = nameToSlug(name);
    if (slug && !seen.has(slug)) {
      seen.set(slug, { name: name, slug: slug });
    }
  });

  console.log("Sitemap: " + queries.length + " queries, " + allProducts.length + " raw products, " + seen.size + " unique sneakers");

  // Build sneaker URLs
  var sneakerUrls = [];
  seen.forEach(function(val) {
    sneakerUrls.push({
      loc: "https://www.sneakyradar.com/sneaker/" + encodeURIComponent(val.slug),
      priority: "0.7",
      freq: "daily",
    });
  });

  // Build XML
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  staticPages.forEach(function(p) {
    xml += '  <url>\n';
    xml += '    <loc>' + p.loc + '</loc>\n';
    xml += '    <lastmod>' + today + '</lastmod>\n';
    xml += '    <changefreq>' + p.freq + '</changefreq>\n';
    xml += '    <priority>' + p.priority + '</priority>\n';
    xml += '  </url>\n';
  });

  sneakerUrls.forEach(function(p) {
    xml += '  <url>\n';
    xml += '    <loc>' + p.loc + '</loc>\n';
    xml += '    <lastmod>' + today + '</lastmod>\n';
    xml += '    <changefreq>' + p.freq + '</changefreq>\n';
    xml += '    <priority>' + p.priority + '</priority>\n';
    xml += '  </url>\n';
  });

  xml += '</urlset>\n';

  // Cache it
  cachedSitemap = xml;
  cachedSitemapTime = Date.now();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=21600" },
    body: xml,
  };
};
