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
    const query = body.query;
    console.log("Image search for:", query);

    if (googleKey && cseId) {
      // Strategy 1: Google Image Search
      try {
        const imgUrl = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cseId}&q=${encodeURIComponent(query)}&searchType=image&num=1`;
        const r1 = await fetch(imgUrl);
        const d1 = await r1.json();
        if (d1.items?.[0]?.link) {
          console.log("Image search hit:", d1.items[0].link.substring(0, 80));
          return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: d1.items[0].link }) };
        }
        console.log("Image search miss. Error:", JSON.stringify(d1.error || "none").substring(0, 200), "searchInfo:", JSON.stringify(d1.searchInformation || {}));
      } catch(e) { console.error("Image search error:", e.message); }

      // Strategy 2: Regular web search, extract image from results
      try {
        const webUrl = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=3`;
        const r2 = await fetch(webUrl);
        const d2 = await r2.json();
        if (d2.items) {
          for (const item of d2.items) {
            const ogImage = item.pagemap?.cse_image?.[0]?.src || item.pagemap?.metatags?.[0]?.["og:image"];
            if (ogImage && (ogImage.includes(".jpg") || ogImage.includes(".png") || ogImage.includes(".webp") || ogImage.includes("image"))) {
              console.log("Web search og:image hit:", ogImage.substring(0, 80));
              return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ thumbnail: ogImage }) };
            }
          }
        }
        console.log("Web search had", d2.items?.length || 0, "results but no usable images");
      } catch(e) { console.error("Web search error:", e.message); }
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
