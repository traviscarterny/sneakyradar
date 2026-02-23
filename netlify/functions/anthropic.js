exports.handler = async function(event) {
  const allowedOrigin = "*";

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  if (body.action === "sneaker_image") {
    const rapidKey = process.env.RAPIDAPI_KEY;
    if (!rapidKey) return { statusCode: 500, body: JSON.stringify({ error: "RAPIDAPI_KEY not configured" }) };
    try {
      const q = encodeURIComponent(body.query);
      const r = await fetch(`https://sneaker-database-stockx.p.rapidapi.com/getProducts/${q}`, {
        headers: {
          "X-RapidAPI-Key": rapidKey,
          "X-RapidAPI-Host": "sneaker-database-stockx.p.rapidapi.com"
        }
      });
      const data = await r.json();
      const results = Array.isArray(data) ? data : (data.results || []);
      const thumbnail = results[0]?.thumbnail || null;
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": allowedOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ thumbnail })
      };
    } catch(err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
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
