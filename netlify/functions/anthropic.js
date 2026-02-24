exports.handler = async function(event) {
  const allowedOrigin = "*";

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  if (body.action === "sneaker_image") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: null }) };
    
    // Use Anthropic web search to find a product image URL
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
          max_tokens: 200,
          system: "Find a direct image URL (ending in .jpg, .png, or .webp) for this sneaker. Search sneaker news sites. Return ONLY the URL, nothing else. If you cannot find one, return NONE",
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: body.query + " sneaker product photo" }]
        }),
      });
      const data = await response.json();
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("").trim() || "";
      console.log("Image search for:", body.query, "result:", text.substring(0, 100));
      const urlMatch = text.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp)([?#][^\s"'<>]*)?/i);
      if (urlMatch && !text.includes("NONE")) {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: urlMatch[0] }) };
      }
    } catch(err) {
      console.error("Image search error:", err.message);
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
