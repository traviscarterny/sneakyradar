// scripts/generate-sneaker-pages.js
// Generates static /sneaker/{slug}/index.html files with unique meta tags
// Each file is a copy of sneaker.html with the <head> meta tags replaced
// Runs as part of the GitHub Action alongside sitemap generation

const fs = require('fs');
const path = require('path');

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function main() {
  const metaPath = path.join(__dirname, '..', 'sneaker-meta.json');
  const templatePath = path.join(__dirname, '..', 'sneaker.html');
  const outDir = path.join(__dirname, '..', 'sneaker');

  if (!fs.existsSync(metaPath)) {
    console.error('sneaker-meta.json not found — run generate-sitemap.js first');
    process.exit(1);
  }
  if (!fs.existsSync(templatePath)) {
    console.error('sneaker.html not found');
    process.exit(1);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const template = fs.readFileSync(templatePath, 'utf8');
  const slugs = Object.keys(meta);

  console.log('Generating ' + slugs.length + ' sneaker pages...');

  // Clean old generated pages (but not other files)
  if (fs.existsSync(outDir)) {
    const existing = fs.readdirSync(outDir);
    existing.forEach(function(dir) {
      const dirPath = path.join(outDir, dir);
      const indexPath = path.join(dirPath, 'index.html');
      if (fs.statSync(dirPath).isDirectory() && fs.existsSync(indexPath)) {
        fs.unlinkSync(indexPath);
        try { fs.rmdirSync(dirPath); } catch(e) {}
      }
    });
  }

  let count = 0;
  slugs.forEach(function(slug) {
    const s = meta[slug];
    const name = s.n || '';
    const brand = s.b || '';
    const colorway = s.c || '';
    const sku = s.s || '';
    const retail = s.r || 0;
    const image = s.i || '';
    const pageUrl = 'https://www.sneakyradar.com/sneaker/' + slug;

    const title = escHtml(name) + ' &mdash; Price Comparison | SneakyRadar';
    const titlePlain = name + ' — Price Comparison | SneakyRadar';
    const desc = escHtml(
      'Compare ' + name + ' prices across StockX, GOAT, eBay, Amazon and more.' +
      (colorway ? ' Colorway: ' + colorway + '.' : '') +
      (retail ? ' Retail: $' + retail + '.' : '') +
      (sku ? ' Style: ' + sku + '.' : '')
    );

    const ldJson = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      "name": name,
      "description": 'Compare ' + name + ' prices across StockX, GOAT, eBay, Amazon and more.',
      "url": pageUrl,
      "brand": {"@type": "Brand", "name": brand},
      "sku": sku || "",
      "image": image || "https://www.sneakyradar.com/og-image.png",
      "offers": retail > 0 ? {
        "@type": "Offer",
        "priceCurrency": "USD",
        "price": retail,
        "availability": "https://schema.org/InStock"
      } : {
        "@type": "AggregateOffer",
        "priceCurrency": "USD",
        "offerCount": 5
      }
    });

    let html = template;

    // Replace title
    html = html.replace(
      '<title>Sneaker Price Comparison | SneakyRadar</title>',
      '<title>' + titlePlain + '</title>'
    );

    // Replace meta description
    html = html.replace(
      'content="Compare prices across StockX, eBay, Nike, Amazon and more. Find the best deal on this sneaker."',
      'content="' + desc + '"'
    );

    // Replace canonical
    html = html.replace(
      'id="canonical-link" href="https://www.sneakyradar.com"',
      'id="canonical-link" href="' + pageUrl + '"'
    );

    // Replace OG title (multiple instances)
    html = html.replace(
      /content="Sneaker Price Comparison \| SneakyRadar"/g,
      'content="' + titlePlain + '"'
    );

    // Replace OG description
    html = html.replace(
      'content="Compare prices across StockX, eBay, Nike, Amazon and more."',
      'content="' + desc + '"'
    );

    // Replace OG url
    html = html.replace(
      'id="og-url" content="https://www.sneakyradar.com"',
      'id="og-url" content="' + pageUrl + '"'
    );

    // Replace structured data
    html = html.replace(
      /<script type="application\/ld\+json" id="ld-json">[\s\S]*?<\/script>/,
      '<script type="application/ld+json" id="ld-json">' + ldJson + '</script>'
    );

    // Write to /sneaker/{slug}/index.html
    const slugDir = path.join(outDir, slug);
    if (!fs.existsSync(slugDir)) {
      fs.mkdirSync(slugDir, { recursive: true });
    }
    fs.writeFileSync(path.join(slugDir, 'index.html'), html);
    count++;

    if (count % 500 === 0) {
      console.log('  Generated ' + count + '/' + slugs.length + '...');
    }
  });

  console.log('Done! Generated ' + count + ' sneaker pages in /sneaker/');
  
  // Report size
  let totalSize = 0;
  slugs.forEach(function(slug) {
    const fp = path.join(outDir, slug, 'index.html');
    if (fs.existsSync(fp)) totalSize += fs.statSync(fp).size;
  });
  console.log('Total size: ' + Math.round(totalSize / 1024 / 1024) + 'MB');
}

main();
