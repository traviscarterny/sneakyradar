exports.handler = async function(event) {
  const allowedOrigin = "*";

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  if (body.action === "sneaker_image") {
    const googleKey = process.env.GOOGLE_API_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;
    console.log("Image request for:", body.query, "keys present:", !!googleKey, !!cseId);
    if (!googleKey || !cseId) return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: null, debug: "missing_keys" }) };
    try {
      // Try image search
      const imgQuery = body.query + " sneaker";
      const r = await fetch(`https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cseId}&q=${encodeURIComponent(imgQuery)}&searchType=image&num=1`);
      const d = await r.json();
      console.log("Google image search status:", r.status, "items:", d.items?.length, "error:", d.error?.message || "none");
      if (d.items?.[0]?.link) {
        console.log("Image found:", d.items[0].link.substring(0, 80));
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: d.items[0].link }) };
      }
      // Fallback: regular search for og:image
      const r2 = await fetch(`https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cseId}&q=${encodeURIComponent(imgQuery)}&num=3`);
      const d2 = await r2.json();
      console.log("Google web search status:", r2.status, "items:", d2.items?.length, "error:", d2.error?.message || "none");
      for (const item of (d2.items || [])) {
        const img = item.pagemap?.cse_image?.[0]?.src || item.pagemap?.metatags?.[0]?.["og:image"];
        if (img) {
          console.log("OG image found:", img.substring(0, 80));
          return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: img }) };
        }
      }
      console.log("No images found in either search");
    } catch(e) { console.error("Image search error:", e.message); }
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: null }) };
  }

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
      headers: { "Access-Control-Allow-Origin": allowedOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
