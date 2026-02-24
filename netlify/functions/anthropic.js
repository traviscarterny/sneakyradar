// In-memory cache (persists across warm function invocations)
let imageCache = {};
let imageCacheTime = 0;
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

exports.handler = async function(event) {
  const allowedOrigin = "*";
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  // Batch image lookup: client sends all drop names at once
  if (body.action === "sneaker_images") {
    const drops = body.drops || [];
    console.log("Batch image request for", drops.length, "drops");
    
    // Check cache first
    if (Date.now() - imageCacheTime < CACHE_TTL && Object.keys(imageCache).length > 0) {
      console.log("Serving from cache, age:", Math.round((Date.now() - imageCacheTime) / 1000), "s");
      const results = {};
      for (const drop of drops) {
        const key = drop.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        results[drop.name] = imageCache[key] || { thumbnail: null, productUrl: null };
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ results, cached: true }) };
    }

    const xaiKey = process.env.XAI_API_KEY;
    if (!xaiKey) {
      console.log("No XAI_API_KEY");
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ results: {}, cached: false }) };
    }

    try {
      const nameList = drops.map(d => d.name).join("\n- ");
      console.log("Calling Grok for batch image search...");
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      
      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${xaiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "grok-3-mini-fast",
          messages: [{ role: "user", content: `For each sneaker below, provide the StockX product page URL and product image URL. StockX URLs follow the pattern: https://stockx.com/shoe-name-colorway (lowercase, hyphenated). StockX images follow: https://images.stockx.com/images/Shoe-Name-Colorway-Product.jpg (title case, hyphenated).

Sneakers:
- ${nameList}

Return ONLY a JSON array: [{"name":"exact shoe name","productUrl":"https://stockx.com/...","imageUrl":"https://images.stockx.com/images/..."}]
Return ONLY the JSON array, no explanation.` }],
          max_tokens: 2000,
          temperature: 0,
        }),
      });
      clearTimeout(timeout);
      const data = await response.json();
      console.log("Grok batch status:", response.status);
      
      if (response.status !== 200) {
        console.log("Grok error:", JSON.stringify(data).substring(0, 300));
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ results: {}, cached: false }) };
      }

      // Extract text - chat completions format
      let text = "";
      if (data.choices?.[0]?.message?.content) {
        text = data.choices[0].message.content;
      } else if (data.text) {
        text = data.text;
      } else if (data.output) {
        for (const block of data.output) {
          if (block.type === "message" && block.content) {
            for (const c of block.content) {
              if (c.type === "output_text" || c.type === "text") text += c.text || "";
            }
          }
        }
      }
      console.log("Grok text length:", text.length, "preview:", text.substring(0, 300));

      // Parse JSON array
      const results = {};
      try {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const clean = jsonMatch[0].replace(/```json|```/g, "").trim();
          const items = JSON.parse(clean);
          for (const item of items) {
            if (item.name) {
              const key = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
              const entry = { thumbnail: item.imageUrl || null, productUrl: item.productUrl || null };
              results[item.name] = entry;
              imageCache[key] = entry;
            }
          }
          imageCacheTime = Date.now();
          console.log("Cached", Object.keys(results).length, "image results");
        } else {
          console.log("No JSON array found in Grok response");
        }
      } catch(e) {
        console.log("JSON parse error:", e.message);
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ results, cached: false }) };
    } catch(err) {
      console.error("Grok batch error:", err.message);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ results: {}, cached: false }) };
    }
  }

  // Single image lookup (uses cache only)
  if (body.action === "sneaker_image") {
    const key = (body.query || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (imageCache[key]) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(imageCache[key]) };
    }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ thumbnail: null, productUrl: null }) };
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
      headers: { "Access-Control-Allow-Origin": allowedOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
