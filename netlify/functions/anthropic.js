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

  // Image lookup: search sneakernews.com for product image
  if (body.action === "sneaker_image") {
    const query = body.query || "";
    if (!query) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: null }) };
    
    const cacheKey = query.toLowerCase().trim();
    if (imageCache[cacheKey]) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: imageCache[cacheKey] }) };
    }

    try {
      // Search sneakernews via Google for the shoe, grab og:image from article
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query + " site:sneakernews.com")}&num=1`;
      const searchRes = await fetch(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }
      });
      const searchHtml = await searchRes.text();
      
      // Extract sneakernews URL from Google results
      const snMatch = searchHtml.match(/https:\/\/sneakernews\.com\/[^\s"'&]+/);
      if (snMatch) {
        console.log("Found SN article:", snMatch[0].substring(0, 80));
        const artRes = await fetch(snMatch[0], {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }
        });
        if (artRes.ok) {
          const artHtml = await artRes.text();
          const ogMatch = artHtml.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
            || artHtml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
          if (ogMatch && ogMatch[1]) {
            console.log("Got image:", ogMatch[1].substring(0, 80));
            imageCache[cacheKey] = ogMatch[1];
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: ogMatch[1] }) };
          }
          // Fallback: find wp-content image in article
          const wpImg = artHtml.match(/https:\/\/sneakernews\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/[^\s"'<>]+\.(jpg|jpeg|png|webp)/i);
          if (wpImg) {
            console.log("Got WP image:", wpImg[0].substring(0, 80));
            imageCache[cacheKey] = wpImg[0];
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: wpImg[0] }) };
          }
        }
      }
      console.log("No image found for:", query);
    } catch(err) {
      console.error("Image search error:", err.message);
    }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: null }) };
  }

  // Anthropic API proxy
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
