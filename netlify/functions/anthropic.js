// In-memory image cache
let imageCache = {};

exports.handler = async function(event) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  // Scrape og:image from a product URL (StockX, GOAT, Nike, etc.)
  if (body.action === "sneaker_image") {
    const url = body.url;
    const name = body.name || "";
    
    if (!url) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: null }) };
    }

    // Check cache
    if (imageCache[url]) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: imageCache[url] }) };
    }

    try {
      console.log("Fetching og:image from:", url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timeout);
      
      if (!res.ok) {
        console.log("Fetch failed:", res.status, "for", url);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: null }) };
      }

      const html = await res.text();
      
      // Extract og:image
      const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
      
      if (ogMatch && ogMatch[1]) {
        const img = ogMatch[1];
        console.log("Found og:image:", img.substring(0, 80));
        imageCache[url] = img;
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: img }) };
      }

      // Fallback: look for stockx image pattern in HTML
      const stockxImg = html.match(/https:\/\/images\.stockx\.com\/[^\s"'<>]+\.(jpg|png|webp)/i);
      if (stockxImg) {
        console.log("Found StockX image:", stockxImg[0].substring(0, 80));
        imageCache[url] = stockxImg[0];
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: stockxImg[0] }) };
      }

      // Fallback: any product image
      const anyImg = html.match(/https:\/\/[^\s"'<>]+(?:product|sneaker|shoe)[^\s"'<>]*\.(jpg|png|webp)/i);
      if (anyImg) {
        imageCache[url] = anyImg[0];
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: anyImg[0] }) };
      }

      console.log("No image found in page for:", url);
    } catch(err) {
      console.error("Image scrape error:", err.message, "for:", url);
    }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: null }) };
  }

  // Anthropic API proxy (for drop fetching)
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
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
