exports.handler = async function(event) {
  const allowedOrigin = "*";

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  if (body.action === "sneaker_image") {
    const xaiKey = process.env.XAI_API_KEY;
    if (!xaiKey) {
      console.log("No XAI_API_KEY set");
      return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: null, productUrl: null }) };
    }
    try {
      const query = body.query;
      console.log("Grok image search for:", query);
      const response = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${xaiKey}`,
        },
        body: JSON.stringify({
          model: "grok-3-mini-fast",
          input: [{ role: "user", content: `Find the StockX or GOAT product page URL and product image URL for this sneaker: "${query}". Return ONLY a JSON object like: {"productUrl":"https://stockx.com/...","imageUrl":"https://..."} If you find a StockX page, use its og:image. If not found, try GOAT or Nike. Return ONLY the JSON, nothing else.` }],
          tools: [{ 
            type: "web_search",
            allowed_domains: ["stockx.com", "goat.com", "nike.com", "sneakernews.com", "flightclub.com"]
          }],
        }),
      });
      const data = await response.json();
      console.log("Grok response status:", response.status);
      
      // Extract text from response
      let text = "";
      if (data.output) {
        for (const block of data.output) {
          if (block.type === "message" && block.content) {
            for (const c of block.content) {
              if (c.type === "text") text += c.text;
            }
          }
        }
      } else if (data.choices) {
        text = data.choices[0]?.message?.content || "";
      }
      console.log("Grok text:", text.substring(0, 200));
      
      // Parse JSON from response
      const jsonMatch = text.match(/\{[^{}]*"productUrl"[^{}]*\}/);
      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          console.log("Found product:", result.productUrl?.substring(0, 60), "image:", result.imageUrl?.substring(0, 60));
          return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: result.imageUrl || null, productUrl: result.productUrl || null }) };
        } catch(e) { console.log("JSON parse error:", e.message); }
      }
      
      // Fallback: extract any image URL from response
      const imgMatch = text.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp)([?#][^\s"'<>]*)?/i);
      const urlMatch = text.match(/https?:\/\/(www\.)?(stockx\.com|goat\.com)[^\s"'<>]+/i);
      return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: imgMatch?.[0] || null, productUrl: urlMatch?.[0] || null }) };
    } catch(err) {
      console.error("Grok search error:", err.message);
    }
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: null, productUrl: null }) };
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
