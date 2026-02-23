exports.handler = async function(event) {
  const allowedOrigin = "*";

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

 if (body.action === "sneaker_image") {
    const query = body.query;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    
    // Use Anthropic + web search to find a sneaker image URL
    if (apiKey) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "web-search-2025-03-05",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 300,
            system: "Find a direct image URL for the sneaker described. Return ONLY the image URL, nothing else. The URL must end in .jpg, .png, or .webp, or be from a known image CDN. If you cannot find one, return exactly: NONE",
            tools: [{ type: "web_search_20250305", name: "web_search" }],
            messages: [{ role: "user", content: `Find a product image URL for: ${query}` }]
          }),
        });
        const data = await response.json();
        const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("").trim() || "";
        console.log("Image search result for", query, ":", text.substring(0, 120));
        
        // Extract URL from response
        const urlMatch = text.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp)[^\s"'<>]*/i) 
                       || text.match(/https?:\/\/[^\s"'<>]*image[^\s"'<>]*/i)
                       || text.match(/https?:\/\/[^\s"'<>]+/i);
        if (urlMatch && !text.includes("NONE")) {
          const thumbnail = urlMatch[0];
          console.log("Found image:", thumbnail.substring(0, 80));
          return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail }) };
        }
      } catch(err) {
        console.error("Anthropic image search error:", err.message);
      }
    }

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
