Syntax error on line 73 — the `\n` in the XML string got written literally instead of as an escape. The script I generated via Python mangled the newlines. Let me give you a fixed version.

Go to `scripts/generate-sitemap.js` on GitHub, click the pencil icon to edit, and replace the entire contents with this: 

That's the same error from before — you need to update the file first. Go to your repo on GitHub, navigate to `scripts/generate-sitemap.js`, click the pencil icon to edit, **delete everything**, and paste this exact code:

```javascript
const KICKS_KEY = process.env.KICKSDB_API_KEY;
const fs = require('fs');
const path = require('path');

function nameToSlug(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function kicksSearch(query, limit) {
  var url = 'https://api.kicks.dev/v3/stockx/products?query=' + encodeURIComponent(query) + '&limit=' + (limit || 100) + '&skip=0';
  try {
    var res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + KICKS_KEY }, signal: AbortSignal.timeout(15000) });
    var parsed = JSON.parse(await res.text());
    return parsed.data || [];
  } catch(e) { console.log('Error: ' + query + ': ' + e.message); return []; }
}

async function main() {
  if (!KICKS_KEY) { console.error('KICKSDB_API_KEY not set!'); process.exit(1); }
  var today = new Date().toISOString().split('T')[0];
  var staticPages = [
    { loc: 'https://www.sneakyradar.com/', priority: '1.0', freq: 'daily' },
    { loc: 'https://www.sneakyradar.com/resell', priority: '0.9', freq: 'weekly' },
    { loc: 'https://www.sneakyradar.com/releases', priority: '0.9', freq: 'weekly' },
    { loc: 'https://www.sneakyradar.com/auth', priority: '0.9', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/collection', priority: '0.8', freq: 'weekly' },
    { loc: 'https://www.sneakyradar.com/blog', priority: '0.8', freq: 'weekly' },
    { loc: 'https://www.sneakyradar.com/blog/best-jordan-releases-2026', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/sneaker-price-comparison-guide', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/best-sneakers-under-150', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/best-sneakers-resale-2026', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/how-to-authenticate-sneakers', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/how-stockx-works', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/yeezy-price-guide-2026', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/nike-dunk-release-calendar-2026', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/new-balance-buying-guide', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/asics-kayano-14-vs-gel-1130', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/best-sneakers-under-100', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/sneaker-release-dates-2026', priority: '0.8', freq: 'weekly' },
    { loc: 'https://www.sneakyradar.com/blog/how-to-buy-sneakers-retail', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/goat-vs-stockx-fees', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/are-yeezy-slides-worth-it', priority: '0.7', freq: 'monthly' },
    { loc: 'https://www.sneakyradar.com/blog/jordan-4-price-history', priority: '0.7', freq: 'monthly' },
  ];
  var queries = [
    'Jordan 1 Retro','Jordan 3 Retro','Jordan 4 Retro','Jordan 5 Retro',
    'Jordan 6 Retro','Jordan 11 Retro','Jordan 12 Retro','Jordan 13 Retro',
    'Nike Dunk Low','Nike Dunk High','Nike Air Max 1','Nike Air Max 90',
    'Nike Air Max 95','Nike Air Max 97','Nike Air Force 1','Nike SB Dunk',
    'Yeezy Boost 350','Yeezy Boost 700','Yeezy Slide','Yeezy Foam Runner',
    'New Balance 550','New Balance 2002R','New Balance 990','New Balance 993',
    'Adidas Samba','Adidas Gazelle','Adidas Campus',
    'ASICS Gel-Kayano 14','ASICS Gel-1130',
    'Puma Suede','Nike Blazer Mid','Nike Vomero 5',
  ];
  console.log('Fetching ' + queries.length + ' queries...');
  var allProducts = [];
  var BATCH = 8;
  for (var i = 0; i < queries.length; i += BATCH) {
    var batch = queries.slice(i, i + BATCH);
    console.log('  Batch ' + (Math.floor(i/BATCH)+1) + '/' + Math.ceil(queries.length/BATCH));
    var results = await Promise.all(batch.map(function(q) { return kicksSearch(q, 100); }));
    results.forEach(function(p) { allProducts = allProducts.concat(p); });
  }
  var seen = new Map();
  allProducts.forEach(function(p) {
    var name = p.title || p.name || '';
    var slug = nameToSlug(name);
    if (slug && !seen.has(slug)) seen.set(slug, slug);
  });
  console.log('Products: ' + allProducts.length + ', unique: ' + seen.size);
  var lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  staticPages.forEach(function(p) {
    lines.push('  <url><loc>' + p.loc + '</loc><lastmod>' + today + '</lastmod><changefreq>' + p.freq + '</changefreq><priority>' + p.priority + '</priority></url>');
  });
  seen.forEach(function(slug) {
    lines.push('  <url><loc>https://www.sneakyradar.com/sneaker/' + encodeURIComponent(slug) + '</loc><lastmod>' + today + '</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>');
  });
  lines.push('</urlset>');
  var xml = lines.join('\n') + '\n';
  var outPath = path.join(__dirname, '..', 'sitemap.xml');
  fs.writeFileSync(outPath, xml);
  console.log('Wrote sitemap.xml: ' + (staticPages.length + seen.size) + ' URLs');
}
main().catch(function(e) { console.error(e); process.exit(1); });
```

Commit it, then re-run the workflow.
