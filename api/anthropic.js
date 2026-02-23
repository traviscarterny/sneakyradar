// api/anthropic.js
// Vercel API Route — lives at /api/anthropic
// Add ANTHROPIC_API_KEY to your Vercel environment variables

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  // Build headers — only add web search beta header if the request uses web_search tool
  const body = req.body;
  const usesWebSearch = Array.isArray(body.tools) && body.tools.some(t => t.type?.includes("web_search"));

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  if (usesWebSearch) {
    headers["anthropic-beta"] = "web-search-2025-03-05";
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();

    // Log errors server-side so you can see them in Vercel logs
    if (!response.ok) {
      console.error("Anthropic API error:", response.status, JSON.stringify(data));
    }

    return res.status(response.status).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
